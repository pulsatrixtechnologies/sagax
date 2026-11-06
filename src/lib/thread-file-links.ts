// File names in a bot message that point at a file the conversation touched
// (#file-links): "J'ai créé `pelican-a-velo.html` sur ton bureau" becomes a
// link that opens the file. The source is the thread's file list
// (GET /api/threads/:id/files: what the bot wrote, linked or attached), plus,
// in the desktop app on its own computer, a check that the path exists here
// (a file on ~/Desktop sits outside the workspace the server serves).
import { useCallback, useEffect, useSyncExternalStore } from "react";

import type { ThreadFile } from "@/lib/chat-files";
import { api } from "@/state/store/api";

export interface ThreadFileLink {
  threadId: string;
  file: ThreadFile;
  /** The absolute path on this computer, when the desktop app can open it
   * here (local app, file exists). */
  localPath?: string;
}

interface Entry {
  files: ThreadFile[];
  /** Raw path → absolute local path, or null when not on this computer. */
  local: ReadonlyMap<string, string | null>;
  fetchedAt: number;
  loading: boolean;
}

const EMPTY: Entry = { files: [], local: new Map(), fetchedAt: 0, loading: false };
/** A newer message naming a file the list does not have yet refetches, at
 * most this often per thread. */
const REFRESH_MS = 4_000;

const entries = new Map<string, Entry>();
const listeners = new Map<string, Set<() => void>>();

function emit(threadId: string) {
  for (const listener of listeners.get(threadId) ?? []) listener();
}

function set(threadId: string, entry: Entry) {
  entries.set(threadId, entry);
  emit(threadId);
}

/** Tests and sign-out. */
export function resetThreadFileLinks() {
  entries.clear();
}

/** A word the bot could mean as a file: one token with an extension, or a
 * path. Keeps prose, commands and identifiers like `useState` out. */
export function looksLikeFileName(text: string): boolean {
  const value = text.trim();
  if (!value || value.length > 1024 || /\s/.test(value) || /^[a-z][a-z\d+.-]*:\/\//i.test(value) && !/^file:\/\//i.test(value)) return false;
  if (/[<>|*?"`$]/.test(value)) return false;
  return /\.[A-Za-z0-9]{1,8}$/.test(value) || /[\\/]/.test(value) && /[^\\/]$/.test(value);
}

function normalize(value: string): string {
  let path = value.trim();
  if (/^file:\/\//i.test(path)) {
    try { path = decodeURIComponent(new URL(path).pathname); } catch { /* keep */ }
  }
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

function basename(path: string): string {
  return path.split("/").filter(Boolean).at(-1) ?? path;
}

/** Desktop app, on its own computer (not paired to another server). */
function localBridge() {
  const ogb = typeof window === "undefined" ? undefined : window.ogb;
  if (!ogb || ogb.remoteClient?.active || !ogb.openLocalFile || !ogb.localFilesExist) return undefined;
  return ogb;
}

/** Can this path be checked on this computer: absolute or under the home folder. */
function locallyCheckable(path: string): boolean {
  return /^(?:\/|~[\\/]|[a-zA-Z]:[\\/])/.test(path);
}

/** Pure lookup: the thread file a name or path in a message means. Exact path
 * first, then a path ending with it, then the bare name; the latest touch
 * wins. Uploads stay out: the person's own file is not "the bot made this". */
export function matchThreadFile(text: string, files: readonly ThreadFile[]): ThreadFile | null {
  const wanted = normalize(text);
  if (!wanted) return null;
  const tail = wanted.replace(/^~\//, "");
  const bare = !tail.includes("/");
  const candidates = files.filter((file) => file.source !== "upload").sort((a, b) => b.at - a.at);
  const paths = (file: ThreadFile) => [normalize(file.path), ...(file.localPath ? [normalize(file.localPath)] : [])];
  return candidates.find((file) => paths(file).includes(wanted))
    ?? candidates.find((file) => paths(file).some((path) => path.endsWith(`/${tail}`) || path.replace(/^~\//, "") === tail))
    ?? (bare ? candidates.find((file) => basename(normalize(file.path)) === tail || basename(normalize(file.name)) === tail) : undefined)
    ?? null;
}

async function load(threadId: string) {
  const current = entries.get(threadId) ?? EMPTY;
  if (current.loading) return;
  set(threadId, { ...current, loading: true, fetchedAt: Date.now() });
  let files: ThreadFile[] = current.files;
  try {
    files = (await api<{ files: ThreadFile[] }>(`/api/threads/${encodeURIComponent(threadId)}/files`)).files ?? [];
  } catch {
    // Offline or an older server: names stay plain code.
  }
  const local = new Map(current.local);
  const bridge = localBridge();
  if (bridge) {
    const ask = [...new Set(files.flatMap((file) => [file.localPath, file.path]).filter((path): path is string => Boolean(path) && locallyCheckable(path!) && !local.has(path!)))];
    if (ask.length) {
      try {
        const found = await bridge.localFilesExist!(ask);
        ask.forEach((path, index) => local.set(path, found[index] ?? null));
      } catch {
        // Bridge refused: only server-served files link.
      }
    }
  }
  set(threadId, { files, local, fetchedAt: Date.now(), loading: false });
}

function subscribe(threadId: string, listener: () => void) {
  let set = listeners.get(threadId);
  if (!set) listeners.set(threadId, set = new Set());
  set.add(listener);
  return () => {
    set!.delete(listener);
  };
}

/** Resolve a file name from an entry: linked when the server serves it or
 * the desktop app finds it on this computer. */
export function resolveThreadFileLink(threadId: string, text: string, entry: Pick<Entry, "files" | "local"> = entries.get(threadId) ?? EMPTY): ThreadFileLink | null {
  const file = matchThreadFile(text, entry.files);
  if (!file) return null;
  const localPath = localBridge() ? (file.localPath && entry.local.get(file.localPath)) || entry.local.get(file.path) || undefined : undefined;
  if (!file.available && !localPath) return null;
  return { threadId, file, ...(localPath ? { localPath } : {}) };
}

/** The file link a code span or href means, or null to render it as is.
 * Fetches the thread's list on first use; a miss refetches (throttled) so a
 * file written this turn links as soon as the message shows. */
export function useThreadFileLink(threadId: string | undefined, text: string): ThreadFileLink | null {
  const candidate = Boolean(threadId) && looksLikeFileName(text);
  const subscribeThread = useCallback(
    (listener: () => void) => (candidate && threadId ? subscribe(threadId, listener) : () => undefined),
    [candidate, threadId],
  );
  const entry = useSyncExternalStore(
    subscribeThread,
    () => (candidate ? entries.get(threadId!) ?? EMPTY : EMPTY),
    () => EMPTY,
  );
  const link = candidate ? resolveThreadFileLink(threadId!, text, entry) : null;
  useEffect(() => {
    if (!candidate || link || entry.loading) return;
    if (Date.now() - entry.fetchedAt < REFRESH_MS) return;
    void load(threadId!);
  }, [candidate, threadId, link, entry]);
  return link;
}
