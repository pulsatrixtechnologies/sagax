// The persona editor's Rules and Files categories: the bot workspace as the
// server lists it (GET /api/bots/:id/workspace, server/routes/bot-workspace.ts)
// and the small pure helpers both categories share. RULES.md and docs/ are
// read and saved through /workspace/file, open to the bot's owner like the
// Soul; MEMORY.md and memory/ stay on the admin memory routes (src/lib/memory.ts).
import { ApiError, api } from "@/state/store";
import type { MemoryDoc } from "@/lib/memory";
import { readableError } from "@/lib/plain-error";

export const RULES_PATH = "RULES.md";
export const DOCS_DIR = "docs";
/** Mirrors server/workspace-files.ts; the server's list carries the live
 * values, these are the fallback before it answers. */
export const RULES_MAX_LINES = 100;
export const RULES_MAX_BYTES = 12_000;

export type WorkspaceLoad = "every-turn" | "on-demand" | "never";

export interface WorkspaceBudget {
  maxLines?: number;
  maxBytes: number;
  lines: number;
  bytes: number;
  over: boolean;
}

export interface WorkspaceEntry {
  path: string;
  kind: "file" | "dir";
  bytes: number;
  createdAt?: number;
  modifiedAt?: number;
  lastUsedAt?: number;
  load: WorkspaceLoad;
  editable: boolean;
  markdown: boolean;
  budget?: WorkspaceBudget;
  forgotten: boolean;
  /** "soul": SOUL.md lives on the bot record; it opens the Soul category. */
  virtual?: "soul";
}

export interface WorkspaceListing {
  workspacePath: string;
  now: number;
  forgottenAfterDays: number;
  /** Upload ceiling for any file in the bot folder (matches attachment file max). */
  uploadMaxBytes?: number;
  budgets: { rules: { maxLines: number; maxBytes: number }; rulesTotal?: { maxLines: number; maxBytes: number }; memory: { maxLines: number; maxBytes: number }; soul: { maxBytes: number } };
  rulesTemplate: string;
  soul: WorkspaceEntry;
  entries: WorkspaceEntry[];
  truncated: boolean;
}

/** Standing files: Every turn badge, editable, never deleted / renamed / moved. */
export const CORE_WORKSPACE_FILES = new Set(["SOUL.md", "MEMORY.md", "RULES.md"]);

export function isCoreWorkspaceFile(path: string): boolean {
  return CORE_WORKSPACE_FILES.has(path);
}

export function fetchWorkspace(botId: string): Promise<WorkspaceListing> {
  return api(`/api/bots/${encodeURIComponent(botId)}/workspace`);
}

export function workspaceDownloadUrl(botId: string, path: string): string {
  return `/api/bots/${encodeURIComponent(botId)}/workspace/download?path=${encodeURIComponent(path)}`;
}

/** Is `path` one /workspace/file serves: RULES.md, a rule set
 * (rules/<set>.md) or docs/<name>.md. */
export function isRulesOrDoc(path: string): boolean {
  return path === RULES_PATH || /^rules\/[^/.][^/]*\.md$/.test(path) || /^docs\/[^/]+\.md$/.test(path);
}

const fileUrl = (botId: string, path?: string) =>
  `/api/bots/${encodeURIComponent(botId)}/workspace/file${path === undefined ? "" : `?path=${encodeURIComponent(path)}`}`;

export function fetchWorkspaceDoc(botId: string, path: string): Promise<MemoryDoc> {
  return api(fileUrl(botId, path));
}

export type WorkspaceSaveResult =
  | { ok: true; doc: MemoryDoc }
  | { ok: false; conflict: true; current: string; currentHash: string };

/** A 409 carries what is on disk now (the bot may have written), like a
 * memory save. */
export async function saveWorkspaceDoc(botId: string, path: string, text: string, expectedHash: string | undefined): Promise<WorkspaceSaveResult> {
  const response = await fetch(fileUrl(botId), {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path, text, expectedHash }),
  });
  // SAFETY: the server's JSON is narrowed field by field below
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (response.status === 409 && typeof body.current === "string" && typeof body.currentHash === "string") {
    return { ok: false, conflict: true, current: body.current, currentHash: body.currentHash };
  }
  if (!response.ok) throw new ApiError(readableError(typeof body.error === "string" ? body.error : `${response.status} ${response.statusText}`), response.status);
  return { ok: true, doc: { path: String(body.path), text: String(body.text), hash: String(body.hash), exists: body.exists === true } };
}

export function deleteWorkspaceDoc(botId: string, path: string): Promise<{ ok: true; path: string }> {
  return api(fileUrl(botId, path), { method: "DELETE" });
}

export function renameWorkspaceDoc(botId: string, from: string, to: string): Promise<{ ok: true; path: string }> {
  return api(`/api/bots/${encodeURIComponent(botId)}/workspace/docs/rename`, { method: "POST", body: JSON.stringify({ from, to }) });
}

export function createWorkspaceFolder(botId: string, path: string): Promise<{ ok: true; path: string }> {
  return api(`/api/bots/${encodeURIComponent(botId)}/workspace/mkdir`, { method: "POST", body: JSON.stringify({ path }) });
}

export function createWorkspaceFile(botId: string, path: string, text = ""): Promise<{ ok: true; path: string; bytes?: number }> {
  return api(`/api/bots/${encodeURIComponent(botId)}/workspace/touch`, { method: "POST", body: JSON.stringify({ path, text }) });
}

export function renameWorkspaceEntry(botId: string, from: string, to: string): Promise<{ ok: true; path: string }> {
  return api(`/api/bots/${encodeURIComponent(botId)}/workspace/rename`, { method: "POST", body: JSON.stringify({ from, to }) });
}

export function deleteWorkspaceEntry(botId: string, path: string, opts: { recursive?: boolean } = {}): Promise<{ ok: true; path: string; removed?: number }> {
  const query = new URLSearchParams({ path });
  if (opts.recursive) query.set("recursive", "1");
  return api(`/api/bots/${encodeURIComponent(botId)}/workspace/entry?${query}`, { method: "DELETE" });
}

export function countWorkspaceFiles(botId: string, path: string): Promise<{ path: string; count: number }> {
  return api(`/api/bots/${encodeURIComponent(botId)}/workspace/count?path=${encodeURIComponent(path)}`);
}

/** Upload raw bytes to a workspace path with progress. */
export function uploadWorkspaceFile(
  botId: string,
  path: string,
  file: Blob,
  opts: { overwrite?: boolean; signal?: AbortSignal; onProgress?: (uploaded: number, total: number) => void } = {},
): Promise<{ ok: true; path: string; bytes: number }> {
  const query = new URLSearchParams({ path });
  if (opts.overwrite) query.set("overwrite", "1");
  const url = `/api/bots/${encodeURIComponent(botId)}/workspace/upload?${query}`;
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.responseType = "json";
    xhr.setRequestHeader("content-type", "application/octet-stream");
    if (opts.signal) {
      if (opts.signal.aborted) {
        reject(new DOMException("Aborted", "AbortError"));
        return;
      }
      opts.signal.addEventListener("abort", () => xhr.abort(), { once: true });
    }
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) opts.onProgress?.(event.loaded, event.total);
    };
    xhr.onload = () => {
      const body = (xhr.response ?? {}) as { ok?: boolean; path?: string; bytes?: number; error?: string };
      if (xhr.status >= 200 && xhr.status < 300 && body.path) {
        resolve({ ok: true, path: body.path, bytes: body.bytes ?? file.size });
        return;
      }
      reject(new ApiError(readableError(typeof body.error === "string" ? body.error : `${xhr.status} ${xhr.statusText}`), xhr.status));
    };
    xhr.onerror = () => reject(new ApiError(readableError("network error"), 0));
    xhr.onabort = () => reject(new DOMException("Aborted", "AbortError"));
    xhr.send(file);
  });
}

/** Join a parent folder with a file or folder name. */
export function joinWorkspacePath(parent: string | null, name: string): string {
  const clean = name.replace(/^\/+|\/+$/g, "");
  if (!parent) return clean;
  return `${parent.replace(/\/+$/, "")}/${clean}`;
}

/** RULES.md as it loads: comments removed, blank runs folded, trimmed
 * (server/workspace-files.ts effectiveRulesText). */
export function effectiveRulesText(raw: string): string {
  return raw.replace(/<!--[\s\S]*?(?:-->|$)/g, "").replace(/\n{3,}/g, "\n\n").trim();
}

export interface RulesCount {
  lines: number;
  bytes: number;
  maxLines: number;
  maxBytes: number;
  over: boolean;
}

/** Lines and bytes of what loads, against the rules budget. */
export function rulesCount(raw: string, maxLines = RULES_MAX_LINES, maxBytes = RULES_MAX_BYTES): RulesCount {
  const text = effectiveRulesText(raw);
  const lines = text ? text.replace(/\n$/, "").split("\n").length : 0;
  const bytes = new TextEncoder().encode(text).length;
  return { lines, bytes, maxLines, maxBytes, over: lines > maxLines || bytes > maxBytes };
}

/** A document's path from whatever the person typed: spaces and odd
 * punctuation become dashes, .md is added, docs/ in front. Null when
 * nothing usable is left. */
export function docPathFromName(input: string): string | null {
  const stem = input.trim().replace(/^docs\//, "").replace(/\.md$/i, "").replace(/[^\p{L}\p{N}_ .-]+/gu, "-").replace(/^[^\p{L}\p{N}_]+/u, "").trim();
  if (!stem || stem.length > 190) return null;
  return `${DOCS_DIR}/${stem}.md`;
}

/** Folder depth, for indenting the tree. */
export function entryDepth(path: string): number {
  return path.split("/").length - 1;
}

export function entryName(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] ?? path;
}

/** Parent folder of a workspace path, or null at the tree root. */
export function entryParent(path: string): string | null {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? null : path.slice(0, slash);
}

/** Directories above `path`, root first. */
export function entryAncestors(path: string): string[] {
  const out: string[] = [];
  let parent = entryParent(path);
  while (parent) {
    out.unshift(parent);
    parent = entryParent(parent);
  }
  return out;
}

/** A row shows when every listed ancestor folder is expanded. Folders
 * start collapsed, like a file manager. An ancestor the listing did not
 * emit as a dir is treated as open, so a file still appears once the
 * parent that does exist is expanded. */
export function entryVisible(path: string, expanded: ReadonlySet<string>, listedDirs: ReadonlySet<string>): boolean {
  let parent = entryParent(path);
  while (parent) {
    if (listedDirs.has(parent) && !expanded.has(parent)) return false;
    parent = entryParent(parent);
  }
  return true;
}
