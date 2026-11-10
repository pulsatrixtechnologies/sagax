// Stall watchdog for admitted turns, including setup.
//
// Teammate hand-offs run on the job runtime's clocks, while room turns have a separately
// configurable absolute ceiling. The main 1:1 path had none: a wedged CLI
// (hung network call, dead MCP child,
// a provider that stops streaming without exiting) left its bot busy
// forever — composer locked, screen poller running — until an interrupt or
// an app restart. This watchdog watches ACTIVITY, not duration: a turn may
// legitimately run for an hour while events keep flowing, but a turn whose
// thread has emitted nothing at all for `stallMs` is wedged. Turns parked
// on a human approval are exempt — waiting on a person is not a stall.
//
// Drivers report a tool only when it starts and when it ends, so a build or a
// test suite that prints nothing for half an hour looks wedged. While one of
// the turn's tools is still running the turn may stay silent for
// `toolStallMs` instead: a hard bound of its own, so a tool that truly hangs
// still ends the turn. Any event starts the silence over.
//
// A turn parked on a person or a computer waits on, unless its engine is
// known to have no process left for it: then nothing will ever answer that
// wait, and the turn stops once it has been silent for `parkedStallMs`.
//
// A conversation shown working that nothing holds (no watched turn, no
// dispatch, no engine) would hold every message queued behind it forever:
// once it has stayed so for `stallMs`, `unheld.free` frees it.
import { processAlive } from "../browser/browser-processes.ts";
import type { ProviderAdapter, RuntimeEvent } from "../contracts.ts";

export interface WatchedTurn {
  threadId: string;
  botId: string;
  startedAt: number;
  lastEventAt: number;
  waitingOnHuman: boolean;
  waitingOnComputer: boolean;
  /** Tool items this turn started and has not reported ended. */
  runningTools: Set<string>;
  /** When each of runningTools started (#3461: "Running tests · 6 min"). */
  toolStartedAt: Map<string, number>;
}

/** What a reader may know of an open turn (TurnWatchdog.peek): a copy, so
 * reading it never changes the watchdog. */
export interface TurnPeek {
  threadId: string;
  botId: string;
  startedAt: number;
  lastEventAt: number;
  waitingOnHuman: boolean;
  waitingOnComputer: boolean;
  /** The oldest tool call still running started then. */
  toolSince?: number;
}

function peekOf(turn: WatchedTurn): TurnPeek {
  let toolSince: number | undefined;
  for (const id of turn.runningTools) {
    const at = turn.toolStartedAt.get(id) ?? turn.lastEventAt;
    if (toolSince === undefined || at < toolSince) toolSince = at;
  }
  return {
    threadId: turn.threadId, botId: turn.botId, startedAt: turn.startedAt, lastEventAt: turn.lastEventAt,
    waitingOnHuman: turn.waitingOnHuman, waitingOnComputer: turn.waitingOnComputer,
    ...(toolSince !== undefined ? { toolSince } : {}),
  };
}

/** A silence limit from the environment, in whole milliseconds. Number() also
 * reads "Infinity" and "1e309" as numbers, and an endless limit would switch
 * the watchdog off: anything not positive and finite keeps the fallback. */
export function stallLimitMs(raw: string | undefined, fallback: number): number {
  const ms = Number(raw);
  return Number.isFinite(ms) && ms > 0 ? ms : fallback;
}

/** The engine is known to run no process for the thread's turn: its driver
 * tracks one and has none, or the one it names has exited. A driver that
 * tracks no process proves nothing, so this is false for it. */
export function engineProcessGone(adapter: Pick<ProviderAdapter, "enginePid"> | null | undefined, threadId: string, alive = processAlive): boolean {
  if (!adapter?.enginePid) return false;
  const pid = adapter.enginePid(threadId);
  return pid === undefined || !alive(pid);
}

/** A sweep later than this many intervals means the process was suspended
 * (the computer slept) in between. */
const SUSPENDED_SWEEPS = 3;

const parked = (turn: WatchedTurn): boolean => turn.waitingOnHuman || turn.waitingOnComputer;

export interface TurnWatchdogOptions {
  stallMs: number;
  /** The silence allowed while one of the turn's tools runs; never below stallMs. */
  toolStallMs: number;
  /** The silence that stops a parked turn whose engine is known to be gone:
   * longer than any wait the harness bounds itself. Absent: a parked turn
   * always waits on. */
  parkedStallMs?: number;
  checkMs: number;
  /** The turn's engine is known to have no process left for it; absent or
   * false, a parked turn waits on. */
  engineGone?: (turn: WatchedTurn) => boolean;
  /** Called once per stalled turn, after the entry is removed, with the
   * silence that stopped it (stallMs, toolStallMs or parkedStallMs). */
  onStall: (turn: WatchedTurn, silentMs: number) => void;
  /** The conversations shown working that nothing holds but, maybe, a
   * watched turn (no dispatch claim, engine or settling turn): one no
   * watched turn holds either is freed once it has stayed so for stallMs. */
  unheld?: { threads(): Iterable<{ threadId: string; botId: string }>; free(threadId: string, botId: string): void };
  now?: () => number;
}

export class TurnWatchdog {
  private turns = new Map<string, WatchedTurn>();
  private unheldSince = new Map<string, number>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private opts: TurnWatchdogOptions;

  // a plain field assignment, not a parameter property — the server runs
  // under Node's type-stripping, which cannot transform the latter
  constructor(opts: TurnWatchdogOptions) {
    this.opts = opts;
  }

  private now(): number {
    return this.opts.now?.() ?? Date.now();
  }

  start(): void {
    if (this.timer) return;
    // Real time, not now(): a sleeping computer suspends the process while
    // the wall clock runs on, so the timer fires that much late, and that
    // time was not the turns' silence.
    let lastTickAt = Date.now();
    this.timer = setInterval(() => {
      const at = Date.now();
      const gap = at - lastTickAt;
      lastTickAt = at;
      this.sweep(gap > SUSPENDED_SWEEPS * this.opts.checkMs ? gap : 0);
    }, this.opts.checkMs);
    // never hold the process open just to watch for stalls
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.turns.clear();
    this.unheldSince.clear();
  }

  /** A turn was admitted on this thread. */
  watch(threadId: string, botId: string): void {
    const at = this.now();
    this.turns.set(threadId, { threadId, botId, startedAt: at, lastEventAt: at, waitingOnHuman: false, waitingOnComputer: false,
      runningTools: new Set(), toolStartedAt: new Map() });
  }

  /** Any provider event for the thread proves the turn is alive; a tool item's
   * start and end say whether one of its tools is still running. */
  observe(event: RuntimeEvent): void {
    const turn = this.turns.get(event.threadId);
    if (!turn) return;
    turn.lastEventAt = this.now();
    if ((event.type !== "item.started" && event.type !== "item.completed") || event.itemType !== "tool" || !event.itemId) return;
    if (event.type === "item.completed") {
      turn.runningTools.delete(event.itemId);
      turn.toolStartedAt.delete(event.itemId);
    } else if (!turn.runningTools.has(event.itemId)) {
      turn.runningTools.add(event.itemId);
      turn.toolStartedAt.set(event.itemId, turn.lastEventAt);
    }
  }

  /** request.opened → true (a human is deciding; not a stall however long
   * they take); request.resolved → false (the clock restarts). */
  setWaitingOnHuman(threadId: string, waiting: boolean): void {
    const turn = this.turns.get(threadId);
    if (!turn) return;
    turn.waitingOnHuman = waiting;
    turn.lastEventAt = this.now();
  }

  /** Shared-computer waits have their own bounded deadline. Waiting for
   * another turn to release the computer is not a silent provider stall. */
  setWaitingOnComputer(threadId: string, waiting: boolean): void {
    const turn = this.turns.get(threadId);
    if (!turn) return;
    turn.waitingOnComputer = waiting;
    turn.lastEventAt = this.now();
  }

  /** The turn settled normally — stop watching it. */
  settle(threadId: string): void {
    this.turns.delete(threadId);
  }

  /** A Stop that discards the turn's later events leaves no way for a tool or
   * a wait to report its end: watch the teardown as a fresh silent turn. */
  eventsDiscarded(threadId: string): void {
    const turn = this.turns.get(threadId);
    if (turn) this.watch(threadId, turn.botId);
  }

  watching(threadId: string): boolean {
    return this.turns.has(threadId);
  }

  /** The open turn of this thread, as a reader may know it; writes nothing. */
  peek(threadId: string): TurnPeek | undefined {
    const turn = this.turns.get(threadId);
    return turn ? peekOf(turn) : undefined;
  }

  /** The open turns of a bot, in every thread. */
  openTurns(botId: string): TurnPeek[] {
    const out: TurnPeek[] = [];
    for (const turn of this.turns.values()) if (turn.botId === botId) out.push(peekOf(turn));
    return out;
  }

  /** Visible for tests; the interval calls this.
   *
   * sleptMs: the real time since the last sweep when the process was
   * suspended; it is forgiven, not counted as silence. It may include up to
   * one checkMs of awake time, so a stall after a sleep is caught up to one
   * checkMs late, the same lag a sweep already has; never early. */
  sweep(sleptMs = 0): void {
    const at = this.now();
    for (const turn of this.turns.values()) {
      if (sleptMs) turn.lastEventAt = Math.min(at, turn.lastEventAt + sleptMs);
      const silentMs = this.silenceLimit(turn);
      if (silentMs === null || at - turn.lastEventAt < silentMs) continue;
      this.turns.delete(turn.threadId);
      this.opts.onStall(turn, silentMs);
    }
    this.freeUnheld(at, sleptMs);
  }

  /** null: the turn may wait on, parked while its engine is not known to be gone. */
  private silenceLimit(turn: WatchedTurn): number | null {
    if (parked(turn)) {
      return this.opts.parkedStallMs !== undefined && this.opts.engineGone?.(turn) ? this.opts.parkedStallMs : null;
    }
    return turn.runningTools.size > 0 ? Math.max(this.opts.stallMs, this.opts.toolStallMs) : this.opts.stallMs;
  }

  private freeUnheld(at: number, sleptMs: number): void {
    const unheld = this.opts.unheld;
    if (!unheld) return;
    const still = new Map<string, number>();
    for (const { threadId, botId } of unheld.threads()) {
      if (this.turns.has(threadId)) continue;
      const seen = this.unheldSince.get(threadId);
      const since = seen === undefined ? at : Math.min(at, seen + sleptMs);
      if (at - since < this.opts.stallMs) still.set(threadId, since);
      else unheld.free(threadId, botId);
    }
    this.unheldSince = still;
  }
}
