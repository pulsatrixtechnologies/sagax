// Copy one person's workspace directory onto another and check every file.
// The source is only read. A second run that already matches copies nothing.
// Extra files on the destination are reported and left in place.
import { createHash } from "node:crypto";
import { closeSync, constants, fsyncSync, mkdirSync, openSync, readdirSync, readSync, renameSync, writeSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

import { yieldToEventLoop } from "../harness/http.ts";

export interface WorkspaceFile {
  path: string;
  sha256: string;
  size: number;
}

export interface WorkspaceManifest {
  files: WorkspaceFile[];
}

export interface WorkspaceCopyResult {
  copied: number;
  unchanged: number;
  /** Destination files that are not in the source. Not deleted. */
  extras: string[];
  verified: boolean;
  already: boolean;
}

const CHUNK = 1024 * 1024;

/** One read buffer for every hash: hashFile is synchronous, so it is never
 * shared by two reads at once (#3619: a fresh 1 MiB per file made a large
 * folder's digest mostly allocation). */
let hashBuffer: Buffer | null = null;

function hashFile(path: string): { sha256: string; size: number } {
  const fd = openSync(path, constants.O_RDONLY);
  try {
    const hash = createHash("sha256");
    const buffer = (hashBuffer ??= Buffer.allocUnsafe(CHUNK));
    let size = 0;
    for (;;) {
      const n = readSync(fd, buffer, 0, buffer.length, null);
      if (n === 0) break;
      size += n;
      hash.update(buffer.subarray(0, n));
    }
    return { sha256: hash.digest("hex"), size };
  } finally {
    closeSync(fd);
  }
}

/** One entry of a folder: absolute and relative path ("/" between names)
 * and kind, read from the directory listing alone (never followed). */
interface FolderEntry {
  abs: string;
  rel: string;
  kind: "file" | "dir" | "link" | "other";
  /** a `.git` entry or anything under one */
  git: boolean;
}

/** The one walk of a folder: every entry, depth first, each directory's
 * names in listing order or, `ordered`, sorted with `localeCompare` (the
 * order of a marketplace plugin's revision, #3643). Links are not followed. */
function* folderEntries(base: string, ordered: boolean): Generator<FolderEntry> {
  function* visit(dir: string, prefix: string, git: boolean): Generator<FolderEntry> {
    const entries = readdirSync(dir, { withFileTypes: true });
    if (ordered) entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const abs = join(dir, entry.name);
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      const kind = entry.isSymbolicLink() ? "link" : entry.isDirectory() ? "dir" : entry.isFile() ? "file" : "other";
      const inGit = git || entry.name === ".git";
      yield { abs, rel, kind, git: inGit };
      if (kind === "dir") yield* visit(abs, rel, inGit);
    }
  }
  yield* visit(base, "", false);
}

/** Why a workspace manifest refuses this entry, if it does: a path that
 * leaves the folder, a symlink, or a file that is not a regular file. */
function refusal(base: string, entry: FolderEntry): string | undefined {
  const rel = relative(base, entry.abs);
  const resolved = resolve(entry.abs);
  if (rel.startsWith("..") || (resolved !== base && !resolved.startsWith(base + sep))) return `path escapes the workspace: ${rel}`;
  if (entry.kind === "link") return `refusing a symlink: ${rel}`;
  if (entry.kind === "other") return `refusing a non-regular file: ${rel}`;
  return undefined;
}

/** Every regular file under `root` (absolute and relative path), in walk
 * order. A symlink or a non-regular file is refused and not followed. */
function* workspaceFiles(root: string): Generator<{ abs: string; rel: string }> {
  const base = resolve(root);
  for (const entry of folderEntries(base, false)) {
    const refused = refusal(base, entry);
    if (refused) throw new Error(refused);
    if (entry.kind === "file") yield { abs: entry.abs, rel: entry.rel };
  }
}

const byPath = (a: WorkspaceFile, b: WorkspaceFile) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

/** Regular files under `root`, relative, sorted. A symlink is refused and not followed. */
export function workspaceManifest(root: string): WorkspaceManifest {
  const files: WorkspaceFile[] = [];
  for (const file of workspaceFiles(root)) files.push({ path: file.rel, ...hashFile(file.abs) });
  files.sort(byPath);
  return { files };
}

/** At most this many files are opened between two returns to the event
 * loop (#3643), and at most `SLICE_BYTES` read, whatever the clock says. */
export const SLICE_FILES = 64;
export const SLICE_BYTES = 4 * CHUNK;
/** A marketplace plugin's revision hashes its first 5,000 files. */
const MAX_REVISION_FILES = 5000;

/** What one read of a folder gives: its workspace manifest (null when the
 * folder holds an entry a manifest refuses, and why), and the digest of a
 * marketplace plugin's revision (#3643): every regular file's relative
 * path, a zero byte, its bytes and a zero byte, outside `.git` and links,
 * each directory sorted with `localeCompare`, the first 5,000 files. */
export interface FolderRead {
  manifest: WorkspaceManifest | null;
  refused?: string;
  revision: string;
}

/** The slice every sliced read shares: several folders read at once (a
 * listing of 40 plugins) still read at most `SLICE_FILES` files between two
 * turns of the event loop, not that many each. */
const slice = { start: 0, files: 0, bytes: 0, next: null as Promise<void> | null };

const sliceLeft = (): boolean => slice.files < SLICE_FILES && slice.bytes < SLICE_BYTES;

async function pace(sliceMs: number): Promise<void> {
  if (sliceLeft() && performance.now() - slice.start < sliceMs) return;
  do {
    slice.next ??= yieldToEventLoop().then(() => {
      slice.next = null;
      slice.start = performance.now();
      slice.files = 0;
      slice.bytes = 0;
    });
    await slice.next;
    // another read woken by the same turn may have spent this slice already
  } while (!sliceLeft());
}

/** The one sliced read of a folder: each file is read once, in chunks, and
 * feeds both digests; the event loop is given back after `SLICE_FILES`
 * files, `SLICE_BYTES` bytes (a single large file too) or `sliceMs` of the
 * main thread, whichever comes first, counted over every read running
 * (#3619, #3643). */
export async function readFolderSliced(root: string, sliceMs = 8): Promise<FolderRead> {
  const base = resolve(root);
  const files: WorkspaceFile[] = [];
  const revision = createHash("sha256");
  // its own buffer: this read gives the loop back in the middle of a file
  const buffer = Buffer.allocUnsafe(CHUNK);
  let refused: string | undefined;
  let revisionFiles = 0;
  for (const entry of folderEntries(base, true)) {
    refused ??= refusal(base, entry);
    if (entry.kind !== "file") continue;
    const inRevision = !entry.git && ++revisionFiles <= MAX_REVISION_FILES;
    if (!inRevision && refused) continue;
    await pace(sliceMs);
    slice.files += 1;
    const fd = openSync(entry.abs, constants.O_RDONLY);
    try {
      const hash = refused ? null : createHash("sha256");
      if (inRevision) revision.update(`${entry.rel}\0`);
      let size = 0;
      for (;;) {
        const n = readSync(fd, buffer, 0, buffer.length, null);
        if (n === 0) break;
        size += n;
        slice.bytes += n;
        const chunk = buffer.subarray(0, n);
        hash?.update(chunk);
        if (inRevision) revision.update(chunk);
        await pace(sliceMs);
      }
      if (inRevision) revision.update("\0");
      if (hash && !refused) files.push({ path: entry.rel, sha256: hash.digest("hex"), size });
    } finally {
      closeSync(fd);
    }
  }
  files.sort(byPath);
  return { manifest: refused ? null : { files }, ...(refused ? { refused } : {}), revision: revision.digest("hex") };
}

/** {@link workspaceManifest} read in slices that give the event loop back
 * (#3619: a plugin's digest is computed on a turn's path when its folder
 * changed). */
export async function workspaceManifestSliced(root: string, sliceMs = 8): Promise<WorkspaceManifest> {
  const read = await readFolderSliced(root, sliceMs);
  if (!read.manifest) throw new Error(read.refused);
  return read.manifest;
}

function sameManifest(left: WorkspaceManifest, right: WorkspaceManifest): boolean {
  if (left.files.length !== right.files.length) return false;
  return left.files.every((file, index) => {
    const other = right.files[index]!;
    return file.path === other.path && file.sha256 === other.sha256 && file.size === other.size;
  });
}

function copyFile(from: string, to: string): void {
  mkdirSync(dirname(to), { recursive: true });
  const tmp = `${to}.sagax-copy`;
  const input = openSync(from, constants.O_RDONLY);
  const output = openSync(tmp, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC, 0o644);
  try {
    const buffer = Buffer.alloc(CHUNK);
    for (;;) {
      const n = readSync(input, buffer, 0, buffer.length, null);
      if (n === 0) break;
      let written = 0;
      while (written < n) written += writeSync(output, buffer, written, n - written);
    }
    fsyncSync(output);
  } finally {
    closeSync(input);
    closeSync(output);
  }
  renameSync(tmp, to);
}

/**
 * Make `to` contain every file of `from` with the same bytes. Does not
 * delete or write anything under `from`. Does not remove extra files in `to`.
 * When the trees already match, it writes nothing.
 */
export function copyWorkspace(from: string, to: string): WorkspaceCopyResult {
  const sourceRoot = resolve(from);
  const destRoot = resolve(to);
  if (sourceRoot === destRoot) throw new Error("source and destination are the same directory");
  if (destRoot.startsWith(sourceRoot + sep) || sourceRoot.startsWith(destRoot + sep)) {
    throw new Error("source and destination must not contain one another");
  }
  const before = workspaceManifest(sourceRoot);
  mkdirSync(destRoot, { recursive: true });
  const existing = workspaceManifest(destRoot);
  const existingByPath = new Map(existing.files.map((file) => [file.path, file]));
  if (sameManifest(before, existing)) {
    return { copied: 0, unchanged: before.files.length, extras: [], verified: true, already: true };
  }
  let copied = 0;
  let unchanged = 0;
  for (const file of before.files) {
    const have = existingByPath.get(file.path);
    if (have && have.sha256 === file.sha256 && have.size === file.size) {
      unchanged += 1;
      continue;
    }
    copyFile(join(sourceRoot, file.path), join(destRoot, file.path));
    copied += 1;
  }
  const afterSource = workspaceManifest(sourceRoot);
  if (!sameManifest(before, afterSource)) throw new Error("the source changed while it was copied");
  const afterDest = workspaceManifest(destRoot);
  const destByPath = new Map(afterDest.files.map((file) => [file.path, file]));
  for (const file of before.files) {
    const got = destByPath.get(file.path);
    if (!got || got.sha256 !== file.sha256 || got.size !== file.size) {
      throw new Error(`checksum mismatch after copy: ${file.path}`);
    }
  }
  const sourcePaths = new Set(before.files.map((file) => file.path));
  const extras = afterDest.files.map((file) => file.path).filter((path) => !sourcePaths.has(path));
  return { copied, unchanged, extras, verified: true, already: false };
}
