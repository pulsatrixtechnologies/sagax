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
//
// A shell command whose processes keep using CPU is working, not silent,
// however long it runs (port of OpenMausBot #5585); a turn whose engine
// process has exited waits only `engineExitStallMs` (port of #5967).
import { processAlive } from "../browser/browser-processes.ts";
import type { ProviderAdapter, RuntimeEvent } from "../contracts.ts";
import { sampleProcessTree, type ProcessSample } from "../drivers/acp/quiet-status.ts";
import { redactSecretsInText } from "../../shared/redact.ts";

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
  /** The shell command a running tool runs, when its start named one. */
  toolCommand?: Map<string, string>;
}

/** Why the watchdog stopped a turn: it went silent, or the process running
 * its engine exited and the turn can never answer. */
export type StallReason = "silent" | "engine-exited";

/** The silence that stops a turn whose engine process has exited: long
 * enough for the driver to report the turn's own end, not the tool limit. */
export const ENGINE_EXIT_STALL_MS = 2 * 60_000;

/** CPU time a silent command must gain between two reads to count as
 * working: an idle engine's own timers never reach it. */
const COMMAND_CPU_STEP_MS = 1_000;

/** The longest-running shell command of a turn, with when it started. */
function oldestCommand(turn: Partial<Pick<WatchedTurn, "runningTools" | "toolStartedAt" | "toolCommand">>): { command: string; startedAt: number } | undefined {
  let oldest: { command: string; startedAt: number } | undefined;
  for (const id of turn.runningTools ?? []) {
    const command = turn.toolCommand?.get(id);
    const startedAt = turn.toolStartedAt?.get(id);
    if (!command || startedAt === undefined) continue;
    if (!oldest || startedAt < oldest.startedAt) oldest = { command, startedAt };
  }
  return oldest;
}

/** The longest-running shell command of a turn stopped at stopAt, with the
 * whole minutes it ran, any secret in it masked. null when none runs. */
export function stuckCommand(turn: Partial<Pick<WatchedTurn, "runningTools" | "toolStartedAt" | "toolCommand">>, stopAt: number): { command: string; minutes: number } | null {
  const oldest = oldestCommand(turn);
  return oldest ? { command: redactSecretsInText(oldest.command).slice(0, 200), minutes: Math.max(1, Math.round((stopAt - oldest.startedAt) / 60_000)) } : null;
}

/** What the person is told when the watchdog stops a turn: its engine's
 * process ended, the shell command that looked stuck, or how long it was
 * silent. */
export function stallNotice(turn: Partial<Pick<WatchedTurn, "runningTools" | "toolStartedAt" | "toolCommand">>, silentMs: number, stopAt: number, reason: StallReason = "silent"): string {
  if (reason === "engine-exited") return "the process running this turn's AI ended, so the turn was stopped";
  const stuck = stuckCommand(turn, stopAt);
  return stuck
    ? `the command \`${stuck.command}\` ran for ${stuck.minutes} minutes without finishing and looks stuck, so the turn was stopped`
    : `no activity for ${Math.round(silentMs / 60_000)} minutes — the turn was stopped`;
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

/** The engine's process for the thread's turn has exited: the driver names
 * one and that process is gone. A driver that names none proves nothing (the
 * turn may not have started one yet), so this is false for it. */
export function engineProcessExited(adapter: Pick<ProviderAdapter, "enginePid"> | null | undefined, threadId: string, alive = processAlive): boolean {
  if (!adapter?.enginePid) return false;
  const pid = adapter.enginePid(threadId);
  return pid !== undefined && !alive(pid);
}

/** CPU time used by the thread's engine process tree (on Linux, only what
 * it started since `since`); null when the driver tracks no process or the
 * time cannot be read. */
export async function engineCommandCpuMs(adapter: Pick<ProviderAdapter, "enginePid"> | null | undefined, threadId: string, since: number,
  sample: (pid: number, since: number) => Promise<ProcessSample> = sampleProcessTree): Promise<number | null> {
  const pid = adapter?.enginePid?.(threadId);
  return pid === undefined ? null : (await sample(pid, since)).cpuMs;
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
  /** The silence that stops a turn whose engine process has exited. Absent:
   * such a turn waits for its own limit. */
  engineExitStallMs?: number;
  /** The driver names a process for the turn's engine and it is gone. */
  engineExited?: (turn: WatchedTurn) => boolean;
  /** CPU time of the turn's shell command processes, null when unknown. Read
   * once per sweep after a turn running one has been silent for stallMs; a
   * change since the last read counts as an event. */
  commandCpuMs?: (turn: WatchedTurn, since: number) => Promise<number | null>;
  /** Called once per stalled turn, after the entry is removed, with the
   * silence that stopped it (stallMs, toolStallMs, parkedStallMs or
   * engineExitStallMs) and why. */
  onStall: (turn: WatchedTurn, silentMs: number, reason: StallReason) => void;
  /** The conversations shown working that nothing holds but, maybe, a
   * watched turn (no dispatch claim, engine or settling turn): one no
   * watched turn holds either is freed once it has stayed so for stallMs. */
  unheld?: { threads(): Iterable<{ threadId: string; botId: string }>; free(threadId: string, botId: string): void };
  now?: () => number;
}

export class TurnWatchdog {
  private turns = new Map<string, WatchedTurn>();
  private unheldSince = new Map<string, number>();
  /** Each turn's last read of its shell command's CPU time. */
  private cpu = new WeakMap<WatchedTurn, { since: number; ms: number | null; reading: boolean }>();
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
      runningTools: new Set(), toolStartedAt: new Map(), toolCommand: new Map() });
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
      turn.toolCommand?.delete(event.itemId);
    } else if (!turn.runningTools.has(event.itemId)) {
      turn.runningTools.add(event.itemId);
      turn.toolStartedAt.set(event.itemId, turn.lastEventAt);
      if (event.type === "item.started" && event.summary?.trim()) (turn.toolCommand ??= new Map()).set(event.itemId, event.summary.trim());
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
      const limit = this.silenceLimit(turn);
      if (limit === null) continue;
      if (limit.reason === "silent" && at - turn.lastEventAt >= this.opts.stallMs) this.readCommandCpu(turn);
      if (at - turn.lastEventAt < limit.ms) continue;
      this.turns.delete(turn.threadId);
      this.opts.onStall(turn, limit.ms, limit.reason);
    }
    this.freeUnheld(at, sleptMs);
  }

  /** null: the turn may wait on, parked while its engine is not known to be gone. */
  private silenceLimit(turn: WatchedTurn): { ms: number; reason: StallReason } | null {
    if (parked(turn)) {
      return this.opts.parkedStallMs !== undefined && this.opts.engineGone?.(turn) ? { ms: this.opts.parkedStallMs, reason: "silent" } : null;
    }
    // The engine's process is gone: nothing can finish this turn, so it
    // waits for the driver's own word, not for a tool's limit.
    if (this.opts.engineExitStallMs !== undefined && this.opts.engineExited?.(turn)) return { ms: this.opts.engineExitStallMs, reason: "engine-exited" };
    return { ms: turn.runningTools.size > 0 ? Math.max(this.opts.stallMs, this.opts.toolStallMs) : this.opts.stallMs, reason: "silent" };
  }

  /** Reads the CPU time of a silent turn's shell command: one that gained at
   * least COMMAND_CPU_STEP_MS since the last read, or lost some (a process
   * of the build ended), is working, and that counts as an event. */
  private readCommandCpu(turn: WatchedTurn): void {
    const read = this.opts.commandCpuMs, command = oldestCommand(turn);
    if (!read || !command) return;
    const last = this.cpu.get(turn);
    if (last?.reading) return;
    const since = command.startedAt, previous = last?.since === since ? last.ms : null;
    this.cpu.set(turn, { since, ms: previous, reading: true });
    void Promise.resolve().then(() => read(turn, since)).catch(() => null).then((ms) => {
      // a read that failed keeps the last one to compare with
      this.cpu.set(turn, { since, ms: ms ?? previous, reading: false });
      const working = ms !== null && previous !== null && (ms < previous || ms - previous >= COMMAND_CPU_STEP_MS);
      if (working && this.turns.get(turn.threadId) === turn) turn.lastEventAt = Math.max(turn.lastEventAt, this.now());
    });
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
