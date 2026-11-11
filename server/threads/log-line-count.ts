// How many lines a thread's log holds (events/ and native/<threadId>.ndjson),
// for the inspector's "last 300 of 1,687" (server/threads/thread-events.ts).
//
// The count is kept by the writer as it appends: both writers report each
// append through logAppended (server/encryption/content-at-rest.ts), which
// brings the count forward from the text it just wrote. Counts are stored
// beside the logs, one small index per directory, so a restart keeps them.
// A log the writer did not follow (an old one, one rewritten by the size cap
// or the at-rest migration, one appended by an older build) is brought up to
// date by the reader: a short stretch at once, a long one in slices that give
// the event loop back, the answer saying "at least N" until it is done. The
// path that answers a request never reads more than SYNC_COUNT_BYTES to count.
import { closeSync, fstatSync, openSync, readFileSync, readSync, statSync, type Stats } from "node:fs";
import { open } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { writeFileAtomic } from "../atomic.ts";
import { yieldToEventLoop } from "../harness/http.ts";

interface LineCount {
  dev: number;
  ino: number;
  size: number;
  mtimeMs: number;
  complete: number;
  trailing: boolean;
}
type FileStat = Pick<Stats, "dev" | "ino" | "size" | "mtimeMs">;
type Progress = Pick<LineCount, "complete" | "trailing">;

/** One per log directory; its name never ends in .ndjson, so the sweeps,
 * the at-rest migration and the size cap never take it for a log. */
export const LINE_COUNTS_FILE = ".line-counts.json";
/** The most a request's answer reads to bring a count up to date. */
export const SYNC_COUNT_BYTES = 1024 * 1024;
const READ_CHUNK = 64 * 1024;
const SLICE_BYTES = 1024 * 1024;
const KEPT_PER_DIR = 4096;
const SAVE_MS = 5_000;

const byDir = new Map<string, Map<string, LineCount>>();
const unsaved = new Set<string>();
let saveTimer: ReturnType<typeof setTimeout> | null = null;
const counting = new Map<string, { ino: number; dev: number; progress: Progress; done: Promise<void> }>();

const isLineCount = (value: unknown): value is LineCount => {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return ["dev", "ino", "size", "mtimeMs", "complete"].every((key) => typeof v[key] === "number" && Number.isFinite(v[key])) && typeof v.trailing === "boolean";
};

function countsOf(dir: string): Map<string, LineCount> {
  let counts = byDir.get(dir);
  if (counts) return counts;
  counts = new Map();
  try {
    const stored: unknown = JSON.parse(readFileSync(join(dir, LINE_COUNTS_FILE), "utf8"));
    if (typeof stored === "object" && stored !== null) {
      for (const [name, value] of Object.entries(stored)) if (isLineCount(value)) counts.set(name, value);
    }
  } catch {
    /* none stored yet, or unreadable: counted again */
  }
  byDir.set(dir, counts);
  return counts;
}

function remember(file: string, count: LineCount | null, changed = true): void {
  const dir = dirname(file);
  const name = basename(file);
  const counts = countsOf(dir);
  counts.delete(name);
  if (count) counts.set(name, count);
  // least recently used first: a log nobody reads any more falls out
  while (counts.size > KEPT_PER_DIR) counts.delete(counts.keys().next().value!);
  if (!changed) return;
  unsaved.add(dir);
  if (!saveTimer) {
    saveTimer = setTimeout(saveLineCounts, SAVE_MS);
    saveTimer.unref?.();
  }
}

/** Writes the counts changed since the last save (on a timer, and at exit). */
export function saveLineCounts(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  for (const dir of unsaved) {
    unsaved.delete(dir);
    const counts = byDir.get(dir);
    if (!counts) continue;
    try {
      writeFileAtomic(join(dir, LINE_COUNTS_FILE), JSON.stringify(Object.fromEntries(counts)), { mode: 0o600, durable: false });
    } catch {
      /* not saved: counted again after a restart */
    }
  }
}
process.once("exit", saveLineCounts);

/** A line is counted once it holds a byte other than CR: blank lines are not. */
function scanBytes(bytes: Uint8Array, length: number, progress: Progress): void {
  let { complete, trailing } = progress;
  for (let i = 0; i < length; i++) {
    const byte = bytes[i];
    if (byte === 0x0a) {
      if (trailing) complete++;
      trailing = false;
    } else if (byte !== 0x0d) {
      trailing = true;
    }
  }
  progress.complete = complete;
  progress.trailing = trailing;
}

/** The same rule over text: LF and CR never occur inside a UTF-8 sequence. */
function scanText(text: string, progress: Progress): void {
  let { complete, trailing } = progress;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === 10) {
      if (trailing) complete++;
      trailing = false;
    } else if (code !== 13) {
      trailing = true;
    }
  }
  progress.complete = complete;
  progress.trailing = trailing;
}

const sameFile = (a: Pick<LineCount, "dev" | "ino">, b: Pick<FileStat, "dev" | "ino">) => a.dev === b.dev && a.ino === b.ino;
const linesOf = (progress: Progress) => progress.complete + Number(progress.trailing);

/** A writer appended `data` (`bytes` long) to `file`: its count moves forward
 * from the text alone when the file is exactly the counted one plus this
 * append, or a new file holding only it. A count behind the file (one that
 * finished while the writer kept appending) stays: it is still a counted
 * prefix, and the reader reads only the gap. Anything else is dropped. */
export function lineCountAppended(file: string, data: string, bytes: number): void {
  let stat: Stats;
  try {
    stat = statSync(file);
  } catch {
    return;
  }
  const previous = countsOf(dirname(file)).get(basename(file));
  let progress: Progress;
  if (previous && sameFile(previous, stat) && stat.size === previous.size + bytes) progress = { complete: previous.complete, trailing: previous.trailing };
  else if (stat.size === bytes) progress = { complete: 0, trailing: false };
  else if (previous && sameFile(previous, stat) && stat.size > previous.size) return;
  else {
    // not the counted file any more: a later file could reuse its inode
    if (previous) remember(file, null);
    return;
  }
  scanText(data, progress);
  remember(file, { dev: stat.dev, ino: stat.ino, size: stat.size, mtimeMs: stat.mtimeMs, ...progress });
}

/** The counted prefix of `stat`'s file, when the file only grew since. */
function countedPrefix(previous: LineCount | undefined, stat: FileStat): LineCount | null {
  if (!previous || !sameFile(previous, stat) || stat.size < previous.size) return null;
  // the same size with another mtime is a file rewritten in place
  if (stat.size === previous.size && stat.mtimeMs !== previous.mtimeMs) return null;
  return previous;
}

/** Counts the rest of a long log in slices, giving the event loop back
 * between them; one count per log at a time. */
function countLater(file: string, stat: FileStat, prefix: LineCount | null): Progress {
  const running = counting.get(file);
  if (running && sameFile(running, stat)) return running.progress;
  const progress: Progress = prefix ? { complete: prefix.complete, trailing: prefix.trailing } : { complete: 0, trailing: false };
  const job = { dev: stat.dev, ino: stat.ino, progress, done: Promise.resolve() };
  job.done = (async () => {
    const handle = await open(file, "r");
    try {
      if (!sameFile(job, await handle.stat())) return;
      const buffer = Buffer.allocUnsafe(SLICE_BYTES);
      let offset = prefix ? prefix.size : 0;
      while (offset < stat.size) {
        const { bytesRead } = await handle.read(buffer, 0, Math.min(SLICE_BYTES, stat.size - offset), offset);
        if (bytesRead <= 0) return; // it shrank under us: the next read starts over
        scanBytes(buffer, bytesRead, progress);
        offset += bytesRead;
        await yieldToEventLoop();
      }
    } finally {
      await handle.close();
    }
    // still the file counted, and nothing newer known for it
    let now: Stats;
    try { now = statSync(file); } catch { return; }
    if (!sameFile(job, now)) return;
    const current = countsOf(dirname(file)).get(basename(file));
    if (current && sameFile(current, stat) && current.size >= stat.size) return;
    remember(file, { dev: stat.dev, ino: stat.ino, size: stat.size, mtimeMs: stat.mtimeMs, ...progress });
  })()
    .catch(() => { /* an unreadable log: counted again on the next read */ })
    .finally(() => { if (counting.get(file) === job) counting.delete(file); });
  counting.set(file, job);
  return progress;
}

/** The lines `file` holds. `complete` false: still being counted, and
 * `total` is only how many it holds at least. */
export function logLineTotal(file: string): { total: number; complete: boolean } {
  let fd: number;
  try {
    fd = openSync(file, "r");
  } catch {
    if (countsOf(dirname(file)).has(basename(file))) remember(file, null);
    return { total: 0, complete: true };
  }
  try {
    const stat = fstatSync(fd);
    const prefix = countedPrefix(countsOf(dirname(file)).get(basename(file)), stat);
    if (prefix && prefix.size === stat.size) {
      remember(file, prefix, false);
      return { total: linesOf(prefix), complete: true };
    }
    const from = prefix ? prefix.size : 0;
    if (stat.size - from > SYNC_COUNT_BYTES) return { total: linesOf(countLater(file, stat, prefix)), complete: false };
    const progress: Progress = prefix ? { complete: prefix.complete, trailing: prefix.trailing } : { complete: 0, trailing: false };
    const chunk = Buffer.allocUnsafe(READ_CHUNK);
    let offset = from;
    while (offset < stat.size) {
      const read = readSync(fd, chunk, 0, Math.min(READ_CHUNK, stat.size - offset), offset);
      if (read <= 0) break;
      scanBytes(chunk, read, progress);
      offset += read;
    }
    // it shrank under us: what was read is a lower bound, counted again next time
    if (offset < stat.size) return { total: linesOf(progress), complete: false };
    remember(file, { dev: stat.dev, ino: stat.ino, size: stat.size, mtimeMs: stat.mtimeMs, ...progress });
    return { total: linesOf(progress), complete: true };
  } finally {
    closeSync(fd);
  }
}

/** Tests: the count of `file` in progress, settled. */
export function lineCountSettled(file: string): Promise<void> {
  return counting.get(file)?.done ?? Promise.resolve();
}

/** Tests: what a restart forgets (the stored counts stay on disk). */
export function forgetLineCountsInMemory(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  unsaved.clear();
  byDir.clear();
  counting.clear();
}
