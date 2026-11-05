// Content encryption at rest for what lives outside messages.db: bot memory
// files, attachments (and the copies made from them) and the event logs
// (docs/content-encryption.md, "Files and logs"). Same keys as the
// transcripts (server/messages/message-db.ts keyring, content_keys): no second key
// store.
//
// Files are sealed IN PLACE (server/encryption/content-file-crypto.ts): same path, a
// sealed header instead of the plain bytes. Every reader in the server opens
// both kinds (readAtRestSync, atRestStream, atRestSizeSync). An engine, a
// separate process reading the path itself, gets the plain file while it
// works: holdPlain() opens the files of a turn back in place before the turn
// starts and releasePlain() hands them back at its end; the migration seals
// them again once nothing holds them and they have been idle for a while
// (GRACE_MS). A new or edited file is written plain, as before, and sealed
// by the same migration a moment later: no write path waits on encryption.
//
// The migration (a background loop, a few milliseconds of work then a
// pause) seals plain files, re-seals a file whose key should change, and,
// with SAGAX_CONTENT_ENCRYPTION=off, opens everything back to plain. Every
// replacement writes a sibling copy, reads it back and compares it byte for
// byte with the original, checks the original did not change meanwhile,
// then renames the copy over it (atomic): a failure, a locked key or a key
// provider that does not answer leaves the original exactly as it was.
//
// Log lines (NDJSON) are sealed one by one (sealLogLine): a small projection
// stays in the clear for the readers' filters, the line itself under its
// thread's (or bot's, or the workspace's) key. A log file is migrated the
// same way: a copy, verified line by line, renamed over the original, with
// the lines appended meanwhile carried over.
import { createHash, createSecretKey, randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
  writeSync,
  type Stats,
} from "node:fs";
import { appendFile, chmod, link, lstat, open as openHandle, rename, unlink, utimes, type FileHandle } from "node:fs/promises";
import { basename, dirname, join, relative, sep } from "node:path";
import { Readable } from "node:stream";

import { DATA_DIR } from "../config.ts";
import { ContentSealError } from "./content-crypto.ts";
import type { ExportedContentKey } from "../content-export.ts";
import { ContentKeyUnavailable, WORKSPACE_OWNER, type LiveKey } from "./content-keys.ts";
import {
  CHUNK_OVERHEAD,
  FileSealer,
  chunkCount,
  looksSealed,
  openBuffer,
  openChunk,
  parseHeader,
  plainSizeOf,
  sealBuffer,
  BLOCK_ID_CHARS,
  BLOCK_PREFIX,
  PLACEHOLDER_LENGTH,
  openBlock,
  parseBlockLine,
  sealBlock,
  type BlockLine,
  type FileKey,
  type SealedHeader,
} from "./content-file-crypto.ts";
import { contentAutoMigrate, contentEncryptionOn, contentKeyById, contentKeyForBot, contentKeyForOwner, contentKeyForThread, contentOwnerOfThread, onContentAtRest } from "../messages/message-db.ts";

export type ContentScope = { thread: string } | { bot: string } | { owner: string };

/** A sealed file whose key was destroyed (its owner erased): it reads as a
 * file that is not there. */
export class ContentErased extends Error {
  readonly code = "ENOENT";
  constructor() {
    super("This content was erased.");
  }
}

/** An error that must never read as an empty or missing file: a key locked
 * on this launch, or a sealed file that does not open here. A caller that
 * would write over what it read (a memory update) must let it through. */
export function isAtRestRefusal(error: unknown): boolean {
  return error instanceof ContentKeyUnavailable || error instanceof ContentSealError;
}

// ---------------------------------------------------------------------------
// Keys

let exported: { keys: Map<string, FileKey>; stored: Set<string> } | null = null;

/** A backup worker opens with the keys the server handed it (in memory),
 * never with the live keyring. `stored`: every key id the database had, so
 * a key that exists but was not handed over fails the backup instead of
 * reading as erased. Null restores the keyring. */
export function useExportedContentKeys(keys: readonly ExportedContentKey[] | null, stored: Iterable<string> = []): void {
  exported = keys
    ? { keys: new Map(keys.map((key) => [key.keyId, { keyId: key.keyId, owner: key.owner, dek: createSecretKey(Buffer.from(key.raw)) }])), stored: new Set(stored) }
    : null;
}

const fileKeys = new WeakMap<LiveKey, FileKey>();
function asFileKey(key: LiveKey): FileKey {
  let out = fileKeys.get(key);
  if (!out) fileKeys.set(key, (out = { keyId: key.keyId, owner: key.owner, dek: key.dek }));
  return out;
}

function keyById(keyId: string): FileKey | "destroyed" | null {
  if (exported) {
    const key = exported.keys.get(keyId);
    if (key) return key;
    return exported.stored.has(keyId) ? null : "destroyed";
  }
  const key = contentKeyById(keyId);
  return key === "destroyed" || key === null ? key : asFileKey(key);
}

/** The key new content of this scope is sealed with; null: write it plain
 * (encryption off, the key not available yet). */
export function sealingKey(scope: ContentScope): FileKey | null {
  if (exported) return null;
  const live = "thread" in scope ? contentKeyForThread(scope.thread) : "bot" in scope ? contentKeyForBot(scope.bot) : contentKeyForOwner(scope.owner);
  return live ? asFileKey(live) : null;
}

function openingKey(keyId: string): FileKey {
  const key = keyById(keyId);
  if (key === "destroyed") throw new ContentErased();
  if (!key) throw new ContentKeyUnavailable();
  return key;
}

// ---------------------------------------------------------------------------
// Where sealed files live: a root and the context its files are bound to

interface AtRestRoot {
  id: string;
  dir: string;
  /** the context of a file, from its path under `dir` (posix separators) */
  context(relativePath: string): string;
  /** the files the migration looks after, with whose key each takes */
  files(): Iterable<{ path: string; scope: ContentScope }>;
  /** at an owner's erasure: whether a file sealed under their key is still
   * someone else's (re-sealed under its scope) rather than theirs (erased).
   * Absent: re-sealed when its scope's key is another's. */
  keepOnErase?(path: string): boolean;
  /** a sealed file keeps the key it was sealed with (its owner is known only
   * when it is written: an upload's person) instead of following its scope */
  stickyKeys?: boolean;
}

const roots: AtRestRoot[] = [];

/** server/workspace/workspace.ts (memory) and server/attachments/attachments.ts register theirs. */
export function registerAtRestRoot(root: AtRestRoot): void {
  const index = roots.findIndex((entry) => entry.id === root.id);
  if (index >= 0) roots[index] = root;
  else roots.push(root);
  scheduleAtRest();
}

const realRoots = new Map<string, string>();
function realDir(dir: string): string {
  let real = realRoots.get(dir);
  if (real === undefined) {
    try { real = realpathSync(dir); } catch { return dir; }
    realRoots.set(dir, real);
  }
  return real;
}

function under(dir: string, path: string): string | null {
  const rel = relative(dir, path);
  return rel && !rel.startsWith("..") && !rel.startsWith(sep) && !/^[A-Za-z]:/.test(rel) ? rel.split(sep).join("/") : null;
}

/** The root a path is in, by its spelling or by the root's real path (a
 * caller that resolved links, /var and /private/var on macOS). */
function rootOf(path: string): { root: AtRestRoot; relativePath: string } | null {
  for (const root of roots) {
    const rel = under(root.dir, path) ?? under(realDir(root.dir), path);
    if (rel) return { root, relativePath: rel };
  }
  return null;
}

/** The context a file at `path` is sealed under: what it is, so a sealed
 * file moved elsewhere does not open. */
export function contextFor(path: string): string {
  const found = rootOf(path);
  return found ? found.root.context(found.relativePath) : `file:${basename(path)}`;
}

/** The temporary sibling of a replacement: hidden, never listed as content. */
const TEMP_SUFFIX = ".sgx-tmp";
export function isAtRestTemp(name: string): boolean {
  return name.endsWith(TEMP_SUFFIX);
}
const tempFor = (path: string) => join(dirname(path), `.${basename(path)}.${randomUUID().slice(0, 8)}${TEMP_SUFFIX}`);

// ---------------------------------------------------------------------------
// Reading files, sealed or plain

/** Open sealed bytes (a whole small file); plain bytes come back as they are. */
export function openIfSealed(bytes: Buffer, path: string): Buffer {
  // only the folders sealed at rest hold sealed files: anything else is read as it is
  if (!looksSealed(bytes) || !rootOf(path)) return bytes;
  const header = parseHeader(bytes)!;
  return openBuffer(bytes, openingKey(header.keyId), contextFor(path));
}

/** readFileSync for a file that may be sealed (small files: memory, a
 * manifest, a picture). Throws like readFileSync; ContentErased (ENOENT)
 * for erased content, ContentKeyUnavailable (503) when its key is locked. */
// Small sealed files a reader just opened (MEMORY.md is read at every turn):
// kept opened in memory while the file is unchanged, at most 5 minutes and
// 8 MB in all, emptied with the rest when a key changes or goes.
const OPENED_MAX_FILE = 256 * 1024;
const OPENED_BYTES = 8 * 1024 * 1024;
const opened = new Map<string, { ino: number; size: number; mtimeMs: number; at: number; plain: Buffer }>();
let openedBytes = 0;

function forgetOpened(): void {
  opened.clear();
  openedBytes = 0;
}

export function readAtRestSync(path: string, fd?: number): Buffer {
  if (fd === undefined && rootOf(path)) {
    let stat: Stats | null = null;
    try { stat = statSync(path); } catch { stat = null; }
    const known = stat ? opened.get(path) : undefined;
    if (stat && known && known.ino === stat.ino && known.size === stat.size && known.mtimeMs === stat.mtimeMs && Date.now() - known.at < BLOCK_CACHE_MS) return known.plain;
    const bytes = readFileSync(path);
    const plain = openIfSealed(bytes, path);
    if (stat && plain !== bytes && bytes.length === stat.size && bytes.length <= OPENED_MAX_FILE) {
      const old = opened.get(path);
      if (old) openedBytes -= old.plain.length;
      opened.set(path, { ino: stat.ino, size: stat.size, mtimeMs: stat.mtimeMs, at: Date.now(), plain });
      openedBytes += plain.length;
      for (const [name, entry] of opened) { if (openedBytes <= OPENED_BYTES) break; opened.delete(name); openedBytes -= entry.plain.length; }
    }
    return plain;
  }
  return openIfSealed(readFileSync(fd ?? path), path);
}

export function readAtRestTextSync(path: string, fd?: number): string {
  return readAtRestSync(path, fd).toString("utf8");
}

export async function readAtRest(path: string): Promise<Buffer> {
  const handle = await openHandle(path, "r");
  try {
    const file = await describeHandle(handle, path);
    if (!file.sealed) return await handle.readFile();
    const parts: Buffer[] = [];
    for await (const part of plainChunks(handle, file, 0, file.size - 1)) parts.push(part);
    return Buffer.concat(parts);
  } finally {
    await handle.close().catch(() => undefined);
  }
}

function headerOfFd(fd: number, size: number): SealedHeader | null {
  if (size < 5) return null;
  const head = Buffer.allocUnsafe(Math.min(size, 512));
  const read = readSync(fd, head, 0, head.length, 0);
  if (!looksSealed(head.subarray(0, read))) return null;
  try { return parseHeader(head.subarray(0, read)); }
  catch {
    const longer = Buffer.allocUnsafe(Math.min(size, 9 + 255 + 65535));
    const n = readSync(fd, longer, 0, longer.length, 0);
    return parseHeader(longer.subarray(0, n));
  }
}

/** Whether a file is sealed, and its plaintext size. Null when missing. */
export function atRestInfoSync(path: string): { sealed: boolean; size: number; keyId: string | null; stat: Stats } | null {
  let fd: number;
  try { fd = openSync(path, "r"); } catch { return null; }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) return null;
    const header = rootOf(path) ? headerOfFd(fd, stat.size) : null;
    if (!header) return { sealed: false, size: stat.size, keyId: null, stat };
    return { sealed: true, size: plainSizeOf(header, stat.size), keyId: header.keyId, stat };
  } catch {
    return null;
  } finally {
    closeSync(fd);
  }
}

const sizeCache = new Map<string, { ino: number; size: number; mtimeMs: number; plain: number }>();
/** The plaintext size of a file whose stat the caller already holds: from
 * a cache while the file is unchanged (a listing stats every file, and
 * would otherwise open each one again). */
export function plainSizeFor(path: string, stat: Pick<Stats, "ino" | "size" | "mtimeMs">): number {
  if (stat.size < 5) return stat.size;
  const known = sizeCache.get(path);
  if (known && known.ino === stat.ino && known.size === stat.size && known.mtimeMs === stat.mtimeMs) return known.plain;
  const info = atRestInfoSync(path);
  const plain = info?.size ?? stat.size;
  if (sizeCache.size > 20_000) sizeCache.clear();
  sizeCache.set(path, { ino: stat.ino, size: stat.size, mtimeMs: stat.mtimeMs, plain });
  return plain;
}

/** The plaintext size of a file (its own size when plain). */
export function atRestSizeSync(path: string): number {
  const info = atRestInfoSync(path);
  if (!info) throw Object.assign(new Error(`ENOENT: no such file, '${path}'`), { code: "ENOENT" });
  return info.size;
}

export interface AtRestHandleFile {
  sealed: boolean;
  /** plaintext bytes */
  size: number;
  header: SealedHeader | null;
  fileSize: number;
  key: FileKey | null;
  context: string;
}

/** What an open handle holds; throws ContentErased / ContentKeyUnavailable. */
export async function describeHandle(handle: FileHandle, path: string): Promise<AtRestHandleFile> {
  const stat = await handle.stat();
  const context = contextFor(path);
  if (stat.size < 5) return { sealed: false, size: stat.size, header: null, fileSize: stat.size, key: null, context };
  // only the folders sealed at rest hold sealed files: anything else is read as it is
  if (!rootOf(path)) return { sealed: false, size: stat.size, header: null, fileSize: stat.size, key: null, context };
  const head = Buffer.allocUnsafe(Math.min(stat.size, 512));
  const { bytesRead } = await handle.read(head, 0, head.length, 0);
  if (!looksSealed(head.subarray(0, bytesRead))) return { sealed: false, size: stat.size, header: null, fileSize: stat.size, key: null, context };
  let header: SealedHeader | null;
  try { header = parseHeader(head.subarray(0, bytesRead)); }
  catch {
    const longer = Buffer.allocUnsafe(Math.min(stat.size, 9 + 255 + 65535));
    const again = await handle.read(longer, 0, longer.length, 0);
    header = parseHeader(longer.subarray(0, again.bytesRead));
  }
  if (!header) return { sealed: false, size: stat.size, header: null, fileSize: stat.size, key: null, context };
  if (header.context !== context) throw new ContentSealError("unreadable");
  return { sealed: true, size: plainSizeOf(header, stat.size), header, fileSize: stat.size, key: openingKey(header.keyId), context };
}

/** The plaintext of [start, end] (inclusive) of a sealed file, chunk by
 * chunk: only the chunks the range covers are read and opened. */
async function* plainChunks(handle: FileHandle, file: AtRestHandleFile, start: number, end: number): AsyncGenerator<Buffer> {
  if (end < start) return;
  const header = file.header!;
  const stride = header.chunkBytes + CHUNK_OVERHEAD;
  const count = chunkCount(header, file.fileSize);
  const first = Math.floor(start / header.chunkBytes);
  const last = Math.min(count - 1, Math.floor(end / header.chunkBytes));
  // up to 16 chunks (1 MiB) per read: fewer system calls on a long file
  const batch = Buffer.allocUnsafe(stride * Math.min(16, last - first + 1));
  for (let index = first; index <= last;) {
    const n = Math.min(16, last - index + 1);
    const offset = header.length + index * stride;
    const length = Math.min(stride * n, file.fileSize - offset);
    let filled = 0;
    while (filled < length) {
      const { bytesRead } = await handle.read(batch, filled, length - filled, offset + filled);
      if (bytesRead === 0) throw new ContentSealError("malformed");
      filled += bytesRead;
    }
    for (let k = 0; k < n; k++, index++) {
      const sealed = batch.subarray(k * stride, Math.min(length, (k + 1) * stride));
      const plain = openChunk(file.key!, header.context, index, index === count - 1, sealed);
      const chunkStart = index * header.chunkBytes;
      const from = Math.max(0, start - chunkStart);
      const to = Math.min(plain.length, end - chunkStart + 1);
      yield from === 0 && to === plain.length ? plain : plain.subarray(from, to);
    }
  }
}

/** A readable of the plaintext [start, end] of an open file, sealed or
 * plain. The handle is closed when the stream ends or is destroyed. */
export function atRestStream(handle: FileHandle, file: AtRestHandleFile, start = 0, end = file.size - 1, autoClose = true): Readable {
  if (!file.sealed) return handle.createReadStream({ start, end, autoClose });
  const source = plainChunks(handle, file, start, end);
  const close = () => { if (autoClose) void handle.close().catch(() => undefined); };
  const stream = Readable.from((async function* () {
    try { yield* source; } finally { close(); }
  })(), { objectMode: false });
  stream.on("close", () => { void source.return(undefined).catch(() => undefined); close(); });
  return stream;
}

/** The whole plaintext of an open file (small files only). */
export async function readAllFromHandle(handle: FileHandle, file: AtRestHandleFile): Promise<Buffer> {
  if (!file.sealed) return await handle.readFile();
  const parts: Buffer[] = [];
  for await (const part of plainChunks(handle, file, 0, file.size - 1)) parts.push(part);
  return Buffer.concat(parts);
}

/** The plaintext of a file as chunks (a copy to another machine, a hash). */
export async function* atRestChunks(path: string): AsyncGenerator<Buffer> {
  const handle = await openHandle(path, "r");
  try {
    const file = await describeHandle(handle, path);
    if (!file.sealed) {
      const buffer = Buffer.allocUnsafe(256 * 1024);
      for (let position = 0; ;) {
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
        if (!bytesRead) break;
        position += bytesRead;
        yield Buffer.from(buffer.subarray(0, bytesRead));
      }
      return;
    }
    yield* plainChunks(handle, file, 0, file.size - 1);
  } finally {
    await handle.close().catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// Replacing a file in place, verified

const locks = new Map<string, Promise<unknown>>();
function withLock<T>(path: string, work: () => Promise<T>): Promise<T> {
  const previous = locks.get(path) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(work);
  const tail = run.catch(() => undefined);
  locks.set(path, tail);
  void tail.then(() => { if (locks.get(path) === tail) locks.delete(path); });
  return run;
}

/** Two chunk streams hold the same bytes. */
async function sameBytes(a: AsyncIterable<Buffer>, b: AsyncIterable<Buffer>): Promise<boolean> {
  const left = a[Symbol.asyncIterator]();
  const right = b[Symbol.asyncIterator]();
  let x: Buffer = Buffer.alloc(0);
  let y: Buffer = Buffer.alloc(0);
  let doneX = false;
  let doneY = false;
  try {
    for (;;) {
      while (!doneX && x.length < 65536) {
        const next = await left.next();
        if (next.done) doneX = true;
        else x = x.length ? Buffer.concat([x, next.value]) : next.value;
      }
      while (!doneY && y.length < 65536) {
        const next = await right.next();
        if (next.done) doneY = true;
        else y = y.length ? Buffer.concat([y, next.value]) : next.value;
      }
      const n = Math.min(x.length, y.length);
      if (n === 0) return doneX && doneY && x.length === 0 && y.length === 0;
      if (!x.subarray(0, n).equals(y.subarray(0, n))) return false;
      x = x.subarray(n);
      y = y.subarray(n);
    }
  } finally {
    await left.return?.(undefined);
    await right.return?.(undefined);
  }
}

/** Run `work` while no migration rewrites `file` (a log's own rewrite). */
export function withLogFileLock<T>(file: string, work: () => Promise<T>): Promise<T> {
  return withLock(file, work);
}

let testFault: ((temp: string, original: string) => void) | null = null;
/** Test seam: called between writing a replacement and reading it back. */
export function setAtRestFaultForTests(fault: ((temp: string, original: string) => void) | null): void {
  testFault = fault;
}

export type ReplaceOutcome = "done" | "changed" | "held" | "locked" | "skipped";

const sameFile = (a: Stats, b: Stats) => a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs;

/** Rewrite one file in place: sealed under `to` (a key), or plain (`to`
 * null). Reads the original as plaintext (opening it if sealed), writes a
 * sibling, reads the sibling back and compares it with the original byte
 * for byte, checks the original is unchanged and not held by a turn, then
 * renames. Anything else leaves the original untouched. */
/** Opening a file for a turn skips the fsync (a turn must not wait on
 * the disk): the sealed original stays as a hard link here until the file
 * is sealed again, so a power cut that leaves the plain copy empty or
 * zeroed restores it (recoverOriginal). */
const ORIGINALS_DIR = () => join(DATA_DIR, ".at-rest-originals");
const originalOf = (path: string) => join(ORIGINALS_DIR(), createHash("sha256").update(path).digest("hex"));

/** Drop the kept original of a file that was sealed again or removed. */
function forgetOriginal(path: string): void {
  try { unlinkSync(originalOf(path)); } catch { /* none */ }
  try { unlinkSync(`${originalOf(path)}.path`); } catch { /* none */ }
}

/** Originals whose file is gone (a bot, a thread or an upload deleted):
 * removed, so nothing sealed outlives what it was a copy of. */
function sweepOriginals(): void {
  let names: string[];
  try { names = readdirSync(ORIGINALS_DIR()); } catch { return; }
  for (const name of names) {
    if (!name.endsWith(".path")) continue;
    let path: string;
    try { path = readFileSync(join(ORIGINALS_DIR(), name), "utf8"); } catch { continue; }
    if (!held(path)) recoverOriginal(path);
  }
}

/** A plain copy that a power cut left empty or zeroed gets its sealed
 * original back; a file removed meanwhile lets the original go. */
function recoverOriginal(path: string): void {
  const original = originalOf(path);
  let kept: Stats;
  try { kept = lstatSync(original); } catch { return; }
  if (!kept.isFile()) return;
  let current: Stats | null = null;
  try { current = lstatSync(path); } catch { current = null; }
  if (!current) { forgetOriginal(path); return; }
  let torn = current.size === 0;
  if (!torn && current.size <= 64 * 1024 * 1024) {
    try { torn = !readFileSync(path).some((byte) => byte !== 0); } catch { torn = false; }
  }
  if (torn) {
    try { renameSync(original, path); } catch { return; /* left for the next pass */ }
    try { unlinkSync(`${original}.path`); } catch { /* none */ }
  }
}

export function replaceInPlace(path: string, to: FileKey | null, options: { quick?: boolean } = {}): Promise<ReplaceOutcome> {
  return withLock(path, async () => {
    let before: Stats;
    try { before = await lstat(path); } catch { return "skipped"; }
    if (!before.isFile()) return "skipped";
    const context = contextFor(path);
    const temp = tempFor(path);
    let out: FileHandle | null = null;
    try {
      const source = await openHandle(path, "r");
      let file: AtRestHandleFile;
      try {
        try { file = await describeHandle(source, path); }
        catch (error) { return error instanceof ContentKeyUnavailable ? "locked" : "skipped"; }
        if (!file.sealed && !to) return "skipped";
        if (file.sealed && to && file.header!.keyId === to.keyId) return "skipped";
        out = await openHandle(temp, "wx", 0o600);
        const sealer = to ? new FileSealer(to, context) : null;
        const write = async (parts: Buffer[]) => { for (const part of parts) await out!.write(part); };
        const chunks = file.sealed ? plainChunks(source, file, 0, file.size - 1) : atRestChunksOfHandle(source, file.size);
        for await (const chunk of chunks) await write(sealer ? sealer.push(chunk) : [chunk]);
        if (sealer) await write(sealer.end());
        if (!options.quick || to) await out.sync();
        await out.close();
        out = null;
      } finally {
        await source.close().catch(() => undefined);
      }
      testFault?.(temp, path);
      // read back: the copy opens to exactly the original's bytes
      if (!(await sameBytes(atRestChunksExpecting(temp, context, to?.keyId ?? null), atRestChunks(path)))) return "skipped";
      // never sealed while a turn holds it plain (opening it is what a hold wants)
      if (to && held(path)) return "held";
      let now: Stats;
      try { now = await lstat(path); } catch { return "changed"; }
      if (!sameFile(before, now)) return "changed";
      await chmod(temp, before.mode & 0o777);
      await utimes(temp, before.atimeMs / 1000, before.mtimeMs / 1000);
      let kept = false;
      if (options.quick && !to) {
        // the sealed original, kept (a link: no copy) until sealed again
        try {
          mkdirSync(ORIGINALS_DIR(), { recursive: true, mode: 0o700 });
          forgetOriginal(path);
          await link(path, originalOf(path));
          writeFileSync(`${originalOf(path)}.path`, path, { mode: 0o600 });
          kept = true;
        } catch {
          // no hard links on this disk: the copy is made durable instead
          const handle = await openHandle(temp, "r+");
          try { await handle.sync(); } finally { await handle.close(); }
        }
      }
      await rename(temp, path);
      if (!kept) forgetOriginal(path);
      return "done";
    } catch {
      return "skipped";
    } finally {
      if (out) await out.close().catch(() => undefined);
      await unlink(temp).catch(() => undefined);
    }
  });
}

async function* atRestChunksOfHandle(handle: FileHandle, size: number): AsyncGenerator<Buffer> {
  const buffer = Buffer.allocUnsafe(256 * 1024);
  for (let position = 0; position < size;) {
    const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, size - position), position);
    if (!bytesRead) break;
    position += bytesRead;
    yield Buffer.from(buffer.subarray(0, bytesRead));
  }
}

/** The copy's plaintext, refusing a copy that is not what was asked for. */
async function* atRestChunksExpecting(path: string, context: string, keyId: string | null): AsyncGenerator<Buffer> {
  const handle = await openHandle(path, "r");
  try {
    const stat = await handle.stat();
    const head = Buffer.allocUnsafe(Math.min(stat.size, 512));
    const { bytesRead } = await handle.read(head, 0, head.length, 0);
    const sealed = looksSealed(head.subarray(0, bytesRead));
    if (sealed !== (keyId !== null)) throw new ContentSealError("malformed");
    if (!sealed) { yield* atRestChunksOfHandle(handle, stat.size); return; }
    const header = parseHeader(head.subarray(0, bytesRead))!;
    if (header.context !== context || header.keyId !== keyId) throw new ContentSealError("malformed");
    yield* plainChunks(handle, { sealed: true, size: plainSizeOf(header, stat.size), header, fileSize: stat.size, key: openingKey(header.keyId), context }, 0, plainSizeOf(header, stat.size) - 1);
  } finally {
    await handle.close().catch(() => undefined);
  }
}

/** The synchronous replacement, for small files (memory) where a turn
 * cannot wait: same steps, same verification. */
export function replaceInPlaceSync(path: string, to: FileKey | null): ReplaceOutcome {
  let before: Stats;
  try { before = lstatSync(path); } catch { return "skipped"; }
  if (!before.isFile()) return "skipped";
  const context = contextFor(path);
  let original: Buffer;
  let plain: Buffer;
  try {
    original = readFileSync(path);
    plain = openIfSealed(original, path);
  } catch (error) {
    return error instanceof ContentKeyUnavailable ? "locked" : "skipped";
  }
  const sealedNow = plain !== original;
  if (!sealedNow && !to) return "skipped";
  if (sealedNow && to && parseHeader(original)!.keyId === to.keyId) return "skipped";
  const next = to ? sealBuffer(to, context, plain) : plain;
  const temp = tempFor(path);
  let fd: number | null = null;
  try {
    fd = openSync(temp, "wx", 0o600);
    for (let written = 0; written < next.length;) written += writeSync(fd, next, written, next.length - written);
    fsyncSync(fd);
    closeSync(fd);
    fd = null;
    // read back: the copy opens to exactly the original's bytes
    const copy = readFileSync(temp);
    const reopened = to ? openBuffer(copy, to, context) : copy;
    if (!reopened.equals(plain)) return "skipped";
    if (to && parseHeader(copy)?.keyId !== to.keyId) return "skipped";
    if (to && held(path)) return "held";
    const now = lstatSync(path);
    if (!sameFile(before, now)) return "changed";
    utimesSync(temp, before.atimeMs / 1000, before.mtimeMs / 1000);
    renameSync(temp, path);
    forgetOriginal(path);
    return "done";
  } catch {
    return "skipped";
  } finally {
    if (fd !== null) { try { closeSync(fd); } catch { /* closed */ } }
    try { unlinkSync(temp); } catch { /* renamed or never made */ }
  }
}

// ---------------------------------------------------------------------------
// Plain while a turn works on it

/** How long a file stays plain after its last use or write before the
 * migration seals it: a conversation's next turn usually comes sooner, so
 * its files are opened once per stretch of work, not at every turn. */
export const GRACE_MS = 10 * 60_000;
const holders = new Map<string, Set<string>>();
/** A turn that never said it ended (a crash of its engine) lets go after this. */
const HOLD_MAX_MS = 6 * 60 * 60_000;
const holderSince = new Map<string, number>();
/** A turn that set up its files but never started (refused, cancelled)
 * lets go once this old if its holder is no longer running. */
const HOLD_SETUP_MS = 10 * 60_000;
let holderAlive: (holder: string) => boolean = () => true;

/** server/index.ts: whether a holder's turn still runs. */
export function setAtRestHolderCheck(alive: (holder: string) => boolean): void {
  holderAlive = alive;
}
const holdCount = new Map<string, number>();
const lastUse = new Map<string, number>();
/** SAGAX_CONTENT_AT_REST_GRACE_MS: another idle time before sealing (a
 * verification fixture uses a second). */
const graceFromEnv = Number(process.env.SAGAX_CONTENT_AT_REST_GRACE_MS?.trim() || NaN);
let graceMs = Number.isInteger(graceFromEnv) && graceFromEnv >= 0 ? graceFromEnv : GRACE_MS;
/** Soft cap so a long-lived org server cannot retain a hint per historical
 * upload forever even if a pass misses a path. */
const AT_REST_HINT_MAX = 10_000;

function forgetAtRestHint(path: string): void {
  lastUse.delete(path);
  scopeHints.delete(path);
}

/** Drop sealed or missing entries; if still over the cap, drop the oldest. */
function pruneAtRestHints(): void {
  for (const path of lastUse.keys()) {
    try {
      if (!existsSync(path)) { forgetAtRestHint(path); continue; }
      if (atRestInfoSync(path)?.sealed) forgetAtRestHint(path);
    } catch { forgetAtRestHint(path); }
  }
  for (const path of scopeHints.keys()) {
    if (lastUse.has(path)) continue;
    try {
      if (!existsSync(path) || atRestInfoSync(path)?.sealed) scopeHints.delete(path);
    } catch { scopeHints.delete(path); }
  }
  if (lastUse.size <= AT_REST_HINT_MAX && scopeHints.size <= AT_REST_HINT_MAX) return;
  const oldest = Array.from(lastUse.entries()).sort((a, b) => a[1] - b[1]);
  while (lastUse.size > AT_REST_HINT_MAX && oldest.length) {
    const path = oldest.shift()?.[0];
    if (path) forgetAtRestHint(path);
  }
  if (scopeHints.size > AT_REST_HINT_MAX) {
    for (const path of Array.from(scopeHints.keys())) {
      if (scopeHints.size <= AT_REST_HINT_MAX) break;
      if (!lastUse.has(path)) scopeHints.delete(path);
    }
  }
}

/** Test seam: sizes of the in-memory write/use maps. */
export function atRestHintSizesForTests(): { lastUse: number; scopeHints: number } {
  return { lastUse: lastUse.size, scopeHints: scopeHints.size };
}

/** Test seam. */
export function setAtRestGrace(ms: number): void {
  graceMs = ms;
}

function held(path: string): boolean {
  return (holdCount.get(path) ?? 0) > 0;
}

function hold(holder: string, paths: readonly string[]): string[] {
  let set = holders.get(holder);
  if (!set) holders.set(holder, (set = new Set()));
  holderSince.set(holder, Date.now());
  const added: string[] = [];
  for (const path of paths) {
    if (set.has(path)) continue;
    set.add(path);
    holdCount.set(path, (holdCount.get(path) ?? 0) + 1);
    added.push(path);
  }
  return added;
}

/** Files an engine reads by path during a turn (`holder`: the thread):
 * opened back to plain in place now, kept plain until releasePlain. Small
 * files only (memory); attachments go through holdPlain. */
export function holdPlainSync(holder: string, paths: readonly string[]): void {
  for (const path of hold(holder, paths)) {
    const info = atRestInfoSync(path);
    if (info?.sealed) replaceInPlaceSync(path, null);
  }
}

const opening = new Map<string, Promise<unknown>>();

/** The same for files of any size, opened as streams. Resolves once every
 * one of `paths` is open (one another holder was opening included). */
export async function holdPlain(holder: string, paths: readonly string[]): Promise<void> {
  for (const path of hold(holder, paths)) {
    if (opening.has(path)) continue;
    const info = atRestInfoSync(path);
    if (!info?.sealed) continue;
    const run = replaceInPlace(path, null, { quick: true }).finally(() => { if (opening.get(path) === run) opening.delete(path); });
    opening.set(path, run);
  }
  await waitPlain(paths);
}

/** Wait until those of `paths` being opened for a turn are open. */
export async function waitPlain(paths: readonly string[]): Promise<void> {
  await Promise.all(paths.map((path) => opening.get(path)).filter((run): run is Promise<unknown> => Boolean(run)));
}

/** The turn ended: its files are sealed again once idle (GRACE_MS). */
export function releasePlain(holder: string): void {
  const set = holders.get(holder);
  if (!set) return;
  holders.delete(holder);
  holderSince.delete(holder);
  const now = Date.now();
  for (const path of set) {
    const count = (holdCount.get(path) ?? 1) - 1;
    if (count > 0) holdCount.set(path, count);
    else holdCount.delete(path);
    lastUse.set(path, now);
  }
  scheduleAtRest(graceMs + 50);
}

/** A file written plain by the server (an upload, a memory edit): sealed
 * once idle. `scope` overrides its root's default key (the uploader). */
export function noteAtRestWrite(path: string, scope?: ContentScope): void {
  lastUse.set(path, Date.now());
  if (scope) scopeHints.set(path, scope);
  scheduleAtRest(graceMs + 50);
}
const scopeHints = new Map<string, ContentScope>();

/** Whose key a file takes: a hint left by its writer, else its root's. */
function scopeFor(path: string, fallback: ContentScope): ContentScope {
  return scopeHints.get(path) ?? fallback;
}

// ---------------------------------------------------------------------------
// Log lines (format in server/encryption/content-file-crypto.ts: one physical line per
// record, records sealed together in blocks)

interface SealedLogSpec {
  dir: string;
  /** whose key a record takes (its thread, its bot, the workspace) */
  scope(record: Record<string, unknown>, file: string): ContentScope;
  /** the fields a reader filters on before opening, kept in the clear */
  projection(record: Record<string, unknown>): Record<string, unknown>;
  /** the key is the file's (a thread's or a bot's log), not each row's */
  perFile?: boolean;
}

const logs: SealedLogSpec[] = [];

/** A log whose lines are sealed: harness/bus.ts (events/), drivers/native.ts
 * (native/), memory-journal.ts, decision-log.ts, admin-activity.ts. */
export function registerSealedLog(spec: SealedLogSpec): void {
  const index = logs.findIndex((entry) => entry.dir === spec.dir);
  if (index >= 0) logs[index] = spec;
  else logs.push(spec);
}

function logOf(file: string): SealedLogSpec | null {
  const dir = dirname(file);
  return logs.find((entry) => entry.dir === dir) ?? null;
}

/** The context of a log's lines: its folder and file name. */
export function logContext(file: string): string {
  return `${basename(dirname(file))}/${basename(file)}`;
}

/** The most records one block holds. */
const BLOCK_MAX = 256;
/** A migration rewrites a log into blocks of this many records. */
const BLOCK_COMPACT = 64;

/** Records as the physical lines to append (no newlines): consecutive
 * records under one key sealed as one block, a record without a key (off,
 * not available yet) as its plain JSON, as before. */
// The blocks a reader may ask for again soon, opened (in memory only): what
// a writer of this process just sealed (it held the text already) and what
// a reader just opened, for as long as a view of the log lasts. Bounded in
// bytes and in time, emptied when a key changes or goes, and a file's
// entries go when the migration rewrites it. Never consulted by the
// migration's own read-back, which always opens from the disk.
const BLOCK_CACHE_BYTES = 16 * 1024 * 1024;
const BLOCK_CACHE_MS = 5 * 60_000;
const blockCache = new Map<string, { lines: string[]; bytes: number; at: number; file: string }>();
let blockCacheBytes = 0;

function cacheBlock(blockId: string, file: string, lines: string[]): void {
  const bytes = lines.reduce((sum, line) => sum + line.length * 2, 64);
  if (bytes > BLOCK_CACHE_BYTES / 8) return;
  const old = blockCache.get(blockId);
  if (old) { blockCacheBytes -= old.bytes; blockCache.delete(blockId); }
  blockCache.set(blockId, { lines, bytes, at: Date.now(), file });
  blockCacheBytes += bytes;
  const now = Date.now();
  for (const [id, entry] of blockCache) {
    if (blockCacheBytes <= BLOCK_CACHE_BYTES && now - entry.at < BLOCK_CACHE_MS) break;
    blockCache.delete(id);
    blockCacheBytes -= entry.bytes;
  }
}

function cachedBlock(blockId: string): string[] | null {
  const entry = blockCache.get(blockId);
  if (!entry) return null;
  if (Date.now() - entry.at >= BLOCK_CACHE_MS) { blockCache.delete(blockId); blockCacheBytes -= entry.bytes; return null; }
  // most recently used last
  blockCache.delete(blockId);
  entry.at = Date.now();
  blockCache.set(blockId, entry);
  return entry.lines;
}

function forgetCachedBlocks(file?: string): void {
  forgetTails(file);
  if (!file) forgetOpened();
  if (!file) { blockCache.clear(); blockCacheBytes = 0; return; }
  for (const [id, entry] of blockCache) if (entry.file === file) { blockCache.delete(id); blockCacheBytes -= entry.bytes; }
}

// The tail of a log a view of it just read, opened (in memory only, for as
// long as the view lasts): the next read of an unchanged file, or of one
// this process only appended to since, is served from here instead of the
// disk. Bounded per file and in all, emptied with the block cache.
const TAIL_LINES = 2_000;
const TAIL_BYTES = 16 * 1024 * 1024;
interface Tail { ino: number; size: number; lines: string[]; fromStart: boolean; at: number; bytes: number }
const tails = new Map<string, Tail>();
let tailBytes = 0;

function forgetTails(file?: string): void {
  if (!file) { tails.clear(); tailBytes = 0; return; }
  const entry = tails.get(file);
  if (entry) { tails.delete(file); tailBytes -= entry.bytes; }
}

function trimTail(entry: Tail): void {
  // trimmed in steps, not at every append: an append stays O(1)
  if (entry.lines.length < TAIL_LINES * 1.5) return;
  const drop = Math.max(0, entry.lines.length - TAIL_LINES);
  if (drop) {
    for (let i = 0; i < drop; i++) entry.bytes -= entry.lines[i]!.length * 2;
    tailBytes -= entry.lines.slice(0, drop).reduce((sum, line) => sum + line.length * 2, 0);
    entry.lines = entry.lines.slice(drop);
    entry.fromStart = false;
  }
}

function storeTail(file: string, entry: Tail): void {
  forgetTails(file);
  tails.set(file, entry);
  tailBytes += entry.bytes;
  const now = Date.now();
  for (const [name, other] of tails) {
    if (tailBytes <= TAIL_BYTES && now - other.at < BLOCK_CACHE_MS) break;
    tails.delete(name);
    tailBytes -= other.bytes;
  }
}

/** What a view last read of `file` (its newest lines, opened), when the
 * file is still exactly what that was plus what this process appended. */
export function logTail(file: string, stat: { ino: number; size: number }): { lines: string[]; fromStart: boolean } | null {
  const entry = tails.get(file);
  if (!entry) return null;
  if (entry.ino !== stat.ino || entry.size !== stat.size || Date.now() - entry.at >= BLOCK_CACHE_MS) { forgetTails(file); return null; }
  entry.at = Date.now();
  tails.delete(file);
  tails.set(file, entry);
  return { lines: entry.lines, fromStart: entry.fromStart };
}

/** A view read these newest lines of `file` (complete, opened, ending at the end of the file). */
export function rememberTail(file: string, stat: { ino: number; size: number }, lines: string[], fromStart: boolean): void {
  if (exported) return;
  const kept = lines.length > TAIL_LINES ? lines.slice(-TAIL_LINES) : lines;
  const entry: Tail = { ino: stat.ino, size: stat.size, lines: kept, fromStart: fromStart && kept.length === lines.length, at: Date.now(), bytes: kept.reduce((sum, line) => sum + line.length * 2, 64) };
  if (entry.bytes > TAIL_BYTES / 4) return;
  storeTail(file, entry);
}

/** This process appended `lines` (originals) as `bytes` bytes to `file`. */
function appendedToTail(file: string, lines: readonly string[], bytes: number): void {
  const entry = tails.get(file);
  if (!entry) return;
  entry.size += bytes;
  for (const line of lines) entry.lines.push(line);
  const added = lines.reduce((sum, line) => sum + line.length * 2, 0);
  entry.bytes += added;
  tailBytes += added;
  trimTail(entry);
}

/** A writer's append of a sealed log is done: what it wrote goes to the
 * view's memory too (the writer holds the text already). */
export function logAppended(file: string, originals: readonly string[], data: string): void {
  appendedToTail(file, originals, Buffer.byteLength(data, "utf8"));
}

/** A log removed (its thread deleted): what memory kept of it goes too. */
export function forgetLogMemory(file: string): void {
  forgetCachedBlocks(file);
}

export function sealLogLines(file: string, records: readonly Record<string, unknown>[], lines: readonly string[], blockMax = BLOCK_MAX, options: { remember?: boolean } = {}): string[] {
  const spec = logOf(file);
  if (!spec) return [...lines];
  const out: string[] = [];
  let run: { key: FileKey; lines: string[]; projections: Record<string, unknown>[] } | null = null;
  const flush = () => {
    if (run) {
      const sealed = sealBlock(run.key, logContext(file), run.lines, run.projections);
      // the writer holds this text already: a reader of this process need not open it again
      if (options.remember) cacheBlock(sealed[sealed.length - 1]!.slice(BLOCK_PREFIX.length, BLOCK_PREFIX.length + BLOCK_ID_CHARS), file, run.lines);
      out.push(...sealed);
    }
    run = null;
  };
  const fileKey = spec.perFile ? sealingKeySafe(spec.scope(records[0] ?? {}, file)) : undefined;
  for (let i = 0; i < lines.length; i++) {
    const record = records[i]!;
    let key: FileKey | null;
    try { key = fileKey !== undefined ? fileKey : sealingKey(spec.scope(record, file)); } catch { key = null; }
    if (!key) {
      flush();
      out.push(lines[i]!);
      if (contentEncryptionOn()) scheduleAtRest(graceMs + 50);
      continue;
    }
    if (run && (run.key.keyId !== key.keyId || run.lines.length >= blockMax)) flush();
    if (!run) run = { key, lines: [], projections: [] };
    run.lines.push(lines[i]!);
    run.projections.push(spec.projection(record));
  }
  flush();
  return out;
}

/** One record as the line(s) to append, joined by newlines (no trailing one). */
export function sealLogLine(file: string, record: Record<string, unknown>, line = JSON.stringify(record)): string {
  return sealLogLines(file, [record], [line]).join("\n");
}

const projected = new WeakSet<object>();
/** A sealed record a reader chose not to open: only its cleartext projection. */
export function isProjectedRecord(value: unknown): boolean {
  return typeof value === "object" && value !== null && projected.has(value);
}

/** A sealed record whose key was destroyed (erased), or that does not open
 * here (copied from another log): a reader leaves it out. */
export const ERASED = null;

/**
 * Reads a window of a log's lines, sealed or plain. A block is opened once
 * (its last line is in the window: a window always ends at a line the
 * writer finished, and a block is written in one append), and only when one
 * of its records is asked for and not dropped by `projectionOnly` (the
 * record's clear fields say the reader will not use it: its projection comes
 * back instead, isProjectedRecord). Opened text lives in the reader only, for
 * the one read.
 */
export class LogReader {
  private readonly context: string;
  private readonly projectionOnly: ((projection: Record<string, unknown>) => boolean) | undefined;
  private readonly blocks = new Map<string, { last: NonNullable<BlockLine["last"]>; projections: Record<string, unknown>[] | null; lines: string[] | null | "erased" }>();
  /** a sealed record was met whose key is locked on this launch */
  locked = false;
  /** a sealed block line was met */
  sawSealed = false;

  private readonly file: string;
  /** read every block from the disk (the migration's checks), never the cache */
  private readonly fromDisk: boolean;

  constructor(file: string, projectionOnly?: (projection: Record<string, unknown>) => boolean, options: { fromDisk?: boolean } = {}) {
    this.file = file;
    this.fromDisk = options.fromDisk === true;
    this.context = logContext(file);
    this.projectionOnly = projectionOnly;
  }

  /** Where line `index` of `lines` is in its block: the block's last line
   * index and the record's position. Null when it is not a block line, or
   * its block's end is not in the window. */
  /** per window: the index of each placeholder's block end (-1: none) */
  private readonly ends = new WeakMap<readonly string[], Int32Array>();
  private readonly lastLines = new Map<string, NonNullable<BlockLine["last"]> | null>();

  private lastOf(blockId: string, raw: string): NonNullable<BlockLine["last"]> | null {
    let last = this.lastLines.get(blockId);
    if (last === undefined) {
      last = parseBlockLine(raw)?.last ?? null;
      this.lastLines.set(blockId, last);
    }
    return last;
  }

  /** For a window, once: the index of each block line's block end (-1: a
   * block whose end is not in the window; -2: not a block line). One pass
   * from the end, comparing a few characters per line. */
  private endsOf(lines: readonly string[]): Int32Array {
    let ends = this.ends.get(lines);
    if (ends) return ends;
    ends = new Int32Array(lines.length);
    let end = -1;
    let id = "";
    for (let k = lines.length - 1; k >= 0; k--) {
      const raw = lines[k]!;
      if (raw.charCodeAt(0) !== 123 || !raw.startsWith(BLOCK_PREFIX)) { ends[k] = -2; end = -1; continue; }
      if (raw.length !== PLACEHOLDER_LENGTH) {
        end = k;
        id = raw.slice(BLOCK_PREFIX.length, BLOCK_PREFIX.length + BLOCK_ID_CHARS);
        ends[k] = k;
        continue;
      }
      ends[k] = end >= 0 && raw.startsWith(id, BLOCK_PREFIX.length) && end - k <= BLOCK_MAX ? end : -1;
      if (ends[k] < 0) end = -1;
    }
    this.ends.set(lines, ends);
    return ends;
  }

  private locate(lines: readonly string[], index: number): { position: number; blockId: string; last: NonNullable<BlockLine["last"]> } | null | undefined {
    const end = this.endsOf(lines)[index]!;
    if (end === -2) return undefined;
    this.sawSealed = true;
    if (end === -1) return null;
    const raw = lines[end]!;
    const blockId = raw.slice(BLOCK_PREFIX.length, BLOCK_PREFIX.length + BLOCK_ID_CHARS);
    const last = this.lastOf(blockId, raw);
    if (!last) return null;
    const position = last.n - 1 - (end - index);
    return position >= 0 ? { position, blockId, last } : null;
  }

  private block(blockId: string, last: NonNullable<BlockLine["last"]>) {
    let entry = this.blocks.get(blockId);
    if (!entry) this.blocks.set(blockId, (entry = { last, projections: null, lines: null }));
    return entry;
  }

  private open(entry: { last: NonNullable<BlockLine["last"]>; lines: string[] | null | "erased" }, blockId: string): string[] | "erased" {
    if (entry.lines) return entry.lines;
    return this.openNow(entry, blockId);
  }

  private openNow(entry: { last: NonNullable<BlockLine["last"]>; lines: string[] | null | "erased" }, blockId: string): string[] | "erased" {
    if (!this.fromDisk) {
      const cached = cachedBlock(blockId);
      if (cached && cached.length === entry.last.n) return (entry.lines = cached);
    }
    const key = keyById(entry.last.keyId);
    if (key === "destroyed") return (entry.lines = "erased");
    if (!key) { this.locked = true; throw new ContentKeyUnavailable(); }
    let lines: string[] | "erased";
    try { lines = openBlock(key, this.context, blockId, entry.last); }
    catch { lines = "erased"; }
    entry.lines = lines;
    if (lines !== "erased" && !this.fromDisk) cacheBlock(blockId, this.file, lines);
    return lines;
  }

  /** The original text of line `index`: the plain line, or the record's
   * line opened. Null: erased or not readable here; undefined: a block line
   * whose block is not in the window. Throws ContentKeyUnavailable. */
  raw(lines: readonly string[], index: number): string | null | undefined {
    const at = this.locate(lines, index);
    if (at === undefined) return lines[index]!;
    if (at === null) return undefined;
    const opened = this.open(this.block(at.blockId, at.last), at.blockId);
    return opened === "erased" ? null : opened[at.position]!;
  }

  /** The record of line `index`, parsed: undefined for a torn or unknown
   * line (like a JSON.parse that throws), null for an erased one. Throws
   * ContentKeyUnavailable. */
  at(lines: readonly string[], index: number): unknown {
    const raw = lines[index]!;
    if (!raw) return undefined;
    const at = this.locate(lines, index);
    if (at === undefined) {
      try { return JSON.parse(raw); } catch { return undefined; }
    }
    if (at === null) return undefined;
    const entry = this.block(at.blockId, at.last);
    if (this.projectionOnly) {
      if (!entry.projections) {
        try { entry.projections = JSON.parse(entry.last.projection) as Record<string, unknown>[]; } catch { entry.projections = []; }
      }
      const projection = entry.projections[at.position];
      if (projection && typeof projection === "object" && this.projectionOnly(projection)) {
        const copy = { ...projection };
        projected.add(copy);
        return copy;
      }
    }
    const opened = this.open(entry, at.blockId);
    if (opened === "erased") return ERASED;
    try { return JSON.parse(opened[at.position]!); } catch { return undefined; }
  }

  /** Every record of `lines`, in order (undefined: torn, null: erased). */
  all(lines: readonly string[]): unknown[] {
    return lines.map((_line, index) => this.at(lines, index));
  }
}

/** One plain line (a plain log, or a line a writer wrote plain): JSON.parse
 * as before; a sealed block line alone cannot open (LogReader reads them). */
export function parseLogLine(_file: string, raw: string): unknown {
  return JSON.parse(raw);
}

const inFlight = new Map<string, number>();

/** fs.promises.appendFile for a sealed log: the migration waits for an
 * append in progress before it replaces the file. */
export async function appendLog(file: string, data: string, options: { mode?: number } = {}): Promise<void> {
  inFlight.set(file, (inFlight.get(file) ?? 0) + 1);
  try { await appendFile(file, data, options); }
  finally {
    const left = (inFlight.get(file) ?? 1) - 1;
    if (left > 0) inFlight.set(file, left);
    else inFlight.delete(file);
  }
}

// A log line is sealed and on disk when its append returns, as durable as
// a plain one: nothing waits in memory. What one append brings (a batch of
// the bus) is one block; a log appended a line at a time (the native tee)
// gets blocks of one, which the migration gathers into blocks of 64, checked
// before it replaces anything, once the log has been quiet for LOG_IDLE_MS.
const LOG_IDLE_MS = 60_000;

/** The original lines of a log, read in chunks that end on a block's end:
 * `[original, kept]` pairs, where `kept` is set for a line copied as it is
 * (erased, locked, or a block cut by the window: never regrouped). */
async function* originalsOf(file: string, start: number, end: number, onLocked: () => void, contextFile = file): AsyncGenerator<{ raw: string; original: string | null; record: Record<string, unknown> | null }> {
  const reader = new LogReader(contextFile, undefined, { fromDisk: true });
  let pending: string[] = [];
  const emit = function* (lines: string[], complete: boolean) {
    // keep the lines of a block whose end is not here yet
    let cut = lines.length;
    if (!complete) {
      while (cut > 0 && lines[cut - 1]!.startsWith(BLOCK_PREFIX) && !parseBlockLine(lines[cut - 1]!)?.last) cut--;
    }
    for (let i = 0; i < cut; i++) {
      let original: string | null | undefined;
      try { original = reader.raw(lines, i); }
      catch { onLocked(); original = null; }
      let record: Record<string, unknown> | null = null;
      if (typeof original === "string") { try { record = JSON.parse(original) as Record<string, unknown>; } catch { record = null; } }
      yield { raw: lines[i]!, original: typeof original === "string" ? original : null, record };
    }
    return lines.slice(cut);
  };
  for await (const { line, complete } of linesOfFrom(file, start, end)) {
    if (!complete) { pending.push(line); break; }
    pending.push(line);
    if (pending.length >= 1024) pending = yield* emit(pending, false);
  }
  yield* emit(pending, true);
}

/** Lines `lines` rewritten as the migration wants them: sealed in blocks of
 * BLOCK_COMPACT under each record's key (on), or plain (off). A line that
 * does not open here is kept as it is. */
function rewriteLines(_spec: SealedLogSpec, file: string, items: ReadonlyArray<{ raw: string; original: string | null; record: Record<string, unknown> | null }>, on: boolean, keep: { plain: boolean }): string[] {
  const out: string[] = [];
  let run: Array<{ original: string; record: Record<string, unknown> }> = [];
  const flush = () => {
    if (!run.length) return;
    const lines = sealLogLines(file, run.map((item) => item.record), run.map((item) => item.original), BLOCK_COMPACT);
    for (const line of lines) if (!line.startsWith(BLOCK_PREFIX)) keep.plain = true;
    out.push(...lines);
    run = [];
  };
  for (const item of items) {
    if (item.original === null || item.record === null || typeof item.record !== "object") { flush(); out.push(item.original ?? item.raw); continue; }
    if (on) run.push({ original: item.original, record: item.record });
    else { flush(); out.push(item.original); }
  }
  flush();
  return out;
}

/** Rewrite one log file: sealed in blocks (on, also gathering small
 * blocks), or plain (off). The copy is read back and every line compared
 * with the original's (what each opens to, byte for byte) before it
 * replaces anything; lines appended during the copy are carried over (and
 * checked) in a last short synchronous step. */
export function migrateLogFile(file: string, on: boolean): Promise<{ outcome: ReplaceOutcome; plainLeft: boolean }> {
  return withLock(file, async () => {
    const spec = logOf(file);
    if (!spec) return { outcome: "skipped" as const, plainLeft: false };
    let before: Stats;
    try { before = await lstat(file); } catch { return { outcome: "skipped" as const, plainLeft: false }; }
    if (!before.isFile()) return { outcome: "skipped" as const, plainLeft: false };
    const temp = tempFor(file);
    const keep = { plain: false };
    let locked = false;
    let out: FileHandle | null = null;
    try {
      let consumed = 0;
      const originals: Array<string | null> = [];
      out = await openHandle(temp, "wx", 0o600);
      let batch: Array<{ raw: string; original: string | null; record: Record<string, unknown> | null }> = [];
      const write = async () => {
        if (!batch.length) return;
        await out!.write(`${rewriteLines(spec, file, batch, on, keep).join("\n")}\n`);
        batch = [];
      };
      // complete lines only: a fragment at the end waits for the last step
      let lastComplete = 0;
      {
        const handle = await openHandle(file, "r");
        try {
          const probe = Buffer.allocUnsafe(Math.min(before.size, 64 * 1024));
          const at = Math.max(0, before.size - probe.length);
          const { bytesRead } = await handle.read(probe, 0, probe.length, at);
          const newline = probe.subarray(0, bytesRead).lastIndexOf(0x0a);
          lastComplete = newline >= 0 ? at + newline + 1 : 0;
        } finally { await handle.close(); }
      }
      for await (const item of originalsOf(file, 0, lastComplete, () => { locked = true; })) {
        batch.push(item);
        originals.push(item.original ?? item.raw);
        consumed += Buffer.byteLength(item.raw, "utf8") + 1;
        if (batch.length >= 512) await write();
        if (originals.length % 256 === 0) await new Promise((resolve) => setImmediate(resolve));
      }
      await write();
      await out.sync();
      testFault?.(temp, file);
      // read back: line for line, the copy opens to what the original does
      let index = 0;
      for await (const item of originalsOf(temp, 0, Number.MAX_SAFE_INTEGER, () => { locked = true; }, file)) {
        if (index >= originals.length || (item.original ?? item.raw) !== originals[index]) return { outcome: "skipped" as const, plainLeft: keep.plain || locked };
        index++;
        if (index % 256 === 0) await new Promise((resolve) => setImmediate(resolve));
      }
      if (index !== originals.length) return { outcome: "skipped" as const, plainLeft: keep.plain || locked };
      // the last step, synchronous: nothing appends between it and the rename
      for (let tries = 0; inFlight.get(file) && tries < 200; tries++) await new Promise((resolve) => setTimeout(resolve, 5));
      if (inFlight.get(file)) return { outcome: "changed" as const, plainLeft: keep.plain || locked };
      const now = lstatSync(file);
      if (now.dev !== before.dev || now.ino !== before.ino || now.size < consumed) return { outcome: "changed" as const, plainLeft: keep.plain || locked };
      let tail = "";
      if (now.size > consumed) {
        const fd = openSync(file, "r");
        try {
          const rest = Buffer.allocUnsafe(now.size - consumed);
          let filled = 0;
          while (filled < rest.length) {
            const n = readSync(fd, rest, filled, rest.length - filled, consumed + filled);
            if (!n) break;
            filled += n;
          }
          tail = rest.toString("utf8", 0, filled);
        } finally { closeSync(fd); }
      }
      const tailLines = tail.split("\n");
      const torn = tailLines.pop()!;
      if (tailLines.length) {
        const reader = new LogReader(file, undefined, { fromDisk: true });
        const items = tailLines.map((raw, i) => {
          let original: string | null | undefined;
          try { original = reader.raw(tailLines, i); } catch { locked = true; original = null; }
          let record: Record<string, unknown> | null = null;
          if (typeof original === "string") { try { record = JSON.parse(original) as Record<string, unknown>; } catch { record = null; } }
          return { raw, original: typeof original === "string" ? original : null, record };
        });
        const rewritten = rewriteLines(spec, file, items, on, keep);
        const check = new LogReader(file, undefined, { fromDisk: true });
        for (let i = 0; i < rewritten.length; i++) {
          let back: string | null | undefined;
          try { back = check.raw(rewritten, i); } catch { back = null; }
          if ((back ?? rewritten[i]) !== (items[i]!.original ?? items[i]!.raw)) return { outcome: "skipped" as const, plainLeft: keep.plain || locked };
        }
        const data = Buffer.from(`${rewritten.join("\n")}\n${torn}`, "utf8");
        for (let written = 0; written < data.length;) written += writeSync(out.fd, data, written, data.length - written);
        fsyncSync(out.fd);
      } else if (torn) {
        const data = Buffer.from(torn, "utf8");
        for (let written = 0; written < data.length;) written += writeSync(out.fd, data, written, data.length - written);
        fsyncSync(out.fd);
      }
      const last = lstatSync(file);
      if (last.ino !== now.ino || last.size !== now.size) return { outcome: "changed" as const, plainLeft: keep.plain || locked };
      await out.close();
      out = null;
      renameSync(temp, file);
      // its old blocks are gone: so is what was kept of them
      forgetCachedBlocks(file);
      return { outcome: "done" as const, plainLeft: keep.plain || locked };
    } catch {
      return { outcome: "skipped" as const, plainLeft: keep.plain || locked };
    } finally {
      if (out) await out.close().catch(() => undefined);
      await unlink(temp).catch(() => undefined);
    }
  });
}

/** The same rewrite, synchronously and whole (a thread changing hands: its
 * lines take the new key before anything can be erased). */
export function migrateLogFileSync(file: string): ReplaceOutcome {
  const spec = logOf(file);
  if (!spec) return "skipped";
  let before: Stats;
  try { before = lstatSync(file); } catch { return "skipped"; }
  if (!before.isFile()) return "skipped";
  const text = readFileSync(file, "utf8");
  const lines = text.split("\n");
  const torn = lines.pop()!;
  const reader = new LogReader(file, undefined, { fromDisk: true });
  const items = lines.map((raw, i) => {
    let original: string | null | undefined;
    try { original = reader.raw(lines, i); } catch { original = null; }
    let record: Record<string, unknown> | null = null;
    if (typeof original === "string") { try { record = JSON.parse(original) as Record<string, unknown>; } catch { record = null; } }
    return { raw, original: typeof original === "string" ? original : null, record };
  });
  const rewritten = rewriteLines(spec, file, items, contentEncryptionOn(), { plain: false });
  const check = new LogReader(file, undefined, { fromDisk: true });
  for (let i = 0; i < rewritten.length; i++) {
    let back: string | null | undefined;
    try { back = check.raw(rewritten, i); } catch { back = null; }
    if ((back ?? rewritten[i]) !== (items[i]!.original ?? items[i]!.raw)) return "skipped";
  }
  const temp = tempFor(file);
  try {
    const fd = openSync(temp, "wx", 0o600);
    try {
      const data = Buffer.from(`${rewritten.join("\n")}${rewritten.length ? "\n" : ""}${torn}`, "utf8");
      for (let written = 0; written < data.length;) written += writeSync(fd, data, written, data.length - written);
      fsyncSync(fd);
    } finally { closeSync(fd); }
    const now = lstatSync(file);
    if (!sameFile(before, now)) return "changed";
    renameSync(temp, file);
    forgetCachedBlocks(file);
    return "done";
  } catch {
    return "skipped";
  } finally {
    try { unlinkSync(temp); } catch { /* renamed */ }
  }
}

/** Whether a log file still holds a plain record (on), small blocks to
 * gather (on, once idle), a block under another key (a thread's own log),
 * or a sealed line (off), from `offset`, read in chunks: the migration only
 * rewrites the files that need it. */
async function logNeedsWork(file: string, on: boolean, offset: number, idle: boolean): Promise<{ needs: boolean; size: number; later?: boolean }> {
  const spec = logOf(file);
  let size = 0;
  try { size = (await lstat(file)).size; } catch { return { needs: false, size: 0 }; }
  if (size <= offset) return { needs: false, size };
  const want = on && spec?.perFile ? sealingKeySafe(spec.scope({}, file))?.keyId ?? null : null;
  let blocks = 0;
  let records = 0;
  try {
    let first = offset > 0;
    for await (const { line } of linesOfFrom(file, offset, size)) {
      // a check that starts mid-file skips its first (partial) line
      if (first) { first = false; continue; }
      if (!line) continue;
      const block = line.startsWith(BLOCK_PREFIX);
      if (!on && block) return { needs: true, size };
      if (on && !block && line.startsWith("{")) return { needs: true, size };
      if (on && block) {
        records++;
        const parsed = parseBlockLine(line);
        if (parsed?.last) {
          blocks++;
          if (want && parsed.last.keyId !== want) return { needs: true, size };
        }
      }
    }
  } catch {
    return { needs: false, size: 0 };
  }
  // small blocks (a log appended a line at a time) are gathered once it is quiet
  const fragmented = on && records >= BLOCK_COMPACT && records / Math.max(1, blocks) < 16;
  return { needs: fragmented && idle, size, ...(fragmented && !idle ? { later: true } : {}) };
}

async function* linesOfFrom(file: string, start: number, end: number): AsyncGenerator<{ line: string; complete: boolean }> {
  const handle = await openHandle(file, "r");
  try {
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let carry = "";
    for (let position = start; position < end;) {
      const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, end - position), position);
      if (!bytesRead) break;
      position += bytesRead;
      const parts = (carry + buffer.toString("utf8", 0, bytesRead)).split("\n");
      carry = parts.pop()!;
      for (const line of parts) yield { line, complete: true };
      await new Promise((resolve) => setImmediate(resolve));
    }
    if (carry) yield { line: carry, complete: false };
  } finally {
    await handle.close().catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// The migration

const seen = new Map<string, { ino: number; size: number; mtimeMs: number; on: boolean; keyId: string | null }>();
const logSeen = new Map<string, { ino: number; size: number; on: boolean }>();
let timer: ReturnType<typeof setTimeout> | null = null;
let timerAt = 0;
let running: Promise<AtRestPass> | null = null;
let again = false;

export interface AtRestPass {
  sealed: number;
  opened: number;
  resealed: number;
  logs: number;
  /** files left for later: held by a turn, not idle yet, changed meanwhile */
  waiting: number;
  /** files or lines whose key is locked on this launch, or not created yet */
  locked: number;
  failed: number;
}

/** Slice of work and pause (the transcripts' migration takes the same). */
const SLICE_MS = 4;
const PAUSE_MS = 20;
const SAFETY_PASS_MS = 5 * 60_000;
const REPLACEMENTS_PER_PAUSE = 8;

function scheduleAtRest(delay = PAUSE_MS): void {
  if (!contentAutoMigrate()) return;
  if (running) { again = true; return; }
  // the sooner of the two: a safety pass minutes away never delays one asked for now
  if (timer) {
    if (timerAt <= Date.now() + delay) return;
    clearTimeout(timer);
  }
  timerAt = Date.now() + delay;
  timer = setTimeout(() => {
    timer = null;
    void runAtRestMigration().then((pass) => {
      if (again || pass.waiting || pass.locked) { again = false; scheduleAtRest(pass.waiting ? graceMs + 50 : SAFETY_PASS_MS); }
      else scheduleAtRest(SAFETY_PASS_MS);
    }, () => scheduleAtRest(SAFETY_PASS_MS));
  }, delay);
  timer.unref?.();
}

onContentAtRest({
  // a key changed or goes: nothing opened under the old ones stays in memory
  changed: () => { seen.clear(); logSeen.clear(); forgetCachedBlocks(); scheduleAtRest(); },
  beforeErase: (owner, keyIds) => { forgetCachedBlocks(); resealBeforeErase(owner, keyIds); },
  moved: (threadIds, botIds) => { forgetCachedBlocks(); resealMoved(threadIds, botIds); },
});

let threadFiles: (threadId: string) => string[] = () => [];
/** server/index.ts: the stored files a thread's messages show. */
export function setAtRestThreadFiles(files: (threadId: string) => string[]): void {
  threadFiles = files;
}

/** Threads (and bots) that changed hands, now (contentOwnerChanged): their
 * logs, decision rows, attachments and the bots' memory are re-sealed under
 * the key they take now, synchronously, before anything can be erased. */
function resealMoved(threadIds: readonly string[], botIds: readonly string[]): void {
  const threads = new Set(threadIds);
  for (const spec of logs) {
    if (spec.perFile) {
      for (const threadId of threads) {
        const file = join(spec.dir, `${threadId}.ndjson`);
        if (existsSync(file)) migrateLogFileSync(file);
      }
      continue;
    }
    // a log of many threads: the files that hold one of them (their clear projection names it)
    let names: string[];
    try { names = readdirSync(spec.dir); } catch { continue; }
    for (const name of names) {
      if (!/\.ndjson(\.\d+)?$/.test(name)) continue;
      const file = join(spec.dir, name);
      let text: string;
      try { text = readFileSync(file, "utf8"); } catch { continue; }
      if ([...threads].some((threadId) => text.includes(`"threadId":"${threadId}"`))) migrateLogFileSync(file);
    }
  }
  // an attachment a moved thread shows: under its new owner's key (never a
  // confidential thread's own: another thread may show it too)
  for (const threadId of threads) {
    let paths: string[];
    try { paths = threadFiles(threadId); } catch { paths = []; }
    if (!paths.length) continue;
    const want = sealingKeySafe({ owner: contentOwnerOfThread(threadId) });
    for (const path of paths) {
      const info = atRestInfoSync(path);
      if (!info?.sealed || !want || info.keyId === want.keyId) continue;
      replaceInPlaceSync(path, want);
    }
  }
  if (botIds.length) {
    const bots = new Set(botIds);
    for (const root of roots) {
      let files: Iterable<{ path: string; scope: ContentScope }>;
      try { files = root.files(); } catch { continue; }
      for (const { path, scope } of files) {
        if (!("bot" in scope) || !bots.has(scope.bot)) continue;
        const info = atRestInfoSync(path);
        const want = sealingKeySafe(scope);
        if (!info?.sealed || !want || info.keyId === want.keyId) continue;
        replaceInPlaceSync(path, want);
      }
    }
  }
  seen.clear();
  logSeen.clear();
}

/** One whole pass over every root and sealed log (tests and the bench call
 * it directly; the server runs it on timers). */
export function runAtRestMigration(options: { sliceMs?: number; pauseMs?: number } = {}): Promise<AtRestPass> {
  if (running) return running;
  running = (async () => {
    const pass: AtRestPass = { sealed: 0, opened: 0, resealed: 0, logs: 0, waiting: 0, locked: 0, failed: 0 };
    const slice = options.sliceMs ?? SLICE_MS;
    const pause = options.pauseMs ?? PAUSE_MS;
    let started = performance.now();
    // The work is mostly I/O on the thread pool, which leaves the event loop
    // free: give the loop a turn whenever a slice of synchronous checks has
    // run, and the pool a pause after every few replacements (or MiB).
    let units = 0;
    const breathe = async (cost = 0) => {
      units += cost;
      if (units >= REPLACEMENTS_PER_PAUSE) {
        units = 0;
        await new Promise((resolve) => setTimeout(resolve, pause));
        started = performance.now();
        return;
      }
      if (performance.now() - started < slice) return;
      await new Promise((resolve) => setImmediate(resolve));
      started = performance.now();
    };
    const on = contentEncryptionOn();
    // one key lookup per scope (a bot, an owner) per pass, not per file
    const wants = new Map<string, FileKey | null>();
    const wantFor = (scope: ContentScope): FileKey | null => {
      const id = "thread" in scope ? `t:${scope.thread}` : "bot" in scope ? `b:${scope.bot}` : `o:${scope.owner}`;
      if (!wants.has(id)) wants.set(id, sealingKeySafe(scope));
      return wants.get(id)!;
    };
    for (const [holder, since] of Array.from(holderSince)) {
      const age = Date.now() - since;
      let alive = true;
      try { alive = holderAlive(holder); } catch { alive = true; }
      if (age > HOLD_MAX_MS || (age > HOLD_SETUP_MS && !alive)) releasePlain(holder);
    }
    const dirs = new Set<string>();
    for (const root of roots.slice()) {
      let files: Iterable<{ path: string; scope: ContentScope }>;
      try { files = root.files(); } catch { continue; }
      // listed lazily: a long listing never holds the loop either
      for (const { path, scope } of files) {
        await breathe();
        dirs.add(dirname(path));
        if (!held(path)) recoverOriginal(path);
        let stat: Stats;
        try { stat = lstatSync(path); } catch {
          forgetAtRestHint(path);
          seen.delete(path);
          continue;
        }
        if (!stat.isFile()) continue;
        const known = seen.get(path);
        const unchanged = known && known.ino === stat.ino && known.size === stat.size && known.mtimeMs === stat.mtimeMs && known.on === on;
        if (unchanged && (!on || (root.stickyKeys && known.keyId))) continue;
        const want = on ? wantFor(scopeFor(path, scope)) : null;
        if (unchanged && known.keyId === (want?.keyId ?? known.keyId)) continue;
        const info = atRestInfoSync(path);
        if (!info) continue;
        const remember = (keyId: string | null) => seen.set(path, { ino: info.stat.ino, size: info.stat.size, mtimeMs: info.stat.mtimeMs, on, keyId });
        if (on) {
          if (info.sealed && (!want || root.stickyKeys || info.keyId === want.keyId)) {
            remember(info.keyId);
            forgetAtRestHint(path);
            continue;
          }
          if (!want) { pass.locked++; continue; }
          if (held(path) || Date.now() - Math.max(lastUse.get(path) ?? 0, info.sealed ? 0 : stat.mtimeMs) < graceMs) { pass.waiting++; continue; }
          await whilePaused();
          const outcome = await (current = replaceInPlace(path, want));
          await breathe(1 + stat.size / (1024 * 1024));
          if (outcome === "done") {
            if (info.sealed) pass.resealed++; else pass.sealed++;
            forgetAtRestHint(path);
            const after = atRestInfoSync(path);
            if (after) seen.set(path, { ino: after.stat.ino, size: after.stat.size, mtimeMs: after.stat.mtimeMs, on, keyId: want.keyId });
          } else if (outcome === "locked") pass.locked++;
          else if (outcome === "held" || outcome === "changed") pass.waiting++;
          else pass.failed++;
        } else {
          if (!info.sealed) {
            remember(null);
            forgetAtRestHint(path);
            continue;
          }
          await whilePaused();
          const outcome = await (current = replaceInPlace(path, null));
          await breathe(1 + stat.size / (1024 * 1024));
          if (outcome === "done") {
            pass.opened++;
            forgetAtRestHint(path);
            const after = atRestInfoSync(path);
            if (after) seen.set(path, { ino: after.stat.ino, size: after.stat.size, mtimeMs: after.stat.mtimeMs, on, keyId: null });
          } else if (outcome === "locked") pass.locked++;
          else if (outcome === "held" || outcome === "changed") pass.waiting++;
          else pass.failed++;
        }
      }
    }
    for (const spec of logs.slice()) {
      let names: string[];
      try { names = readdirSync(spec.dir); } catch { continue; }
      for (const name of names) {
        if (!/\.ndjson(\.\d+)?$/.test(name) || isAtRestTemp(name)) continue;
        await breathe();
        const file = join(spec.dir, name);
        let stat: Stats;
        try { stat = statSync(file); } catch { continue; }
        const known = logSeen.get(file);
        const offset = known && known.ino === stat.ino && known.on === on && stat.size >= known.size ? known.size : 0;
        if (offset === stat.size) continue;
        const quiet = Math.min(graceMs, LOG_IDLE_MS);
        const check = await logNeedsWork(file, on, offset, quiet <= 0 || Date.now() - stat.mtimeMs >= quiet);
        // small blocks of a log still written to: looked at again once it is quiet
        if (check.later) { pass.waiting++; continue; }
        if (!check.needs) { logSeen.set(file, { ino: stat.ino, size: check.size, on }); continue; }
        await whilePaused();
        const result = await (current = migrateLogFile(file, on));
        await breathe(1 + stat.size / (1024 * 1024));
        if (result.outcome === "done") pass.logs++;
        else if (result.outcome === "changed") pass.waiting++;
        if (result.plainLeft) pass.locked++;
        if (result.outcome === "done" && !result.plainLeft) {
          try { const after = statSync(file); logSeen.set(file, { ino: after.ino, size: after.size, on }); } catch { /* gone */ }
        }
      }
    }
    for (const spec of logs) dirs.add(spec.dir);
    await cleanStaleTemps(dirs);
    sweepOriginals();
    pruneAtRestHints();
    return pass;
  })().finally(() => { running = null; });
  return running;
}

function sealingKeySafe(scope: ContentScope): FileKey | null {
  try { return sealingKey(scope); } catch { return null; }
}

/** A replacement interrupted by a crash leaves its hidden sibling: removed
 * once old (never the original). One folder at a time. */
async function cleanStaleTemps(dirs: Iterable<string>): Promise<void> {
  const now = Date.now();
  for (const dir of dirs) {
    let names: string[];
    try { names = readdirSync(dir); } catch { continue; }
    for (const name of names) {
      if (!isAtRestTemp(name)) continue;
      try {
        const path = join(dir, name);
        if (now - statSync(path).mtimeMs > 10 * 60_000 && !locks.has(path)) unlinkSync(path);
      } catch { /* gone */ }
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
}

/** Before an owner's keys are destroyed (eraseContentOwner): every file
 * sealed under one of them that now belongs to someone else (a bot that
 * changed hands, an upload another thread still uses) is re-sealed under
 * that key first; the rest stays sealed under the destroyed key: erased. */
function resealBeforeErase(owner: string, keyIds: readonly string[]): void {
  const doomed = new Set(keyIds);
  for (const root of roots) {
    let files: Array<{ path: string; scope: ContentScope }>;
    try { files = [...root.files()]; } catch { continue; }
    for (const { path, scope } of files) {
      const info = atRestInfoSync(path);
      if (!info?.sealed || !info.keyId || !doomed.has(info.keyId)) continue;
      const hint = scopeHints.get(path);
      if (hint && "owner" in hint && hint.owner === owner) continue;
      let keep = true;
      try { keep = root.keepOnErase ? root.keepOnErase(path) : true; } catch { keep = true; }
      if (!keep) continue;
      const target = sealingKeySafe(hint ?? scope);
      if (!target || doomed.has(target.keyId)) continue;
      replaceInPlaceSync(path, target);
    }
  }
  seen.clear();
}

// ---------------------------------------------------------------------------
// Backups: the archive carries plaintext (it is encrypted with its own
// password), the destination's migration seals it again under its keys.

/** The top-level folders whose `.ndjson` files are sealed logs. */
const LOG_FOLDERS = new Set(["events", "native", "memory-journal", "decisions", "admin-activity"]);

export class ContentExportLocked extends Error {
  constructor() {
    super("Some files are encrypted with a key this server cannot open right now; the backup was not made.");
  }
}

/** A key of the backup's set: known and handed over, known but locked
 * (fails the backup), or not one of ours (the bytes are copied as they are:
 * a person's own file that happens to look sealed, or erased content). */
function exportKey(keyId: string): FileKey | "locked" | "foreign" {
  if (exported) {
    const key = exported.keys.get(keyId);
    if (key) return key;
    return exported.stored.has(keyId) ? "locked" : "foreign";
  }
  const key = contentKeyById(keyId);
  if (key === "destroyed") return "foreign";
  return key ? asFileKey(key) : "locked";
}

/** Copy `source` to `destination` (created with `mode`) as plaintext when
 * it is sealed at rest: a sealed file, or a sealed log (`relativePath`,
 * posix, under the data folder). Null: nothing sealed, the caller copies
 * the bytes. Throws ContentExportLocked when a key is locked. */
export function exportPlainCopy(source: string, destination: string, relativePath: string, mode: number): { size: number; sha256: string } | null {
  const top = relativePath.split("/")[0]!;
  if (LOG_FOLDERS.has(top) && /\.ndjson(\.\d+)?$/.test(relativePath)) return exportPlainLog(source, destination, mode);
  const fd = openSync(source, "r");
  try {
    const size = fstatSync(fd).size;
    const header = (() => { try { return headerOfFd(fd, size); } catch { return null; } })();
    if (!header) return null;
    const key = exportKey(header.keyId);
    if (key === "foreign") return null;
    if (key === "locked") throw new ContentExportLocked();
    const out = openSync(destination, "wx", mode);
    try {
      const hash = createHash("sha256");
      const stride = header.chunkBytes + CHUNK_OVERHEAD;
      const count = chunkCount(header, size);
      const sealed = Buffer.allocUnsafe(stride);
      let total = 0;
      for (let index = 0; index < count; index++) {
        const offset = header.length + index * stride;
        const length = Math.min(stride, size - offset);
        let filled = 0;
        while (filled < length) {
          const n = readSync(fd, sealed, filled, length - filled, offset + filled);
          if (!n) throw new ContentSealError("malformed");
          filled += n;
        }
        const plain = openChunk(key, header.context, index, index === count - 1, sealed.subarray(0, length));
        hash.update(plain);
        for (let written = 0; written < plain.length;) written += writeSync(out, plain, written, plain.length - written);
        total += plain.length;
      }
      return { size: total, sha256: hash.digest("hex") };
    } finally {
      closeSync(out);
    }
  } finally {
    closeSync(fd);
  }
}

function exportPlainLog(source: string, destination: string, mode: number): { size: number; sha256: string } | null {
  const text = readFileSync(source, "utf8");
  if (!text.includes(BLOCK_PREFIX)) return null;
  const file = join(dirname(source), basename(source));
  const lines = text.split("\n");
  const torn = lines.pop()!;
  const reader = new LogReader(file);
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    if (!raw.startsWith(BLOCK_PREFIX)) { out.push(raw); continue; }
    const parsed = parseBlockLine(raw);
    const keyId = parsed?.last?.keyId ?? (() => {
      for (let j = i + 1; j < lines.length; j++) { const next = parseBlockLine(lines[j]!); if (next?.blockId === parsed?.blockId && next?.last) return next.last.keyId; }
      return null;
    })();
    if (keyId && exportKey(keyId) === "locked") throw new ContentExportLocked();
    let original: string | null | undefined;
    try { original = reader.raw(lines, i); } catch { throw new ContentExportLocked(); }
    // erased (its key destroyed): left out, like an erased message
    if (typeof original === "string") out.push(original);
  }
  const data = Buffer.from(`${out.join("\n")}${out.length ? "\n" : ""}${torn}`, "utf8");
  const fd = openSync(destination, "wx", mode);
  try {
    for (let written = 0; written < data.length;) written += writeSync(fd, data, written, data.length - written);
  } finally {
    closeSync(fd);
  }
  return { size: data.length, sha256: createHash("sha256").update(data).digest("hex") };
}

// ---------------------------------------------------------------------------
// Pausing (a backup copies the data folder: no replacement meanwhile)

let pauses = 0;
let resumeWaiters: Array<() => void> = [];
let current: Promise<unknown> = Promise.resolve();

/** Hold the migration between two files until the returned release. */
export async function pauseAtRestMigration(): Promise<() => void> {
  pauses++;
  await current.catch(() => undefined);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    pauses = Math.max(0, pauses - 1);
    if (!pauses) { const waiters = resumeWaiters; resumeWaiters = []; for (const resolve of waiters) resolve(); }
  };
}

async function whilePaused(): Promise<void> {
  while (pauses) await new Promise<void>((resolve) => resumeWaiters.push(resolve));
}

/** Counts for a status line (a scan: not for a hot path). */
export function atRestStatus(): { sealedFiles: number; plainFiles: number } {
  let sealedFiles = 0;
  let plainFiles = 0;
  for (const root of roots) {
    try {
      for (const { path } of root.files()) {
        const info = atRestInfoSync(path);
        if (!info) continue;
        if (info.sealed) sealedFiles++; else plainFiles++;
      }
    } catch { /* none */ }
  }
  return { sealedFiles, plainFiles };
}

/** Test seam: forget holds, hints and what the migration saw. */
export function resetAtRestState(): void {
  holders.clear();
  holderSince.clear();
  holdCount.clear();
  lastUse.clear();
  scopeHints.clear();
  seen.clear();
  logSeen.clear();
  forgetCachedBlocks();
  if (timer) { clearTimeout(timer); timer = null; }
  graceMs = Number.isInteger(graceFromEnv) && graceFromEnv >= 0 ? graceFromEnv : GRACE_MS;
}

export { WORKSPACE_OWNER };
