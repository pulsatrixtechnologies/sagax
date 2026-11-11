// Durable, atomic file replace: write to a sibling temp file, fsync it, then
// rename over the target. rename(2) is atomic on the same filesystem, so a
// crash or power loss mid-write can never leave a truncated file behind — a
// reader always sees either the complete old contents or the complete new
// ones. Without this, an interrupted writeFileSync produces half-written JSON
// that fails to parse on next boot and is silently treated as empty state.
//
// The fsync is the expensive part: on macOS it is F_FULLFSYNC, about 4 ms of
// blocked event loop per call. `durable: false` drops only the fsync, for
// files whose loss after a power cut costs nothing (a derived cache, a
// session-scoped token). The temp file and rename stay, so an app crash or
// kill -9 still never leaves a torn file; only a power loss or kernel panic
// can leave such a file empty.
import { randomUUID } from "node:crypto";
import { open, rm } from "node:fs/promises";
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";

export type AtomicWriteOptions = {
  mode?: number;
  /** false skips the fsync. Default true. */
  durable?: boolean;
};

/** Windows refuses a rename onto an existing path while anything else holds a
 * handle to either file, and a virus scanner or the search indexer opening a
 * just-closed file for a few milliseconds is enough. It surfaces as EPERM or
 * EACCES from an operation that is correct and would succeed a moment later —
 * so it is retried rather than reported. Everything else throws immediately;
 * a real permission problem must not be papered over by a busy-wait.
 *
 * Total worst case is ~155 ms across 6 attempts. Kept synchronous because
 * every caller is a synchronous save path, and making one of them async is a
 * much larger change than this bug warrants.
 *
 * ponytail: fixed backoff, no jitter. If contention turns out to be heavy
 * enough that these collide, jitter it then. */
const RENAME_RETRY_DELAYS_MS = [5, 10, 20, 40, 80];
const RETRYABLE_RENAME_CODES = new Set(["EPERM", "EACCES", "EBUSY"]);

function sleepSync(ms: number): void {
  // No synchronous sleep in Node without a syscall: a zero-length read on a
  // shared array with a timeout is the standard trick and does not spin the CPU.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** `rename` is injectable for tests only — there is no portable way to make a
 * real filesystem produce a transient EPERM on demand. */
export function renameWithRetry(
  tmp: string,
  path: string,
  rename: (from: string, to: string) => void = renameSync,
): void {
  for (let attempt = 0; ; attempt += 1) {
    try {
      rename(tmp, path);
      return;
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (!code || !RETRYABLE_RENAME_CODES.has(code) || attempt >= RENAME_RETRY_DELAYS_MS.length) throw e;
      sleepSync(RENAME_RETRY_DELAYS_MS[attempt]!);
    }
  }
}

export function writeFileAtomic(path: string, data: string | NodeJS.ArrayBufferView, options: AtomicWriteOptions = {}): void {
  const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  let fd: number | null = null;
  try {
    // Apply sensitive-file permissions to the temporary inode itself. The
    // final rename preserves them and never leaves a broader-permission
    // config file visible between the write and a later chmod.
    fd = openSync(tmp, "w", options.mode);
    writeFileSync(fd, data);
    if (options.durable !== false) fsyncSync(fd);
    closeSync(fd);
    fd = null;
    renameWithRetry(tmp, path);
  } catch (e) {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {
        /* best-effort cleanup */
      }
    }
    try {
      unlinkSync(tmp);
    } catch {
      /* best-effort cleanup */
    }
    throw e;
  }
}

/** True only when `path` is already exactly `data`: a regular file (never a
 * symlink, FIFO or directory), owned by this user, with permissions no
 * broader than `mode`. Any doubt or error answers false, so the caller falls
 * back to a full write — this check must never be the reason a save fails.
 *
 * It reads the file on disk rather than remembering the last write: a
 * workspace restore or a hand edit can change the file underneath, and the
 * next save has to put its own bytes back exactly as before. */
function holdsExactly(path: string, data: string, mode: number | undefined): boolean {
  let fd: number | null = null;
  try {
    if (process.platform === "win32") {
      // No O_NOFOLLOW on Windows; a reparse point is replaced, not read.
      if (!lstatSync(path).isFile()) return false;
      fd = openSync(path, "r");
    } else {
      // Inspect and read the same inode the open landed on, so a swap
      // between a stat and the read cannot be mistaken for a match.
      // O_NONBLOCK keeps a FIFO planted at the path from hanging the open.
      fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    }
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size !== Buffer.byteLength(data)) return false;
    const uid = process.getuid?.();
    if (uid !== undefined && stat.uid !== uid) return false;
    // Windows reports 0o666 for any writable file; its mode bits mean nothing.
    if (mode !== undefined && process.platform !== "win32" && (stat.mode & 0o777 & ~mode) !== 0) return false;
    // Bytes, not strings: decoding and comparing a megabyte-sized registry as
    // a JS string costs several times more than a memcmp of the raw bytes.
    return readFileSync(fd).equals(Buffer.from(data));
  } catch {
    return false;
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {
        /* best-effort cleanup */
      }
    }
  }
}

/** writeFileAtomic for saves that often repeat what the file already holds.
 * A save that changes nothing costs one open and read instead of a temp
 * file, a rename and an fsync; a save whose size differs pays only an
 * open and fstat before the normal write. Returns whether it wrote. */
export function writeFileAtomicIfChanged(path: string, data: string, options: AtomicWriteOptions = {}): boolean {
  if (holdsExactly(path, data, options.mode)) return false;
  writeFileAtomic(path, data, options);
  return true;
}
/** Owned files by path: one owner per file in this process (see OwnedFile). */
const owners = new Map<string, OwnedFile>();

/** Bookkeeping writes of one file start at most this often: the changes made
 * meanwhile ride on the next write. */
const DEFERRED_GAP_MS = 1_000;

/** A file only this process writes while it runs: a save whose text equals the last one written (or read at load) is
 * skipped without reading the disk back.
 *
 * Two ways in (#3663):
 * - `write` writes now, on the event loop, and throws when the write fails: a change a person asked for, which the
 *   caller refuses (and rolls back) when it is not on disk, so memory, disk and the answer agree.
 * - `writeSoon` is the bookkeeping path (what turns change many times a minute): the text is made when the write starts,
 *   at most once per gap, and the write and its fsync run off the event loop (the thread pool). One deferred write runs
 *   at a time and the newest state replaces a waiting one; a write on the loop supersedes a deferred one still running
 *   (it never lands), so the last state wins. A failed deferred write is logged once per failure streak, its data stays
 *   in memory, the next save writes it, and the synchronous flush at exit (flushSync) still runs.
 *
 * Every write is atomic (temp file, then rename). */
export class OwnedFile {
  private last: string | undefined;
  readonly path: string;
  private readonly options: AtomicWriteOptions;
  /** Makes the newest text for the waiting bookkeeping write. */
  private produce: (() => string) | undefined;
  /** The last producer given: armed again when a write on the loop interrupted a deferred one and then failed. */
  private producer: (() => string) | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  /** The deferred write running now: resolves true once on disk or superseded, false when it failed. */
  private inFlight: Promise<boolean> | undefined;
  private writing: string | undefined;
  private tmp: string | undefined;
  private startedAt = 0;
  /** Bumped by every write on the loop: a deferred write started before it never lands. */
  private generation = 0;
  /** A deferred write failed and none succeeded since: the streak is logged once. */
  private failing = false;

  constructor(path: string, options: AtomicWriteOptions = {}) {
    this.path = path;
    this.options = options;
    this.own();
  }

  loaded(text: string): void {
    this.last = text;
  }

  write(text: string): boolean {
    this.own();
    // A deferred write still running started before this one: it never lands.
    this.generation += 1;
    const interrupted = this.writing !== undefined;
    this.writing = undefined;
    if (text === this.last) return false;
    try {
      writeFileAtomic(this.path, text, this.options);
    } catch (error) {
      // The interrupted bookkeeping is no longer on its way to disk: the next deferred write carries it.
      if (interrupted && this.producer) {
        this.produce ??= this.producer;
        this.schedule();
      }
      throw error;
    }
    this.last = text;
    this.failing = false;
    return true;
  }

  /** Writes what `produce` returns, later and off the event loop. */
  writeSoon(produce: () => string): void {
    this.own();
    this.produce = produce;
    this.producer = produce;
    this.schedule();
  }

  /** Every waiting or running deferred write is on disk (or failed and logged). */
  async flush(): Promise<void> {
    for (;;) {
      this.cancelTimer();
      if (this.inFlight) {
        if (!(await this.inFlight)) return;
        continue;
      }
      if (!this.produce) return;
      this.startProduced();
      if (!this.inFlight) return;
    }
  }

  /** At exit: the newest state still waiting or running is written now, on the loop. */
  flushSync(): void {
    this.cancelTimer();
    const produce = this.produce;
    this.produce = undefined;
    const tmp = this.tmp;
    try {
      const text = produce ? produce() : this.writing;
      if (text !== undefined) this.write(text);
      else this.generation += 1;
    } catch (error) {
      console.error(`${this.path}: the last save could not be written`, error);
    }
    if (tmp) {
      try {
        unlinkSync(tmp);
      } catch {
        /* the running write removes it */
      }
    }
  }

  private schedule(): void {
    if (this.timer || this.inFlight || !this.produce) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.startProduced();
    }, Math.max(0, this.startedAt + DEFERRED_GAP_MS - Date.now()));
    this.timer.unref?.();
  }

  private cancelTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private startProduced(): void {
    const produce = this.produce;
    this.produce = undefined;
    if (!produce) return;
    let text: string;
    try {
      text = produce();
    } catch (error) {
      console.error(`${this.path}: a save could not be prepared; the next save tries again`, error);
      return;
    }
    if (text === this.last) return;
    const generation = this.generation;
    this.startedAt = Date.now();
    this.writing = text;
    this.inFlight = this.persist(text, generation).then(() => {
      this.failing = false;
      return true;
    }, (error: unknown) => {
      if (!this.failing) console.error(`${this.path}: a deferred save failed; the changes stay in memory and the next save writes them`, error);
      this.failing = true;
      this.produce ??= produce;
      return false;
    }).then((ok) => {
      this.inFlight = undefined;
      this.writing = undefined;
      // After a failure the retry waits for the next save, so a broken disk is not retried in a loop.
      if (ok) this.schedule();
      return ok;
    });
  }

  private async persist(text: string, generation: number): Promise<void> {
    const tmp = `${this.path}.${process.pid}.${randomUUID()}.tmp`;
    this.tmp = tmp;
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(tmp, "w", this.options.mode);
      await handle.writeFile(text);
      if (this.options.durable !== false) await handle.sync();
      await handle.close();
      handle = undefined;
      if (generation !== this.generation) {
        await rm(tmp, { force: true });
        return;
      }
      // Synchronous on purpose: no write on the loop can run between the check above and the rename.
      renameWithRetry(tmp, this.path);
      this.last = text;
    } catch (error) {
      await handle?.close().catch(() => undefined);
      await rm(tmp, { force: true }).catch(() => undefined);
      // A write on the loop replaced it meanwhile: nothing is lost.
      if (generation !== this.generation) return;
      throw error;
    } finally {
      if (this.tmp === tmp) this.tmp = undefined;
    }
  }

  private pending(): boolean {
    return Boolean(this.produce || this.inFlight || this.timer);
  }

  /** One owner writes a path at a time in this process: the one that writes
   * now takes it over from the one before (a store opened again, then an
   * older one still writing). */
  private own(): void {
    const previous = owners.get(this.path);
    if (previous === this) return;
    previous?.handOver();
    owners.set(this.path, this);
  }

  /** The owner that writes the same path next takes over. When the disk still holds what this owner last wrote, its
   * waiting state is the newest and is written first; anything else wrote
   * the file since (a restore, a reset), and that wins. */
  private handOver(): void {
    if (!this.pending()) return;
    let disk: string | undefined;
    try {
      disk = readFileSync(this.path, "utf8");
    } catch {
      disk = undefined;
    }
    if (disk === this.last) {
      this.flushSync();
      return;
    }
    this.cancelTimer();
    this.produce = undefined;
    this.generation += 1;
    this.writing = undefined;
  }
}

/** Waits until every owned file's waiting writes are on disk (shutdown, tests). */
export async function flushOwnedFiles(): Promise<void> {
  await Promise.all([...owners.values()].map((file) => file.flush()));
}

/** Writes every owned file's waiting state now, on the loop: the last step before the process exits. */
export function flushOwnedFilesSync(): void {
  for (const file of owners.values()) file.flushSync();
}
