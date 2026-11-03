// Manage any file or folder inside a bot's workspace from the Files UI:
// create, upload, rename, move, delete. Path safety mirrors
// server/workspace-files.ts (no traversal, no symlink escape). Core files
// SOUL.md, MEMORY.md and RULES.md cannot be deleted, renamed or moved.
// Markdown that the memory store already seals goes through the journal;
// other paths are plain workspace files (0600) with noteAtRestWrite when
// they sit under a sealed root.
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmdirSync,
  unlinkSync,
  type Stats,
} from "node:fs";
import { dirname, join, sep } from "node:path";

import { writeFileAtomic } from "./atomic.ts";
import { FILE_MAX_BYTES } from "./attachments.ts";
import { noteAtRestWrite } from "./encryption/content-at-rest.ts";
import { journalMemoryDelete, journalMemoryWrite } from "./memory/memory-journal.ts";
import { MemoryStoreError, parseMemoryPath, readMemoryDoc } from "./memory/memory-store.ts";
import { ensureWorkspace } from "./workspace.ts";
import { WorkspacePathError, normaliseWorkspacePath } from "./workspace-files.ts";

/** Upload and download ceiling for bot-folder files: same as a composer
 * file attachment. */
export const WORKSPACE_UPLOAD_MAX_BYTES = FILE_MAX_BYTES;

/** Standing files the person may edit and download, never delete, rename
 * or move. SOUL.md is virtual (bot record); MEMORY.md and RULES.md live
 * in the workspace. */
export const CORE_WORKSPACE_FILES = new Set(["SOUL.md", "MEMORY.md", "RULES.md"]);

export type WorkspaceManageCode =
  | "invalid"
  | "missing"
  | "exists"
  | "forbidden"
  | "not-empty"
  | "too-large"
  | "conflict";

export type WorkspaceManageResult =
  | { ok: true; path: string; bytes?: number; removed?: number }
  | { ok: false; code: WorkspaceManageCode; error: string; count?: number };

const SEGMENT = /^[\p{L}\p{N}_][\p{L}\p{N}_ .+-]{0,199}$/u;

function isCore(path: string): boolean {
  return CORE_WORKSPACE_FILES.has(path);
}

/** A single path segment the Files UI may create or rename to. */
export function isWorkspaceSegment(name: string): boolean {
  return typeof name === "string" && SEGMENT.test(name) && name !== "." && name !== ".." && !name.startsWith(".");
}

function assertNotCore(path: string, action: string): void {
  if (isCore(path)) throw new WorkspacePathError(`${path} cannot be ${action}`, 400);
}

/** Absolute path of a file or directory that already exists inside the
 * workspace, after the same proofs as resolveWorkspaceFile. */
export function resolveWorkspaceEntry(
  botId: string,
  input: unknown,
  opts: { mustExist?: boolean; kind?: "file" | "dir" | "any" } = {},
): { path: string; absolute: string; stat: Stats | null } {
  const path = normaliseWorkspacePath(input);
  const root = ensureWorkspace(botId);
  const absolute = join(root, ...path.split("/"));
  let realRoot: string;
  try {
    realRoot = realpathSync(root);
  } catch {
    throw new WorkspacePathError(`no such file: ${path}`, 404);
  }
  const mustExist = opts.mustExist !== false;
  if (!existsSync(absolute)) {
    if (mustExist) throw new WorkspacePathError(`no such file: ${path}`, 404);
    // parent must stay inside the workspace
    let ancestor = dirname(absolute);
    while (!existsSync(ancestor) && ancestor !== root) ancestor = dirname(ancestor);
    let realParent: string;
    try {
      realParent = realpathSync(ancestor);
    } catch {
      throw new WorkspacePathError(`no such file: ${path}`, 404);
    }
    if (realParent !== realRoot && !realParent.startsWith(realRoot + sep)) {
      throw new WorkspacePathError(`path escapes the workspace: ${JSON.stringify(path)}`);
    }
    return { path, absolute, stat: null };
  }
  let realParent: string;
  try {
    realParent = realpathSync(dirname(absolute));
  } catch {
    throw new WorkspacePathError(`no such file: ${path}`, 404);
  }
  if (realParent !== realRoot && !realParent.startsWith(realRoot + sep)) {
    throw new WorkspacePathError(`path escapes the workspace: ${JSON.stringify(path)}`);
  }
  const stat = lstatSync(absolute);
  if (stat.isSymbolicLink()) throw new WorkspacePathError(`${path} is a link, not a file`);
  const kind = opts.kind ?? "any";
  if (kind === "file" && !stat.isFile()) throw new WorkspacePathError(`${path} is not a file`);
  if (kind === "dir" && !stat.isDirectory()) throw new WorkspacePathError(`${path} is not a folder`);
  return { path, absolute, stat };
}

/** How many files (not folders) sit under a workspace path. A file counts
 * as 1; a missing path is 0. */
export function countWorkspaceFiles(botId: string, input: unknown): number {
  const entry = resolveWorkspaceEntry(botId, input, { mustExist: true, kind: "any" });
  if (!entry.stat) return 0;
  if (entry.stat.isFile()) return 1;
  let total = 0;
  const walk = (dir: string) => {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) {
      if (name.startsWith(".")) continue;
      const absolute = join(dir, name);
      let stat: Stats;
      try {
        stat = lstatSync(absolute);
      } catch {
        continue;
      }
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) walk(absolute);
      else if (stat.isFile()) total += 1;
    }
  };
  walk(entry.absolute);
  return total;
}

function memoryPathOrNull(path: string): string | null {
  try {
    parseMemoryPath(path);
    return path;
  } catch {
    return null;
  }
}

function sealIfNeeded(botId: string, absolute: string, relative: string): void {
  // The memory root seals MEMORY.md, memory/, docs/ and rules files.
  if (/^(MEMORY\.md|RULES\.md|memory\/|docs\/|rules\/)/.test(relative)) {
    noteAtRestWrite(absolute, { bot: botId });
  }
}

/** Create an empty folder anywhere in the tree. */
export function createWorkspaceFolder(botId: string, input: unknown): WorkspaceManageResult {
  let path: string;
  try {
    path = normaliseWorkspacePath(input);
  } catch (error) {
    return refuse(error);
  }
  if (isCore(path)) return { ok: false, code: "forbidden", error: `${path} cannot be created as a folder.` };
  for (const part of path.split("/")) {
    if (!isWorkspaceSegment(part)) return { ok: false, code: "invalid", error: `Use a name with letters, digits, spaces, dots, dashes or underscores.` };
  }
  try {
    const entry = resolveWorkspaceEntry(botId, path, { mustExist: false });
    if (entry.stat) return { ok: false, code: "exists", error: `${path} already exists.` };
    mkdirSync(entry.absolute, { recursive: true, mode: 0o700 });
    return { ok: true, path };
  } catch (error) {
    return refuse(error);
  }
}

/** Create an empty file (or overwrite only when missing). Markdown under
 * docs/RULES/memory goes through the journal. */
export function createWorkspaceFile(botId: string, input: unknown, text = ""): WorkspaceManageResult {
  let path: string;
  try {
    path = normaliseWorkspacePath(input);
  } catch (error) {
    return refuse(error);
  }
  if (isCore(path) && path !== "RULES.md" && path !== "MEMORY.md") {
    return { ok: false, code: "forbidden", error: `${path} cannot be created here.` };
  }
  for (const part of path.split("/")) {
    if (!isWorkspaceSegment(part)) return { ok: false, code: "invalid", error: `Use a name with letters, digits, spaces, dots, dashes or underscores.` };
  }
  const memory = memoryPathOrNull(path);
  if (memory) {
    try {
      if (readMemoryDoc(botId, memory).exists) return { ok: false, code: "exists", error: `${path} already exists.` };
      journalMemoryWrite(botId, memory, text, { actor: "person", via: "ui" });
      return { ok: true, path, bytes: Buffer.byteLength(text, "utf8") };
    } catch (error) {
      return refuse(error);
    }
  }
  try {
    const entry = resolveWorkspaceEntry(botId, path, { mustExist: false });
    if (entry.stat) return { ok: false, code: "exists", error: `${path} already exists.` };
    mkdirSync(dirname(entry.absolute), { recursive: true, mode: 0o700 });
    writeFileAtomic(entry.absolute, text, { mode: 0o600 });
    sealIfNeeded(botId, entry.absolute, path);
    return { ok: true, path, bytes: Buffer.byteLength(text, "utf8") };
  } catch (error) {
    return refuse(error);
  }
}

/** Write raw bytes to a workspace path (upload). Refuses core files and
 * oversize bodies. A markdown memory/docs path still journals as text when
 * the bytes are valid UTF-8 without NUL. */
export function writeWorkspaceBytes(botId: string, input: unknown, bytes: Buffer, opts: { overwrite?: boolean } = {}): WorkspaceManageResult {
  let path: string;
  try {
    path = normaliseWorkspacePath(input);
  } catch (error) {
    return refuse(error);
  }
  if (isCore(path)) return { ok: false, code: "forbidden", error: `${path} cannot be replaced by an upload.` };
  for (const part of path.split("/")) {
    if (!isWorkspaceSegment(part)) return { ok: false, code: "invalid", error: `Use a name with letters, digits, spaces, dots, dashes or underscores.` };
  }
  if (bytes.length > WORKSPACE_UPLOAD_MAX_BYTES) {
    return { ok: false, code: "too-large", error: `File is over ${Math.round(WORKSPACE_UPLOAD_MAX_BYTES / (1024 * 1024))} MB.` };
  }
  const memory = memoryPathOrNull(path);
  if (memory && !bytes.includes(0)) {
    try {
      const text = bytes.toString("utf8");
      if (!opts.overwrite && readMemoryDoc(botId, memory).exists) return { ok: false, code: "exists", error: `${path} already exists.` };
      journalMemoryWrite(botId, memory, text, { actor: "person", via: "ui" });
      return { ok: true, path, bytes: bytes.length };
    } catch (error) {
      return refuse(error);
    }
  }
  if (memory) return { ok: false, code: "invalid", error: `${path} must be text (markdown).` };
  try {
    const entry = resolveWorkspaceEntry(botId, path, { mustExist: false });
    if (entry.stat && !opts.overwrite) return { ok: false, code: "exists", error: `${path} already exists.` };
    if (entry.stat?.isDirectory()) return { ok: false, code: "invalid", error: `${path} is a folder.` };
    mkdirSync(dirname(entry.absolute), { recursive: true, mode: 0o700 });
    writeFileAtomic(entry.absolute, bytes, { mode: 0o600 });
    sealIfNeeded(botId, entry.absolute, path);
    return { ok: true, path, bytes: bytes.length };
  } catch (error) {
    return refuse(error);
  }
}

/** Rename or move a file or folder. Destination must not exist. Core files
 * stay put. A folder cannot move into itself. */
export function renameWorkspaceEntry(botId: string, fromInput: unknown, toInput: unknown): WorkspaceManageResult {
  let from: string;
  let to: string;
  try {
    from = normaliseWorkspacePath(fromInput);
    to = normaliseWorkspacePath(toInput);
  } catch (error) {
    return refuse(error);
  }
  try {
    assertNotCore(from, "moved");
    assertNotCore(to, "overwritten");
  } catch (error) {
    return refuse(error);
  }
  if (from === to) return { ok: true, path: to };
  if (to === from || to.startsWith(`${from}/`)) {
    return { ok: false, code: "invalid", error: "A folder cannot move into itself." };
  }
  for (const part of to.split("/")) {
    if (!isWorkspaceSegment(part)) return { ok: false, code: "invalid", error: `Use a name with letters, digits, spaces, dots, dashes or underscores.` };
  }
  const fromMemory = memoryPathOrNull(from);
  const toMemory = memoryPathOrNull(to);
  // Same-kind memory markdown: journal write then delete (like renameDoc).
  if (fromMemory && toMemory) {
    try {
      const current = readMemoryDoc(botId, fromMemory);
      if (!current.exists) return { ok: false, code: "missing", error: `${from} does not exist.` };
      if (readMemoryDoc(botId, toMemory).exists) return { ok: false, code: "exists", error: `${to} already exists.` };
      journalMemoryWrite(botId, toMemory, current.text, { actor: "person", via: "ui" });
      journalMemoryDelete(botId, fromMemory, { actor: "person", via: "ui" });
      return { ok: true, path: to };
    } catch (error) {
      return refuse(error);
    }
  }
  if (fromMemory || toMemory) {
    return { ok: false, code: "invalid", error: "Move memory and documents only to another markdown path of the same kind." };
  }
  try {
    const source = resolveWorkspaceEntry(botId, from, { mustExist: true, kind: "any" });
    const target = resolveWorkspaceEntry(botId, to, { mustExist: false });
    if (target.stat) return { ok: false, code: "exists", error: `${to} already exists.` };
    mkdirSync(dirname(target.absolute), { recursive: true, mode: 0o700 });
    renameSync(source.absolute, target.absolute);
    sealIfNeeded(botId, target.absolute, to);
    return { ok: true, path: to };
  } catch (error) {
    return refuse(error);
  }
}

/** Delete a file or folder. Core files refused. A non-empty folder needs
 * `recursive: true`; the result carries how many files were removed. */
export function deleteWorkspaceEntry(botId: string, input: unknown, opts: { recursive?: boolean } = {}): WorkspaceManageResult {
  let path: string;
  try {
    path = normaliseWorkspacePath(input);
  } catch (error) {
    return refuse(error);
  }
  if (isCore(path)) return { ok: false, code: "forbidden", error: `${path} cannot be deleted.` };
  const memory = memoryPathOrNull(path);
  if (memory) {
    try {
      const current = readMemoryDoc(botId, memory);
      if (!current.exists) return { ok: false, code: "missing", error: `${path} does not exist.` };
      journalMemoryDelete(botId, memory, { actor: "person", via: "ui" });
      return { ok: true, path, removed: 1 };
    } catch (error) {
      return refuse(error);
    }
  }
  try {
    const entry = resolveWorkspaceEntry(botId, path, { mustExist: true, kind: "any" });
    if (!entry.stat) return { ok: false, code: "missing", error: `${path} does not exist.` };
    if (entry.stat.isFile()) {
      unlinkSync(entry.absolute);
      return { ok: true, path, removed: 1 };
    }
    const files = countWorkspaceFiles(botId, path);
    if (files > 0 && !opts.recursive) {
      return { ok: false, code: "not-empty", error: `${path} still has ${files} file${files === 1 ? "" : "s"}.`, count: files };
    }
    const removed = removeTree(entry.absolute);
    return { ok: true, path, removed };
  } catch (error) {
    return refuse(error);
  }
}

function removeTree(absolute: string): number {
  let removed = 0;
  let names: string[];
  try {
    names = readdirSync(absolute);
  } catch {
    return 0;
  }
  for (const name of names) {
    const child = join(absolute, name);
    let stat: Stats;
    try {
      stat = lstatSync(child);
    } catch {
      continue;
    }
    if (stat.isSymbolicLink()) {
      try { unlinkSync(child); } catch { /* leave */ }
      continue;
    }
    if (stat.isDirectory()) removed += removeTree(child);
    else if (stat.isFile()) {
      unlinkSync(child);
      removed += 1;
    }
  }
  try { rmdirSync(absolute); } catch { /* left if not empty */ }
  return removed;
}

function refuse(error: unknown): WorkspaceManageResult {
  if (error instanceof WorkspacePathError) {
    const code: WorkspaceManageCode = error.status === 404 ? "missing" : "invalid";
    return { ok: false, code, error: error.message };
  }
  if (error instanceof MemoryStoreError) {
    const code: WorkspaceManageCode =
      error.code === "conflict" ? "conflict"
        : error.code === "too-large" ? "too-large"
          : error.code === "forbidden" ? "forbidden"
            : "invalid";
    return { ok: false, code, error: error.message };
  }
  throw error;
}
