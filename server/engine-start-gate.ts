// One limit on engine processes started while the server boots.
//
// An organization server restarts with every engine's catalog to refresh and
// every routine that came due while it was down. All of it used to start at
// once: on an organization server (2026-10-13, 5 GiB container) a restart caught up the overdue
// routines in the first tick, each one spawned its bot's engine CLI (an
// OpenCode ACP process alone holds about 550 MiB), the pooled processes then
// stayed up idle for ten minutes, and the kernel OOM-killed engine children
// within two minutes of the start.
//
// The gate admits at most `limit` engine processes at a time during the boot
// window. Two kinds of work take a slot:
//   - probes: a known engine CLI run to read its version, login or models
//     (procs.ts execCli, the OpenCode and Codex catalog probes). A probe
//     holds its slot until it exits, a few seconds.
//   - automatic turns: a routine run's turn (server/index.ts). It holds its
//     slot until the turn completes, and its engine process is closed then
//     instead of idling in the pool, so the next run starts in the memory
//     the last one freed.
// Probes are served before turns: they are short and the turns wait for
// what they read. Within a kind it is first come, first served. A person's
// own turn never waits here.
//
// After the window the gate admits at once, except work already queued,
// which keeps draining at the same limit so the window's end is not a burst.
// SAGAX_BOOT_ENGINE_SLOTS sets the limit (0 turns the gate off),
// SAGAX_BOOT_ENGINE_WINDOW_MS the window.

export type EngineSlotKind = "probe" | "turn";

export interface EngineSlot {
  /** Give the slot back. Safe to call more than once. */
  release(): void;
  /** True when this slot counted against the limit (queued or admitted in
   * the boot window), false when the gate let it through untouched. */
  readonly gated: boolean;
}

export interface EngineStartGateOptions {
  limit: number;
  windowMs: number;
  /** A slot never held longer than this, whatever its holder does: a lost
   * completion must not stall the boot queue for good. */
  maxHoldMs?: number;
  now?: () => number;
  log?: (line: string) => void;
}

interface Waiter {
  kind: EngineSlotKind;
  label: string;
  admit: (slot: EngineSlot) => void;
}

export const DEFAULT_BOOT_ENGINE_SLOTS = 2;
export const DEFAULT_BOOT_ENGINE_WINDOW_MS = 5 * 60_000;
export const DEFAULT_MAX_HOLD_MS = 15 * 60_000;

const UNGATED: EngineSlot = Object.freeze({ release: () => {}, gated: false });

export class EngineStartGate {
  readonly limit: number;
  readonly windowMs: number;
  private readonly maxHoldMs: number;
  private readonly now: () => number;
  private readonly log: (line: string) => void;
  private bootAt: number | null = null;
  private held = 0;
  private peakHeld = 0;
  private readonly waiting: Waiter[] = [];

  constructor(options: EngineStartGateOptions) {
    this.limit = Math.max(0, Math.floor(options.limit));
    this.windowMs = Math.max(0, options.windowMs);
    this.maxHoldMs = options.maxHoldMs ?? DEFAULT_MAX_HOLD_MS;
    this.now = options.now ?? Date.now;
    this.log = options.log ?? (() => {});
  }

  /** The server starts: the window opens now. Nothing is gated before. */
  beginBoot(): void {
    if (this.bootAt === null) this.bootAt = this.now();
  }

  /** Inside the boot window, with a limit set. */
  get booting(): boolean {
    return this.limit > 0 && this.bootAt !== null && this.now() - this.bootAt < this.windowMs;
  }

  /** Slots held right now, and the most ever held at once. */
  stats(): { held: number; waiting: number; peak: number } {
    return { held: this.held, waiting: this.waiting.length, peak: this.peakHeld };
  }

  /** Resolves once this work may start its engine process. */
  acquire(kind: EngineSlotKind, label: string = kind): Promise<EngineSlot> {
    // Outside the window only queued work is still gated; new work goes.
    if (!this.booting && this.waiting.length === 0) return Promise.resolve(UNGATED);
    if (this.held < this.limit && this.waiting.length === 0) return Promise.resolve(this.grant());
    return new Promise((admit) => {
      const waiter: Waiter = { kind, label, admit };
      // Probes go ahead of turns, in arrival order within each kind.
      const at = kind === "probe" ? this.waiting.findIndex((other) => other.kind === "turn") : -1;
      if (at === -1) this.waiting.push(waiter);
      else this.waiting.splice(at, 0, waiter);
      if (kind === "turn") this.log(`[engines] boot: ${label} waits for an engine slot (${this.held} running, ${this.waiting.length} waiting)`);
    });
  }

  /** `run` with a slot held from its start until it settles. */
  async run<T>(kind: EngineSlotKind, label: string, run: () => Promise<T>): Promise<T> {
    const slot = await this.acquire(kind, label);
    try {
      return await run();
    } finally {
      slot.release();
    }
  }

  private grant(): EngineSlot {
    this.held += 1;
    this.peakHeld = Math.max(this.peakHeld, this.held);
    let released = false;
    const timer = setTimeout(() => {
      this.log(`[engines] a slot was held past ${Math.round(this.maxHoldMs / 60_000)} min and is given back; its engine may still run`);
      release();
    }, this.maxHoldMs);
    timer.unref?.();
    const release = () => {
      if (released) return;
      released = true;
      clearTimeout(timer);
      this.held -= 1;
      this.drain();
    };
    return { release, gated: true };
  }

  private drain(): void {
    while (this.waiting.length && this.held < this.limit) {
      this.waiting.shift()!.admit(this.grant());
    }
  }
}

function envNumber(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

/** The server's gate. server/index.ts opens its window at start. */
export const engineStartGate = new EngineStartGate({
  limit: envNumber(process.env.SAGAX_BOOT_ENGINE_SLOTS, DEFAULT_BOOT_ENGINE_SLOTS),
  windowMs: envNumber(process.env.SAGAX_BOOT_ENGINE_WINDOW_MS, DEFAULT_BOOT_ENGINE_WINDOW_MS),
  log: (line) => console.log(line),
});

/** After the boot window, routine turns still start at most this many engine
 * processes at once (incident 2026-10-19: a 5 GiB organization server was
 * OOM-killed with 11 to 15 Claude sessions alive; server/engine-memory-guard.ts).
 * Same rules as the boot gate (first come, first served; the engine process
 * is closed when the routine's turn completes), with no window. Only
 * routine turns take a slot: a person's turn and a bot-to-bot turn never
 * wait here, so a routine that calls another bot cannot deadlock on its own
 * slot. SAGAX_ROUTINE_ENGINE_SLOTS sets it; 0 turns it off. Default 3 on a
 * Linux server, off on the desktop app. */
export const DEFAULT_ROUTINE_ENGINE_SLOTS = process.platform === "linux" && !process.versions.electron ? 3 : 0;
export const routineEngineGate = new EngineStartGate({
  limit: envNumber(process.env.SAGAX_ROUTINE_ENGINE_SLOTS, DEFAULT_ROUTINE_ENGINE_SLOTS),
  windowMs: Number.POSITIVE_INFINITY,
  // a routine run may last its whole timeout; longer is logged and let go
  maxHoldMs: 60 * 60_000,
  log: (line) => console.log(line),
});
routineEngineGate.beginBoot();
