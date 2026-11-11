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

/** Every regular file under `root` (absolute and relative path), in walk
 * order. A symlink or a non-regular file is refused and not followed. */
function* workspaceFiles(root: string): Generator<{ abs: string; rel: string }> {
  const base = resolve(root);
  function* visit(dir: string): Generator<{ abs: string; rel: string }> {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      const rel = relative(base, path);
      const resolved = resolve(path);
      if (rel.startsWith("..") || (resolved !== base && !resolved.startsWith(base + sep))) {
        throw new Error(`path escapes the workspace: ${rel}`);
      }
      if (entry.isSymbolicLink()) throw new Error(`refusing a symlink: ${rel}`);
      if (entry.isDirectory()) {
        yield* visit(path);
        continue;
      }
      if (!entry.isFile()) throw new Error(`refusing a non-regular file: ${rel}`);
      yield { abs: path, rel: rel.split(sep).join("/") };
    }
  }
  yield* visit(base);
}

const byPath = (a: WorkspaceFile, b: WorkspaceFile) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

/** Regular files under `root`, relative, sorted. A symlink is refused and not followed. */
export function workspaceManifest(root: string): WorkspaceManifest {
  const files: WorkspaceFile[] = [];
  for (const file of workspaceFiles(root)) files.push({ path: file.rel, ...hashFile(file.abs) });
  files.sort(byPath);
  return { files };
}

/** {@link workspaceManifest} read in slices of at most `sliceMs` of the
 * main thread, giving the event loop back between files (#3619: a plugin's
 * digest is computed on a turn's path when its folder changed). */
export async function workspaceManifestSliced(root: string, sliceMs = 8): Promise<WorkspaceManifest> {
  const files: WorkspaceFile[] = [];
  let sliceStart = performance.now();
  for (const file of workspaceFiles(root)) {
    if (performance.now() - sliceStart >= sliceMs) {
      await yieldToEventLoop();
      sliceStart = performance.now();
    }
    files.push({ path: file.rel, ...hashFile(file.abs) });
  }
  files.sort(byPath);
  return { files };
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
