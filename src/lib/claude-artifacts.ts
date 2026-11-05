// claude.ai artifacts in a chat (#2018): the summary and comments the server
// reads with the engine's own claude.ai session, and one version counter per
// canonical artifact url so every card of that url refetches in place when a
// later publish of the same url lands, or after a reply or a resolve.
import { useEffect, useState, useSyncExternalStore } from "react";

import { api, ApiError } from "@/state/store";
import { claudeArtifactUrl } from "../../shared/claude-chat-blocks";

export interface ClaudeArtifactSummary {
  url: string;
  title: string;
  icon?: string;
  owned: boolean;
  updatedAt?: string;
  summary?: string;
}

export interface ClaudeArtifactBlocked {
  url: string;
  blocked: "other_account";
  account?: string;
}

export interface ClaudeArtifactReply {
  author?: string;
  text: string;
  createdAt?: string;
}

export interface ClaudeArtifactThread {
  id: string;
  status: string;
  author?: string;
  text: string;
  createdAt?: string;
  replies: ClaudeArtifactReply[];
}

export type ClaudeArtifactState =
  | { kind: "loading" }
  | { kind: "ready"; summary: ClaudeArtifactSummary }
  | { kind: "blocked"; blocked: ClaudeArtifactBlocked }
  | { kind: "signedOut" }
  | { kind: "error" };

// ---- version store, keyed by canonical url ------------------------------

const versions = new Map<string, number>();
const publishKeys = new Map<string, Set<string>>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** Every card of this url refetches. */
export function bumpClaudeArtifact(raw: string): void {
  const url = claudeArtifactUrl(raw);
  if (!url) return;
  versions.set(url, (versions.get(url) ?? 0) + 1);
  emit();
}

/** A publish fence of this url was rendered under `key` (message and offset).
 * A new key for a url already seen is a later publish: its cards refetch. */
export function noteClaudeArtifactPublish(raw: string, key: string): void {
  const url = claudeArtifactUrl(raw);
  if (!url) return;
  const seen = publishKeys.get(url);
  if (!seen) {
    publishKeys.set(url, new Set([key]));
    return;
  }
  if (seen.has(key)) return;
  seen.add(key);
  bumpClaudeArtifact(url);
}

export function useClaudeArtifactVersion(url: string): number {
  return useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    () => versions.get(url) ?? 0,
    () => 0,
  );
}

// One read per url and version, shared by every card of that url.
const summaries = new Map<string, { version: number; read: Promise<ClaudeArtifactState> }>();
const commentReads = new Map<string, { version: number; read: Promise<ClaudeArtifactThread[]> }>();

function sharedRead<T>(cache: Map<string, { version: number; read: Promise<T> }>, url: string, version: number, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(url);
  if (hit && hit.version === version) return hit.read;
  const read = load();
  cache.set(url, { version, read });
  // a failed read is not kept: the next mount tries again
  read.catch(() => { if (cache.get(url)?.read === read) cache.delete(url); });
  return read;
}

/** Tests only. */
export function resetClaudeArtifactStore(): void {
  versions.clear();
  publishKeys.clear();
  summaries.clear();
  commentReads.clear();
  emit();
}

// ---- requests -------------------------------------------------------------

const BASE = "/api/claude-artifacts";

function text(value: unknown, max = 4000): string | undefined {
  return typeof value === "string" && value.trim() ? value.slice(0, max) : undefined;
}

export async function fetchClaudeArtifact(url: string, request: typeof api = api): Promise<ClaudeArtifactState> {
  try {
    const body = await request<Record<string, unknown>>(`${BASE}/summary?url=${encodeURIComponent(url)}`);
    if (body?.blocked === "other_account") {
      const account = text(body.account, 254);
      return { kind: "blocked", blocked: { url, blocked: "other_account", ...(account ? { account } : {}) } };
    }
    const title = text(body?.title, 300) ?? "";
    const icon = text(body?.icon, 40);
    const updatedAt = text(body?.updatedAt, 64);
    const summary = text(body?.summary);
    return {
      kind: "ready",
      summary: { url, title, owned: body?.owned === true, ...(icon ? { icon } : {}), ...(updatedAt ? { updatedAt } : {}), ...(summary ? { summary } : {}) },
    };
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) return { kind: "signedOut" };
    return { kind: "error" };
  }
}

export async function fetchClaudeArtifactComments(url: string, request: typeof api = api): Promise<ClaudeArtifactThread[]> {
  const body = await request<{ threads?: unknown }>(`${BASE}/comments?url=${encodeURIComponent(url)}`);
  const threads = Array.isArray(body?.threads) ? body.threads : [];
  return threads.flatMap((entry): ClaudeArtifactThread[] => {
    if (!entry || typeof entry !== "object") return [];
    const record = entry as Record<string, unknown>;
    const id = text(record.id, 200);
    const said = text(record.text);
    if (!id || !said) return [];
    const replies = Array.isArray(record.replies) ? record.replies.flatMap((reply): ClaudeArtifactReply[] => {
      if (!reply || typeof reply !== "object") return [];
      const r = reply as Record<string, unknown>;
      const replyText = text(r.text);
      if (!replyText) return [];
      const author = text(r.author, 200);
      const createdAt = text(r.createdAt, 64);
      return [{ text: replyText, ...(author ? { author } : {}), ...(createdAt ? { createdAt } : {}) }];
    }) : [];
    const author = text(record.author, 200);
    const createdAt = text(record.createdAt, 64);
    return [{ id, status: text(record.status, 40) ?? "open", text: said, replies, ...(author ? { author } : {}), ...(createdAt ? { createdAt } : {}) }];
  });
}

export async function replyClaudeArtifactComment(url: string, threadId: string, body: string, request: typeof api = api): Promise<void> {
  await request(`${BASE}/comments/reply`, { method: "POST", body: JSON.stringify({ url, threadId, text: body }) });
  bumpClaudeArtifact(url);
}

export async function resolveClaudeArtifactComment(url: string, threadId: string, request: typeof api = api): Promise<void> {
  await request(`${BASE}/comments/resolve`, { method: "POST", body: JSON.stringify({ url, threadId }) });
  bumpClaudeArtifact(url);
}

/** The card's state for this url, refetched on every version bump. */
export function useClaudeArtifact(url: string): ClaudeArtifactState {
  const version = useClaudeArtifactVersion(url);
  const [state, setState] = useState<ClaudeArtifactState>({ kind: "loading" });
  useEffect(() => {
    let live = true;
    void sharedRead(summaries, url, version, () => fetchClaudeArtifact(url)).then((next) => {
      if (!live) return;
      if (next.kind === "error" && summaries.get(url)?.version === version) summaries.delete(url);
      setState(next);
    });
    return () => { live = false; };
  }, [url, version]);
  return state;
}

/** Open comment threads of an owned artifact; null while loading or when
 * they could not be read (the card then shows none). */
export function useClaudeArtifactComments(url: string, enabled: boolean): ClaudeArtifactThread[] | null {
  const version = useClaudeArtifactVersion(url);
  const [threads, setThreads] = useState<ClaudeArtifactThread[] | null>(null);
  useEffect(() => {
    if (!enabled) { setThreads(null); return; }
    let live = true;
    sharedRead(commentReads, url, version, () => fetchClaudeArtifactComments(url)).then((next) => { if (live) setThreads(next); }, () => { if (live) setThreads(null); });
    return () => { live = false; };
  }, [url, version, enabled]);
  return threads;
}

/** Desktop: a window on claude.ai in its own persistent session; web: a new tab. */
export function openClaudeArtifact(url: string): void {
  if (typeof window === "undefined") return;
  const opener = window.ogb?.artifactWindow?.openClaudeAi;
  if (opener) {
    void opener(url).then((result) => {
      if (result === "refused") window.open(url, "_blank", "noopener");
    }, () => window.open(url, "_blank", "noopener"));
    return;
  }
  window.open(url, "_blank", "noopener");
}

