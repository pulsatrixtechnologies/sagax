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
import type { RuntimeEvent } from "../contracts.ts";

export interface WatchedTurn {
  threadId: string;
  botId: string;
  startedAt: number;
  lastEventAt: number;
  waitingOnHuman: boolean;
  waitingOnComputer: boolean;
  /** Tool items this turn started and has not reported ended. */
  runningTools: Set<string>;
}

/** A silence limit from the environment, in whole milliseconds. Number() also
 * reads "Infinity" and "1e309" as numbers, and an endless limit would switch
 * the watchdog off: anything not positive and finite keeps the fallback. */
export function stallLimitMs(raw: string | undefined, fallback: number): number {
  const ms = Number(raw);
  return Number.isFinite(ms) && ms > 0 ? ms : fallback;
}

export interface TurnWatchdogOptions {
  stallMs: number;
  /** The silence allowed while one of the turn's tools runs; never below stallMs. */
  toolStallMs: number;
  checkMs: number;
  /** Called once per stalled turn, after the entry is removed, with the
   * silence that stopped it (stallMs or toolStallMs). */
  onStall: (turn: WatchedTurn, silentMs: number) => void;
  now?: () => number;
}

export class TurnWatchdog {
  private turns = new Map<string, WatchedTurn>();
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
    this.timer = setInterval(() => this.sweep(), this.opts.checkMs);
    // never hold the process open just to watch for stalls
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.turns.clear();
  }

  /** A turn was admitted on this thread. */
  watch(threadId: string, botId: string): void {
    const at = this.now();
    this.turns.set(threadId, { threadId, botId, startedAt: at, lastEventAt: at, waitingOnHuman: false, waitingOnComputer: false,
      runningTools: new Set() });
  }

  /** Any provider event for the thread proves the turn is alive; a tool item's
   * start and end say whether one of its tools is still running. */
  observe(event: RuntimeEvent): void {
    const turn = this.turns.get(event.threadId);
    if (!turn) return;
    turn.lastEventAt = this.now();
    if ((event.type !== "item.started" && event.type !== "item.completed") || event.itemType !== "tool" || !event.itemId) return;
    if (event.type === "item.completed") turn.runningTools.delete(event.itemId);
    else turn.runningTools.add(event.itemId);
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

  /** Visible for tests; the interval calls this. */
  sweep(): void {
    const at = this.now();
    for (const turn of this.turns.values()) {
      if (turn.waitingOnHuman || turn.waitingOnComputer) continue;
      const silentMs = turn.runningTools.size > 0 ? Math.max(this.opts.stallMs, this.opts.toolStallMs) : this.opts.stallMs;
      if (at - turn.lastEventAt < silentMs) continue;
      this.turns.delete(turn.threadId);
      this.opts.onStall(turn, silentMs);
    }
  }
}
