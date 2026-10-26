// Pre-warm (2026-10-19 perf parity, point 1): start a thread's engine before
// its first message, so a cold turn costs what a warm one does. Triggered when
// the person opens a bot's conversation or starts typing in its composer, and
// shortly before a scheduled routine. Built on the warmOnly path of voice
// calls (server/contracts.ts): the pooled process starts, no prompt is
// written, no turn is shown. Nothing is wasted for long: when no message
// arrives within the window, the signal aborts and the driver closes the
// idle process it started (a process a real turn took over stays up).

/** How long a warm waits for a message before its process is closed. */
export function prewarmWindowMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.SAGAX_PREWARM_WINDOW_MS);
  if (Number.isFinite(raw) && raw >= 0) return Math.min(Math.floor(raw), 10 * 60_000);
  return 90_000;
}

/** New warms one person may start per minute (a refresh is free). */
export const PREWARM_PER_PERSON_PER_MINUTE = 6;
/** Warm processes waiting for a message at once, server wide: a person types
 * in one conversation at a time. A new warm closes the oldest. */
export const PREWARM_MAX_WAITING = 3;

/** At most this many teammates warmed for one request. */
export const NAMED_TEAMMATES_MAX = 2;

/** The teammates a person's request names (perf round 3: their engines start
 * while the bot reads the request, so a delegation does not wait for a cold
 * start): its @mentions first, then a teammate's whole name as a word,
 * case-insensitive, 3 characters or more. Hidden bots never. */
export function namedTeammates<T extends { id: string; name: string; hidden?: boolean }>(text: string, peers: readonly T[], tagged: readonly T[]): T[] {
  const out = tagged.filter((peer) => !peer.hidden);
  const lower = text.toLowerCase();
  const word = /[\p{L}\p{N}_]/u;
  for (const peer of peers) {
    if (out.length >= NAMED_TEAMMATES_MAX) break;
    const name = peer.name.trim().toLowerCase();
    if (peer.hidden || name.length < 3 || out.some((p) => p.id === peer.id)) continue;
    for (let at = lower.indexOf(name); at !== -1; at = lower.indexOf(name, at + 1)) {
      const before = at === 0 ? "" : lower[at - 1]!;
      const after = lower[at + name.length] ?? "";
      if (!word.test(before) && !word.test(after)) {
        out.push(peer);
        break;
      }
    }
  }
  return out.slice(0, NAMED_TEAMMATES_MAX);
}

export type PrewarmBegin = "started" | "extended" | "limited";

type Job = {
  controller: AbortController;
  timer: ReturnType<typeof setTimeout> | null;
  setup: Promise<void>;
};

export interface ThreadPrewarmOptions {
  windowMs: number;
  perPersonPerMinute?: number;
  maxWaiting?: number;
  now?: () => number;
}

/** One warm per thread: dedupe, window, per-person rate. Pure bookkeeping;
 * the caller's `run` starts the engine and resolves once its setup is done. */
export class ThreadPrewarm {
  private readonly jobs = new Map<string, Job>();
  private readonly starts = new Map<string, number[]>();
  private readonly windowMs: number;
  private readonly perMinute: number;
  private readonly maxWaiting: number;
  private readonly now: () => number;

  constructor(options: ThreadPrewarmOptions) {
    this.windowMs = Math.max(0, options.windowMs);
    this.perMinute = Math.max(1, options.perPersonPerMinute ?? PREWARM_PER_PERSON_PER_MINUTE);
    this.maxWaiting = Math.max(1, options.maxWaiting ?? PREWARM_MAX_WAITING);
    this.now = options.now ?? Date.now;
  }

  /** Start a warm, or push back the window of the one already there. */
  begin(threadId: string, person: string, run: (signal: AbortSignal) => Promise<void>, windowMs = this.windowMs): PrewarmBegin {
    const existing = this.jobs.get(threadId);
    if (existing) {
      // the newest use moves to the back of the eviction order
      this.jobs.delete(threadId);
      this.jobs.set(threadId, existing);
      this.arm(threadId, existing, windowMs);
      return "extended";
    }
    const at = this.now();
    const recent = (this.starts.get(person) ?? []).filter((t) => at - t < 60_000);
    if (recent.length >= this.perMinute) {
      this.starts.set(person, recent);
      return "limited";
    }
    recent.push(at);
    this.starts.set(person, recent);
    if (this.starts.size > 1_000) this.starts.clear();
    // Map order is insertion order: the first key is the oldest warm.
    while (this.jobs.size >= this.maxWaiting) {
      const oldest = this.jobs.keys().next().value;
      if (oldest === undefined) break;
      this.cancel(oldest);
    }
    const controller = new AbortController();
    const job: Job = { controller, timer: null, setup: Promise.resolve() };
    this.jobs.set(threadId, job);
    this.arm(threadId, job, windowMs);
    job.setup = (async () => {
      try {
        await run(controller.signal);
      } catch {
        // the run reports its own failure; join must still resolve
      }
    })();
    return "started";
  }

  /** Resolves once the warm of this thread (if any) finished its setup. */
  join(threadId: string): Promise<void> {
    return this.jobs.get(threadId)?.setup ?? Promise.resolve();
  }

  /** A real turn takes the thread: forget the warm without aborting it (the
   * turn owns the process now; an abort could only close an idle one). */
  claim(threadId: string): void {
    const job = this.jobs.get(threadId);
    if (!job) return;
    if (job.timer) clearTimeout(job.timer);
    this.jobs.delete(threadId);
  }

  /** Abort the warm: the driver closes the idle process it started. */
  cancel(threadId: string): boolean {
    const job = this.jobs.get(threadId);
    if (!job) return false;
    if (job.timer) clearTimeout(job.timer);
    this.jobs.delete(threadId);
    job.controller.abort();
    return true;
  }

  has(threadId: string): boolean {
    return this.jobs.has(threadId);
  }

  size(): number {
    return this.jobs.size;
  }

  private arm(threadId: string, job: Job, windowMs: number): void {
    if (job.timer) clearTimeout(job.timer);
    job.timer = setTimeout(() => {
      if (this.jobs.get(threadId) !== job) return;
      this.jobs.delete(threadId);
      job.controller.abort();
    }, Math.max(0, windowMs));
    job.timer.unref?.();
  }
}
