// The server log tail (2026-10-08, the Perspicax console's Logs page): the
// last lines this process wrote to its console, kept in memory, secrets
// redacted when they are captured. A container's log driver keeps the
// whole log; this is what an admin reads without a shell on the host.
//
// Bounded twice: at most 2,000 lines, each at most 2,000 characters.
//
// 2026-10-11: the window also lives on disk (`persistTo`, called by the
// server once it knows its data directory), so a restart keeps the last
// lines. Two JSON-lines files under `<data>/server-log/`, `current.jsonl`
// and `previous.jsonl`, each at most LOG_FILE_MAX_BYTES: when the current
// one passes it, it becomes the previous one (the older previous goes) and
// a new one starts, so the disk holds at most twice that. Mode 0600 in a
// 0700 folder; lines are redacted before they are kept, so the files hold
// nothing the memory did not. Writes are batched (LOG_FLUSH_MS) and flushed
// at exit; a write that fails is dropped, never thrown at the logger. The
// sequence numbers continue across restarts, so the paging cursor stays
// monotonic.
import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";
import { format } from "node:util";

import { redactSecretsInText } from "../redact.ts";

export type LogLevel = "info" | "warn" | "error";
export const LOG_LEVELS: readonly LogLevel[] = ["info", "warn", "error"];
const RANK: Record<LogLevel, number> = { info: 0, warn: 1, error: 2 };

export interface LogLine {
  /** Monotonic within this process, the paging cursor. */
  seq: number;
  at: number;
  level: LogLevel;
  /** The leading `[tag]` of the line, when it has one ("engines", "omb-turn"). */
  area: string | null;
  message: string;
}

export const LOG_RING_MAX_LINES = 2_000;
export const LOG_LINE_MAX_CHARS = 2_000;
/** One file of the window on disk; the window is two of them. */
export const LOG_FILE_MAX_BYTES = 2 * 1024 * 1024;
/** Lines wait at most this long before they reach the disk. */
export const LOG_FLUSH_MS = 1_000;
const CURRENT_FILE = "current.jsonl";
const PREVIOUS_FILE = "previous.jsonl";
const AREA = /^\[([A-Za-z0-9_.:/-]{1,40})\]\s*/;
/** Terminal colour codes (ESC [ ... m). */
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

function parseLine(text: string): LogLine | null {
  try {
    const value = JSON.parse(text) as Partial<LogLine>;
    if (!value || typeof value.seq !== "number" || !Number.isSafeInteger(value.seq) || value.seq < 1) return null;
    if (typeof value.at !== "number" || !Number.isFinite(value.at)) return null;
    if (value.level !== "info" && value.level !== "warn" && value.level !== "error") return null;
    if (typeof value.message !== "string") return null;
    const area = typeof value.area === "string" && AREA.test(`[${value.area}]`) ? value.area : null;
    return { seq: value.seq, at: value.at, level: value.level, area, message: value.message.slice(0, LOG_LINE_MAX_CHARS) };
  } catch {
    return null;
  }
}

function readLines(path: string): LogLine[] {
  if (!existsSync(path)) return [];
  try {
    return readFileSync(path, "utf8").split("\n").map(parseLine).filter((line): line is LogLine => line !== null);
  } catch {
    return [];
  }
}

export class ServerLogRing {
  private readonly lines: LogLine[] = [];
  private seq = 0;
  private readonly max: number;
  private readonly now: () => number;
  private readonly fileMax: number;
  private dir: string | null = null;
  private pending: string[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private written = 0;

  constructor(options: { max?: number; now?: () => number; fileMaxBytes?: number } = {}) {
    this.max = options.max ?? LOG_RING_MAX_LINES;
    this.now = options.now ?? Date.now;
    this.fileMax = options.fileMaxBytes ?? LOG_FILE_MAX_BYTES;
  }

  /** Keep the window on disk under `dir` from now on: the lines a previous
   * run left come back first (older than every line of this run), this
   * run's lines so far follow, renumbered after them, and every later line
   * is appended. Never throws: without a usable folder the ring stays in
   * memory only. */
  persistTo(dir: string): void {
    if (this.dir) return;
    try {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      chmodSync(dir, 0o700);
    } catch {
      return;
    }
    const kept = [...readLines(join(dir, PREVIOUS_FILE)), ...readLines(join(dir, CURRENT_FILE))]
      .sort((a, b) => a.seq - b.seq)
      .slice(-this.max);
    const base = kept.at(-1)?.seq ?? 0;
    const mine = this.lines.splice(0).map((line, index) => ({ ...line, seq: base + index + 1 }));
    this.lines.push(...kept, ...mine);
    if (this.lines.length > this.max) this.lines.splice(0, this.lines.length - this.max);
    this.seq = base + mine.length;
    this.dir = dir;
    try {
      this.written = existsSync(join(dir, CURRENT_FILE)) ? statSync(join(dir, CURRENT_FILE)).size : 0;
    } catch {
      this.written = 0;
    }
    for (const line of mine) this.pending.push(JSON.stringify(line));
    this.flush();
  }

  /** Write what waits to the disk now (also at exit). */
  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.dir || !this.pending.length) return;
    const chunk = `${this.pending.join("\n")}\n`;
    this.pending = [];
    const current = join(this.dir, CURRENT_FILE);
    try {
      if (this.written > 0 && this.written + Buffer.byteLength(chunk) > this.fileMax) {
        renameSync(current, join(this.dir, PREVIOUS_FILE));
        this.written = 0;
      }
      appendFileSync(current, chunk, { mode: 0o600 });
      this.written += Buffer.byteLength(chunk);
    } catch {
      /* the window on disk is best effort; memory keeps the lines */
    }
  }

  private schedule(): void {
    if (!this.dir || this.timer) return;
    this.timer = setTimeout(() => this.flush(), LOG_FLUSH_MS);
    this.timer.unref?.();
  }

  push(level: LogLevel, text: string): void {
    const clean = redactSecretsInText(text.replace(ANSI, ""));
    for (const raw of clean.split(/\r?\n/)) {
      if (!raw.trim()) continue;
      const area = AREA.exec(raw);
      const message = (area ? raw.slice(area[0].length) : raw);
      const line: LogLine = {
        seq: ++this.seq,
        at: this.now(),
        level,
        area: area?.[1] ?? null,
        message: message.length > LOG_LINE_MAX_CHARS ? `${message.slice(0, LOG_LINE_MAX_CHARS - 3)}...` : message,
      };
      this.lines.push(line);
      if (this.dir) this.pending.push(JSON.stringify(line));
    }
    if (this.lines.length > this.max) this.lines.splice(0, this.lines.length - this.max);
    if (this.pending.length >= 500) this.flush();
    else this.schedule();
  }

  /** Newest first: lines at `level` or above, older than `before` (a seq),
   * at most `limit`; `next` is the seq to pass as `before`, or null. */
  read(input: { level?: LogLevel | null; limit: number; before?: number | null }): { lines: LogLine[]; next: number | null } {
    const floor = RANK[input.level ?? "info"];
    const out: LogLine[] = [];
    for (let index = this.lines.length - 1; index >= 0; index--) {
      const line = this.lines[index]!;
      if (input.before && line.seq >= input.before) continue;
      if (RANK[line.level] < floor) continue;
      if (out.length === input.limit) return { lines: out, next: out.at(-1)!.seq };
      out.push(line);
    }
    return { lines: out, next: null };
  }
}

/** Mirror console.log, info, warn and error into the ring; the original
 * output is untouched. Returns the undo. */
export function captureConsole(ring: ServerLogRing, target: Pick<Console, "log" | "info" | "warn" | "error"> = console): () => void {
  const original = { log: target.log, info: target.info, warn: target.warn, error: target.error };
  const wrap = (level: LogLevel, fn: (...args: unknown[]) => void) => (...args: unknown[]) => {
    fn.apply(target, args);
    try {
      ring.push(level, format(...args));
    } catch {
      /* the tail must never break logging */
    }
  };
  target.log = wrap("info", original.log);
  target.info = wrap("info", original.info);
  target.warn = wrap("warn", original.warn);
  target.error = wrap("error", original.error);
  return () => Object.assign(target, original);
}
