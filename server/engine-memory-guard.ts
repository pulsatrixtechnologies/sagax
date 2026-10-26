// Memory guard for the engine processes a server keeps.
//
// Incident 2026-10-19 (GOX organization server, 5 GiB container): the kernel
// OOM-killed the container four times in three hours. The kernel's task
// lists at each kill read the same: 11 to 15 `claude` CLIs (about 125 MiB
// anonymous each) and 133 to 174 small Node processes (about 21 MiB each:
// the stdio MCP proxies every Claude session starts, about 13 per session),
// against 300 to 600 MiB for the server itself. One live Claude session costs
// about 400 MiB with its proxies, and finished sessions stay up for ten
// minutes (drivers/session-idle.ts) with nothing bounding how many. Routines
// were few (1 to 5 per ten minutes); the load was bot conversations and
// bot-to-bot work, which re-spawn Claude about 15 times per ten minutes.
// The kernel then picked the largest single process, the server, and every
// session, turn and routine of the organization went with it.
//
// Three guards, none of which ever stops a turn that is running:
//   1. IdleEnginePool: at most `maxIdle` finished sessions stay warm; the
//      oldest idle one is closed when another finishes (LRU).
//   2. MemoryWatch: reads the container's cgroup every `intervalMs`. At the
//      high mark it closes every idle session; at the critical mark it logs
//      an alert and holds new routine turns (server/index.ts) until usage
//      falls back. A summary line is logged every five minutes.
//   3. Child OOM priority: engine processes and their descendants get a
//      raised oom_score_adj, so a kernel OOM kill takes one engine (one
//      turn) instead of the server.
//
// Env: SAGAX_MAX_IDLE_ENGINE_SESSIONS (default 4 on Linux, unbounded
// elsewhere; 0 = close each session as its turn ends), SAGAX_MEMORY_WATCH_MS (default 15000, 0 = off),
// SAGAX_MEMORY_HIGH_RATIO (0.75), SAGAX_MEMORY_CRITICAL_RATIO (0.88),
// SAGAX_CHILD_OOM_SCORE_ADJ (default 500, 0 = off; Linux only).

import { readFileSync, readdirSync, writeFileSync } from "node:fs";

export type MemoryLevel = "ok" | "high" | "critical" | "unknown";

export interface CgroupMemory {
  /** The working set in bytes: the charge minus inactive file cache, the
   * figure docker stats and the kubelet use. Page cache the kernel can
   * reclaim must not read as pressure. */
  current: number;
  /** The limit in bytes, or null when unlimited. */
  max: number | null;
  /** Highest charge since the cgroup started, when the kernel reports it. */
  peak: number | null;
  /** Kernel OOM kills in this cgroup so far, when reported. */
  oomKills: number | null;
}

type ReadText = (path: string) => string | null;

const readText: ReadText = (path) => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
};

function parseBytes(raw: string | null): number | null {
  if (raw === null) return null;
  const text = raw.trim();
  if (!/^\d+$/.test(text)) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

/** The container's memory, from cgroup v2 then v1. Null outside a cgroup
 * that reports it (macOS, Windows, the desktop app). A v1 limit near
 * 2^63 means unlimited. */
export function readCgroupMemory(read: ReadText = readText, root = "/sys/fs/cgroup"): CgroupMemory | null {
  const usage = parseBytes(read(`${root}/memory.current`));
  if (usage !== null) {
    const current = workingSet(usage, read(`${root}/memory.stat`), "inactive_file");
    const maxRaw = read(`${root}/memory.max`)?.trim();
    const max = maxRaw && maxRaw !== "max" ? parseBytes(maxRaw) : null;
    const events = read(`${root}/memory.events`) ?? "";
    const kills = /^oom_kill (\d+)$/m.exec(events);
    return { current, max, peak: parseBytes(read(`${root}/memory.peak`)), oomKills: kills ? Number(kills[1]) : null };
  }
  const v1 = parseBytes(read(`${root}/memory/memory.usage_in_bytes`));
  if (v1 === null) return null;
  const limit = parseBytes(read(`${root}/memory/memory.limit_in_bytes`));
  return {
    current: workingSet(v1, read(`${root}/memory/memory.stat`), "total_inactive_file"),
    max: limit !== null && limit < 2 ** 60 ? limit : null,
    peak: parseBytes(read(`${root}/memory/memory.max_usage_in_bytes`)),
    oomKills: null,
  };
}

function workingSet(usage: number, stat: string | null, key: string): number {
  const match = stat ? new RegExp(`^${key} (\\d+)$`, "m").exec(stat) : null;
  const inactive = match ? Number(match[1]) : 0;
  return Math.max(0, usage - (Number.isFinite(inactive) ? inactive : 0));
}

export function memoryLevel(memory: CgroupMemory | null, highRatio: number, criticalRatio: number): MemoryLevel {
  if (!memory || !memory.max) return "unknown";
  const ratio = memory.current / memory.max;
  if (ratio >= criticalRatio) return "critical";
  if (ratio >= highRatio) return "high";
  return "ok";
}

interface IdleEntry {
  since: number;
  release: () => void;
}

export interface IdleEnginePoolOptions {
  maxIdle: number;
  /** Entries older than this are forgotten: the driver closed them itself. */
  ttlMs: number;
  /** A thread whose warm process must stay (a live call). */
  exempt?: (threadId: string) => boolean;
  now?: () => number;
  log?: (line: string) => void;
}

/** Finished engine sessions still warm, oldest first. Only idle processes
 * are ever released: a thread that starts a turn leaves the pool first, and
 * the drivers' releaseWarmSession refuses a process a turn owns. */
export class IdleEnginePool {
  readonly maxIdle: number;
  private readonly ttlMs: number;
  private readonly exempt: (threadId: string) => boolean;
  private readonly now: () => number;
  private readonly log: (line: string) => void;
  private readonly idle = new Map<string, IdleEntry>();
  private evictions = 0;

  constructor(options: IdleEnginePoolOptions) {
    this.maxIdle = Math.max(0, Math.floor(options.maxIdle));
    this.ttlMs = Math.max(0, options.ttlMs);
    this.exempt = options.exempt ?? (() => false);
    this.now = options.now ?? Date.now;
    this.log = options.log ?? (() => {});
  }

  /** A turn finished; its process may stay warm. */
  noteIdle(threadId: string, release: () => void): void {
    this.idle.delete(threadId);
    this.idle.set(threadId, { since: this.now(), release });
    this.prune();
    this.enforce();
  }

  /** A turn starts on this thread: its process is no longer idle. */
  noteBusy(threadId: string): void {
    this.idle.delete(threadId);
  }

  /** Whether this thread has a finished (or pre-warmed) process kept warm. */
  has(threadId: string): boolean {
    this.prune();
    return this.idle.has(threadId);
  }

  /** The process is gone (session exited). */
  forget(threadId: string): void {
    this.idle.delete(threadId);
  }

  /** Close every idle process (memory pressure). Returns how many. */
  releaseAll(why: string): number {
    this.prune();
    let closed = 0;
    for (const threadId of Array.from(this.idle.keys())) {
      if (this.exempt(threadId)) continue;
      if (this.evict(threadId)) closed += 1;
    }
    if (closed) this.log(`[memory] closed ${closed} idle engine session(s): ${why}`);
    return closed;
  }

  stats(): { idle: number; maxIdle: number; evictions: number } {
    this.prune();
    return { idle: this.idle.size, maxIdle: this.maxIdle, evictions: this.evictions };
  }

  private enforce(): void {
    for (const threadId of Array.from(this.idle.keys())) {
      if (this.countable() <= this.maxIdle) return;
      if (this.exempt(threadId)) continue;
      this.evict(threadId);
    }
  }

  private countable(): number {
    let n = 0;
    for (const threadId of this.idle.keys()) if (!this.exempt(threadId)) n += 1;
    return n;
  }

  private evict(threadId: string): boolean {
    const entry = this.idle.get(threadId);
    if (!entry) return false;
    this.idle.delete(threadId);
    this.evictions += 1;
    try {
      entry.release();
    } catch {
      // already closed
    }
    return true;
  }

  private prune(): void {
    const cutoff = this.now() - this.ttlMs;
    for (const [threadId, entry] of this.idle) if (entry.since < cutoff) this.idle.delete(threadId);
  }
}

/** Raise a process's OOM score so the kernel kills it before the server.
 * Raising needs no privilege for a process of the same user. Best effort. */
export function markOomVictim(pid: number | undefined, adj: number, write: (path: string, text: string) => void = writeFileSync): boolean {
  if (!pid || !Number.isInteger(pid) || pid <= 1 || pid === process.pid || adj <= 0) return false;
  try {
    write(`/proc/${pid}/oom_score_adj`, String(Math.min(1000, Math.floor(adj))));
    return true;
  } catch {
    return false;
  }
}

export interface ProcFs {
  pids(): number[];
  /** The parent pid from /proc/<pid>/stat, or null when gone. */
  ppid(pid: number): number | null;
  /** The current oom_score_adj, or null when gone. */
  oomScoreAdj(pid: number): number | null;
  write(path: string, text: string): void;
}

const linuxProc: ProcFs = {
  pids: () => {
    try {
      return readdirSync("/proc").filter((name) => /^\d+$/.test(name)).map(Number);
    } catch {
      return [];
    }
  },
  ppid: (pid) => {
    const stat = readText(`/proc/${pid}/stat`);
    if (!stat) return null;
    // the command name may hold spaces and parentheses: read after the last ")"
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    const value = Number(fields[1]);
    return Number.isInteger(value) ? value : null;
  },
  oomScoreAdj: (pid) => {
    const text = readText(`/proc/${pid}/oom_score_adj`)?.trim();
    return text && /^-?\d+$/.test(text) ? Number(text) : null;
  },
  write: (path, text) => writeFileSync(path, text),
};

/** Raise the OOM score of every descendant of `root` still below `adj`
 * (engines spawn MCP proxies and browsers the spawn hook never sees).
 * Returns how many were raised. */
export function sweepOomScores(adj: number, root = process.pid, proc: ProcFs = linuxProc): number {
  if (adj <= 0) return 0;
  const children = new Map<number, number[]>();
  for (const pid of proc.pids()) {
    const parent = proc.ppid(pid);
    if (parent === null) continue;
    const list = children.get(parent);
    if (list) list.push(pid);
    else children.set(parent, [pid]);
  }
  let raised = 0;
  const stack = [...(children.get(root) ?? [])];
  const seen = new Set<number>();
  while (stack.length) {
    const pid = stack.pop()!;
    if (seen.has(pid)) continue;
    seen.add(pid);
    stack.push(...(children.get(pid) ?? []));
    const current = proc.oomScoreAdj(pid);
    if (current === null || current >= adj) continue;
    if (markOomVictim(pid, adj, proc.write)) raised += 1;
  }
  return raised;
}

export interface MemoryWatchOptions {
  pool: IdleEnginePool;
  intervalMs: number;
  highRatio: number;
  criticalRatio: number;
  childOomScoreAdj: number;
  read?: () => CgroupMemory | null;
  sweep?: (adj: number) => number;
  /** Live engine processes, for the summary line. */
  liveEngines?: () => number;
  summaryEveryMs?: number;
  now?: () => number;
  log?: (line: string) => void;
  warn?: (line: string) => void;
}

const MIB = 1024 * 1024;

export class MemoryWatch {
  private readonly options: Required<Omit<MemoryWatchOptions, "liveEngines">> & Pick<MemoryWatchOptions, "liveEngines">;
  private timer: ReturnType<typeof setInterval> | null = null;
  private level: MemoryLevel = "unknown";
  private last: CgroupMemory | null = null;
  private lastSummary = 0;
  private lastOomKills: number | null = null;
  private waiters: Array<() => void> = [];

  constructor(options: MemoryWatchOptions) {
    this.options = {
      read: () => readCgroupMemory(),
      sweep: (adj) => (process.platform === "linux" ? sweepOomScores(adj) : 0),
      summaryEveryMs: 5 * 60_000,
      now: Date.now,
      log: (line) => console.log(line),
      warn: (line) => console.error(line),
      ...options,
    };
  }

  start(): void {
    if (this.timer || this.options.intervalMs <= 0) return;
    this.tick();
    if (this.level === "unknown" && this.last === null && this.options.childOomScoreAdj <= 0) return;
    this.timer = setInterval(() => this.tick(), this.options.intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.flushWaiters();
  }

  /** One reading; exported for tests and for a check before a spawn. */
  tick(): MemoryLevel {
    const memory = this.options.read();
    this.last = memory;
    const next = memoryLevel(memory, this.options.highRatio, this.options.criticalRatio);
    const previous = this.level;
    this.level = next;
    if (this.options.childOomScoreAdj > 0) {
      try {
        this.options.sweep(this.options.childOomScoreAdj);
      } catch {
        // best effort
      }
    }
    if (memory?.oomKills != null) {
      if (this.lastOomKills !== null && memory.oomKills > this.lastOomKills) {
        this.options.warn(`[memory] ALERT kernel OOM-killed ${memory.oomKills - this.lastOomKills} process(es) in this container (${this.describe()})`);
      }
      this.lastOomKills = memory.oomKills;
    }
    if (next === "high" || next === "critical") this.options.pool.releaseAll(`memory ${next} (${this.describe()})`);
    if (next === "critical" && previous !== "critical") {
      this.options.warn(`[memory] ALERT critical: ${this.describe()}; idle engines closed, new routine turns held`);
    } else if (next === "high" && previous === "ok") {
      this.options.log(`[memory] high: ${this.describe()}; idle engines closed`);
    } else if (next === "ok" && (previous === "high" || previous === "critical")) {
      this.options.log(`[memory] back to normal: ${this.describe()}`);
    }
    if (next !== "critical") this.flushWaiters();
    const now = this.options.now();
    if (memory && now - this.lastSummary >= this.options.summaryEveryMs) {
      this.lastSummary = now;
      this.options.log(`[memory] ${this.describe()}`);
    }
    return next;
  }

  current(): MemoryLevel {
    return this.level;
  }

  stats(): { level: MemoryLevel; currentMiB: number | null; maxMiB: number | null; peakMiB: number | null; idle: number; maxIdle: number; evictions: number } {
    const m = this.last;
    return {
      level: this.level,
      currentMiB: m ? Math.round(m.current / MIB) : null,
      maxMiB: m?.max ? Math.round(m.max / MIB) : null,
      peakMiB: m?.peak ? Math.round(m.peak / MIB) : null,
      ...this.options.pool.stats(),
    };
  }

  /** Resolves once memory is below the critical mark, or after `maxWaitMs`
   * (a stuck reading must never hold work forever). */
  whenBelowCritical(maxWaitMs: number): Promise<void> {
    if (this.level !== "critical" || !this.timer) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.waiters = this.waiters.filter((w) => w !== done);
        resolve();
      };
      const timer = setTimeout(() => {
        this.options.warn(`[memory] a routine waited ${Math.round(maxWaitMs / 60_000)} min for memory and starts anyway (${this.describe()})`);
        done();
      }, Math.max(0, maxWaitMs));
      timer.unref?.();
      this.waiters.push(done);
    });
  }

  private flushWaiters(): void {
    for (const waiter of this.waiters.splice(0)) waiter();
  }

  private describe(): string {
    const m = this.last;
    if (!m) return "no cgroup reading";
    const pct = m.max ? ` (${Math.round((m.current / m.max) * 100)}%)` : "";
    const peak = m.peak ? `, peak ${Math.round(m.peak / MIB)} MiB` : "";
    const live = this.options.liveEngines ? `, engines running ${this.options.liveEngines()}` : "";
    const pool = this.options.pool.stats();
    return `used ${Math.round(m.current / MIB)}/${m.max ? Math.round(m.max / MIB) : "unlimited"} MiB${pct}${peak}${live}, idle warm ${pool.idle}/${pool.maxIdle}`;
  }
}

function envNumber(raw: string | undefined, fallback: number, max = Number.MAX_SAFE_INTEGER): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 && value <= max ? value : fallback;
}

function envRatio(raw: string | undefined, fallback: number): number {
  const value = envNumber(raw, fallback, 1);
  return value > 0 ? value : fallback;
}

export interface MemoryGuardSettings {
  maxIdle: number;
  intervalMs: number;
  highRatio: number;
  criticalRatio: number;
  childOomScoreAdj: number;
}

export function memoryGuardSettings(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  desktop: boolean = Boolean(process.versions.electron),
): MemoryGuardSettings {
  const server = platform === "linux" && !desktop;
  const highRatio = envRatio(env.SAGAX_MEMORY_HIGH_RATIO, 0.75);
  const criticalRatio = Math.max(highRatio, envRatio(env.SAGAX_MEMORY_CRITICAL_RATIO, 0.88));
  return {
    // the desktop app keeps its warm sessions unbounded, as before
    maxIdle: Math.floor(envNumber(env.SAGAX_MAX_IDLE_ENGINE_SESSIONS, server ? 4 : Number.POSITIVE_INFINITY, 1_000)),
    intervalMs: envNumber(env.SAGAX_MEMORY_WATCH_MS, 15_000, 3_600_000),
    highRatio,
    criticalRatio,
    childOomScoreAdj: server ? Math.floor(envNumber(env.SAGAX_CHILD_OOM_SCORE_ADJ, 500, 1_000)) : 0,
  };
}
