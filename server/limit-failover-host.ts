// The harness side of the automatic backup on a usage limit
// (server/limit-failover.ts): what a failed turn, a turn about to start and
// the reset timer do. Everything that touches the server's state comes in
// through deps, so the rules are tested here without a server
// (server/limit-failover-host.test.ts) and through it in
// server/limit-failover.e2e.test.ts.
import type { LimitFailoverLine } from "../shared/limit-failover.ts";
import type { ModelSelection } from "../shared/wire.ts";
import { isEngineExhaustedRefusal } from "./drivers/openai-chat.ts";
import { limitBackupAllowed, pickLimitBackup, type LimitCandidate, type LimitEngine, type LimitFailoverStore } from "./limit-failover.ts";
import { limitKindOf, limitResetFromText, limitResetOrEstimate, type LimitKind } from "./limit-reset-time.ts";
import type { RoutineUsageLimit } from "./routines/routine-limit-words.ts";

/** What a turn ran on, noted when it was dispatched. */
export interface LimitDispatch {
  botId: string;
  engine: LimitEngine;
  selection: ModelSelection;
  /** Whose limit it draws on (autoPayerKey: "server" when solo). */
  payer: string;
  /** A member spoke and the bot owner's plan pays (J4): the line says whose limit it is. */
  owner?: boolean;
  speaker?: unknown;
  trigger?: unknown;
  /** When the turn was dispatched: its failure row is written after. */
  at: number;
  /** The turn ran on a local or computer-shared model: it has no usage
   * limit, so its failure is never one (limitKindOf's `local`). */
  local?: boolean;
  /** Sagax picked this turn's model instead of the conversation's own (a
   * proactive wake's or a call's fast model, #1694): a limit that refuses it
   * is that model's or that engine's, not the conversation's. */
  detour?: true;
}

/** The request a person's own message started (directRequestOwners). */
export interface LimitRequest {
  messageId?: string;
  turnId: string | null;
  stopped?: boolean;
  origin?: { kind: string };
}

export interface LimitFailoverHostDeps {
  store: LimitFailoverStore;
  now: () => number;
  /** On unless SAGAX_LIMIT_FAILOVER=0. */
  enabled: () => boolean;
  engineName: (instanceId: string) => string;
  engine: (instanceId: string) => LimitEngine | undefined;
  /** Every engine a turn of this speaker may run on, in catalog order: the
   * organization's allowedEngines and policy, sign-ins and keys, the
   * approval mode and the tools the thread needs (autoEnginesFor). */
  candidates: (botId: string, threadId: string, speaker: unknown) => Promise<LimitCandidate[]>;
  /** The same list from what is known now, without reading the engines again:
   * a routine run's failure decides at once who takes it over (routineLimit).
   * Absent: no routine run is taken over. */
  candidatesNow?: (botId: string, threadId: string, speaker: unknown) => LimitCandidate[];
  /** A limit refused one model this payer's turn ran on instead of its
   * conversation's own (a wake's or a call's fast model of the same engine):
   * that model is not picked again for this payer before `until`, and the
   * engine's other models stay theirs (Auto's refusal memory). */
  refuseModel?: (payer: string, selection: ModelSelection, until: number) => void;
  /** J4 plan usage: until when a plan window of this engine is spent for
   * this payer (used at 100 % with no extra usage or credit left, with the
   * reset its provider reported), from the last usage report Sagax read;
   * null when none is known. A report is only a hint (an early reset, a
   * top-up it shows only later, an allowance it does not show): only Sagax's
   * quick pick (a wake's or a call's fast model) skips such an engine. A
   * refusal on it that names no reset is still held for Sagax's estimate,
   * never until that window's reset. Auto, a backup and a run's takeover
   * read only the refusals Sagax saw, and a person's chosen engine is never
   * moved on it alone (2026-11-02). */
  planLimitUntil?: (payer: string, instanceId: string) => number | null;
  /** A turn on this engine just worked for this payer: a plan window Sagax
   * read as spent for it is not (extra-usage credits, a plan upgrade, an
   * early reset), so Sagax's own picks may land on it again. */
  planWorked?: (payer: string, instanceId: string) => void;
  /** The bot's own backups, then the organization's default engine. */
  preferred: (botId: string, threadId: string) => Array<{ instanceId: string; model?: string }>;
  config: (instanceId: string) => { environment?: Record<string, string>; access?: string } | undefined;
  payer: (botId: string, speaker: unknown) => string;
  /** The bot owner's plan pays for a member's turn (J4). */
  ownerPays?: (botId: string, speaker: unknown) => boolean;
  /** The model the thread runs on now; null when it is gone. */
  threadSelection: (botId: string, threadId: string) => ModelSelection | null;
  /** The thread still runs a turn (the failed one settling, or a newer one). */
  busy: (botId: string, threadId: string) => boolean;
  /** Moves the thread (not the bot); the refusal in words, or null once done. */
  switchThread: (botId: string, threadId: string, to: ModelSelection) => string | null;
  /** One row in the thread. A switch and a return are transparent (the maintainer,
   * 2026-10-29): a hidden `notice:` row and a line in the Events lens; only
   * a wait the person must know of reads in the chat. Auto's own switch is
   * `switched` to "Auto". */
  note: (threadId: string, line: LimitFailoverLine) => void;
  /** Turns this turn's failure row (its own, or the last written since the
   * turn was dispatched) into the line; appends it when there is none. */
  replaceFailure: (threadId: string, turnId: string | undefined, line: LimitFailoverLine, since: number) => void;
  request: (threadId: string) => LimitRequest | undefined;
  /** Sends the person's message again on the thread's engine now; false
   * when it is no longer the latest, or the thread is busy or gone. */
  resend: (botId: string, threadId: string, messageId: string, speaker: unknown, trigger: unknown,
    resume?: { turnId?: string }) => Promise<boolean>;
  /** Auto: the model this thread's turn ran on is not picked again for this
   * payer before `until` (its usage limit's reset). */
  autoRefuse?: (threadId: string, payer: string, until: number) => void;

  /** Starts the routine again on the backup. `fromRunId` is the waiting,
   * queued or failed run this failover replaces; the host cancels it first
   * so the new run is not stuck behind a reconnect / usage wait. */
  rerunRoutine: (routineId: string, fromRunId?: string) => boolean;
  /** Cancels a waiting or queued park without starting a new run (no-backup
   * wait path: the scheduled resume owns the restart). */
  clearRoutineRun?: (runId: string) => void;
  /** Schedules `run` in `ms`; the default is an unref'd timer. */
  after?: (ms: number, run: () => void) => { cancel(): void };
}

export interface LimitFailoverHost {
  /** The engines Sagax must not pick for this payer now: one a refusal holds
   * at its usage limit, and any other sign-in to the same subscription
   * engine (limitBackupAllowed). `pick` "quick": Sagax's quick pick (a
   * wake's or a call's fast model) also skips an engine whose plan the
   * payer's usage report showed spent (planLimitUntil); Auto and its panel
   * read only the refusals Sagax saw. */
  autoExcluded(payer: string, engines: readonly LimitEngine[], pick?: "quick"): Set<string>;
  /** Remember what a turn runs on, for its failure. */
  noteDispatch(threadId: string, dispatch: LimitDispatch): void;
  /** A runtime.error: keeps the reset the engine said, if any, and whether
   * the refusal binds only the turn's model (`scope`), not the engine. */
  noteError(threadId: string, message: string, limitResetsAt?: number, scope?: "model"): void;
  /** Whether a usage-limit refusal of this thread's running turn holds its
   * whole engine for the payer, so that the engines' report
   * (/api/limit-resets) may call that engine limited: never a refusal bound
   * to one model (`scope`), nor one of a fast model Sagax picked on the
   * conversation's own engine (only that model is held), unless that
   * engine's plan is spent. True for a turn Sagax never saw dispatched: the
   * engine's own words decide. */
  refusalHoldsEngine(threadId: string, scope?: "model"): boolean;
  /** A backup this module moved the thread to could not run for this
   * person (signed out, no key, refused access). The thread goes back to
   * the engine it started on, the backup is not offered again for a while,
   * and the caller shows one plain error instead of a sign-in card: the
   * person never picked that engine. Null when the thread is not on a
   * backup. */
  backupRefused(botId: string, threadId: string, speaker?: unknown): { from: string; to: string } | null;
  /** A failed turn. True when its failure is a usage limit this module
   * takes over (no incident: the turn continues, or waits for the reset). */
  turnFailed(input: {
    threadId: string; turnId?: string; cause: string | undefined; stopReason?: string | null;
    /** The routine run this failure just failed (RoutineManager.handleRuntimeEvent), if any. */
    routineRun?: { id: string; routineId: string } | null;
  }): boolean;
  /** A routine run's, webhook run's or proactive wake's failed turn, read at
   * once (RoutineManager's usageLimit, before the run fails): null when it is
   * no limit. Otherwise the limit is held for the payer as turnFailed holds
   * it, and the verdict names the engine that really refused (its model too
   * when the turn ran on a model other than its conversation's own) and its
   * reset; with `takeover`, also who runs the run now: the conversation's own
   * model when only a detour refused, else a backup as for a person's
   * message, else Auto's next pick. When the engine that refused was
   * standing in for the conversation's own model (an earlier takeover), the
   * verdict names that model's engine and its own reset (`home`), and the
   * run goes back there at once when its limit is over, even with
   * `takeover` false (the run already moved ROUTINE_LIMIT_TAKEOVERS times):
   * that engine is no other engine. With nobody to take it over, the
   * verdict says why (`noTaker`). The turn is then this method's, not
   * turnFailed's. Never throws. */
  routineLimit(input: { threadId: string; cause: string | undefined; stopReason?: string | null; takeover: boolean }): RoutineUsageLimit | null;
  /** Before a routine run's next start: its thread moves to the model that
   * took the run over (RoutineRun.limitTakeover), and goes back to its own
   * model after `returnsAt` (RoutineRun.limitTakeoverUntil: the reset of the
   * limit that moved it off, model-only or not, `returnsEstimated` when that
   * time is Sagax's estimate) or a later hold on its engine, as a person's
   * conversation does (beforeTurn). Its own model is the one a first
   * takeover moved it off, when the engine it is on now stands in for it;
   * moving it back there ends that takeover. A run that starts once that
   * limit is over moves nothing. Never throws. */
  takeOver(botId: string, threadId: string, to: ModelSelection, speaker: unknown, returnsAt?: number, returnsEstimated?: boolean): void;
  /** A turn that completed: nothing to keep for it, and its engine plainly
   * has room again for its payer, so a stale hold on it ends. */
  turnSucceeded(threadId: string): void;
  /** Before a turn: back on the thread's engine after its reset (at once),
   * or onto a backup while its engine is known to be at its limit (the
   * promise, to await before the turn reads its model). Null when nothing
   * is left to wait for, so an ordinary turn never yields. Never throws. */
  beforeTurn(botId: string, threadId: string, speaker: unknown): Promise<void> | null;
  /** Runs what waits for a reset and arms the timer again. */
  tick(): Promise<void>;
  start(): void;
  stop(): void;
  /** Settles once the work a failure started is done (tests). */
  idle(): Promise<void>;
}

/** The one error a person reads when the backup a usage limit picked
 * cannot run for them: no sign-in card for an engine they never chose. */
export function limitBackupRefusedText(back: { from: string; to: string }): string {
  return `Limit reached on ${back.from}, and ${back.to} is not connected for you, so nothing took over. This conversation stays on ${back.from}: wait for its limit to reset, or connect another engine in Settings.`;
}

const RETRY_BUSY_MS = 60_000;
/** A backup that refused this person is skipped this long. */
export const BACKUP_REFUSED_MS = 60 * 60_000;
/** How long a failed turn's own settling may hold its thread before the
 * backup gives up waiting (the turn.completed handler releases it). */
const SETTLE_WAIT_MS = 10_000;
/** Auto goes on from model to model until one answers: at most this many
 * times for one message (each limited model is skipped until its reset). */
const AUTO_MAX_RESENDS = 6;
const SETTLE_POLL_MS = 50;

export function createLimitFailoverHost(deps: LimitFailoverHostDeps): LimitFailoverHost {
  const { store } = deps;
  const after = deps.after ?? ((ms: number, run: () => void) => {
    const timer = setTimeout(run, Math.max(0, Math.min(ms, 2_147_000_000)));
    timer.unref?.();
    return { cancel: () => clearTimeout(timer) };
  });
  const dispatches = new Map<string, LimitDispatch>();
  const errors = new Map<string, { message: string; resetsAt?: number; scope?: "model" }>();
  const pending = new Set<Promise<unknown>>();
  let timer: { cancel(): void } | null = null;
  let started = false;

  const track = (work: Promise<unknown>) => {
    pending.add(work);
    void work.finally(() => pending.delete(work));
  };
  const same = (left: ModelSelection | null | undefined, right: ModelSelection | null | undefined) =>
    Boolean(left && right && left.instanceId === right.instanceId && left.model === right.model);
  /** A spent plan window of this engine for this payer, still to reset. */
  const planUntil = (payer: string, instanceId: string): number | null => {
    try {
      const at = deps.planLimitUntil?.(payer, instanceId) ?? null;
      return at !== null && at > deps.now() ? at : null;
    } catch {
      return null;
    }
  };
  /** Until when a refusal Sagax saw holds this engine for this payer: what
   * Auto, a backup and a run's takeover read (2026-11-02, a usage report at
   * 100 % can be wrong: extra usage left, an early reset). */
  const heldUntil = (payer: string, instanceId: string): number | null => store.blockedUntil(payer, instanceId);
  /** The same, or a plan window the payer's usage report showed spent: only
   * Sagax's quick pick (a wake's or a call's fast model) reads it. */
  const quickHeldUntil = (payer: string, instanceId: string): number | null =>
    heldUntil(payer, instanceId) ?? planUntil(payer, instanceId);
  /** The engines among `engines` a turn of this payer must not run on now:
   * one held (`quick`: or whose plan is spent), and any other sign-in to the
   * same subscription engine as one held (limitBackupAllowed's no-rotation
   * rule), whatever engine refused. `also`: engines that may be held though
   * not in the list (the one that refused, the conversation's own). */
  const outOf = (payer: string, engines: readonly LimitEngine[], quick = false, also: readonly LimitEngine[] = []): Set<string> => {
    const until = quick ? quickHeldUntil : heldUntil;
    const limited = [...engines, ...also].filter((engine) => until(payer, engine.instanceId) !== null);
    const out = new Set<string>();
    for (const engine of engines) {
      if (limited.some((at) => !limitBackupAllowed(at, engine, deps.config(engine.instanceId)))) out.add(engine.instanceId);
    }
    return out;
  };
  /** A line's reset for this engine is only Sagax's estimate when the hold
   * that sets it says so; `fallback` when no hold sets that time. */
  const estimatedFor = (payer: string, instanceId: string, at: number, fallback: boolean): boolean => {
    const held = store.holdOf(payer, instanceId);
    return held !== null && held.until === at ? held.estimated : fallback;
  };
  const pick = async (botId: string, threadId: string, speaker: unknown, from: LimitEngine, payer: string) => {
    const preferred = deps.preferred(botId, threadId);
    const candidates = await deps.candidates(botId, threadId, speaker);
    const out = outOf(payer, candidates, false, [from]);
    return pickLimitBackup({ from, preferred, candidates, blocked: (instanceId) => out.has(instanceId), config: deps.config });
  };

  /** Sagax ran this turn on a model of its own pick (a fast model), not the conversation's. */
  const detoured = (dispatch: LimitDispatch, current: ModelSelection | null): current is ModelSelection =>
    dispatch.detour === true && Boolean(current) && current!.auto !== true && !same(current, dispatch.selection);
  /** A refusal of this turn holds its whole engine for the payer: not one
   * that binds only the turn's model (its extra-usage credits, its own
   * weekly window), nor one of a fast model Sagax picked on the
   * conversation's own engine (only that model is held: the conversation's
   * own model is not at its limit for all Sagax knows), unless the engine's
   * plan window is spent for this payer. Any other refusal holds its engine. */
  const holdsEngine = (dispatch: LimitDispatch, current: ModelSelection | null, scope?: "model"): boolean => scope !== "model" &&
    !(detoured(dispatch, current) && current.instanceId === dispatch.engine.instanceId && planUntil(dispatch.payer, dispatch.engine.instanceId) === null);
  /** Holds what a limit refused for the payer, from now on whatever happens
   * to the turn: no other turn of this payer starts on it before the reset
   * (its engine, or only its model: holdsEngine). A refusal bound to one
   * model (`scope`) holds nothing engine-wide, but a quick model Sagax picked
   * that it refused is still skipped by Sagax's quick picks until then, as
   * the lines say (2026-11-02, final review: before, nothing was held, the
   * next wake picked that model again and a call's message went back onto
   * it). `estimated`: the engine named no reset. */
  const hold = (dispatch: LimitDispatch, current: ModelSelection | null, resetsAt: number, estimated: boolean, scope?: "model") => {
    if (scope === "model") {
      if (detoured(dispatch, current)) deps.refuseModel?.(dispatch.payer, dispatch.selection, resetsAt);
      return;
    }
    if (!holdsEngine(dispatch, current, scope)) {
      deps.refuseModel?.(dispatch.payer, dispatch.selection, resetsAt);
      return;
    }
    store.block(dispatch.payer, dispatch.engine.instanceId, resetsAt, estimated);
  };
  /** When the limit a turn met resets: the engine's own time (its error, or
   * its words), else Sagax's estimate, marked as one, after which the engine
   * is tried again. A plan window the payer's usage report showed spent
   * never sets it: a report is only a hint, and a hold until that window's
   * reset kept the engine off for days after a top-up the next report showed
   * (2026-11-02, final review). */
  const resetOf = (kind: LimitKind, cause: string | undefined, error: { message: string; resetsAt?: number } | undefined) => {
    const now = deps.now();
    return limitResetOrEstimate(kind, error?.resetsAt ?? limitResetFromText(cause, now) ?? limitResetFromText(error?.message, now), now);
  };
  const modelName = (selection: ModelSelection) => `${deps.engineName(selection.instanceId)} (${selection.model})`;
  /** Who refused, in words: the engine, with its model when the turn was on a detour. */
  const refusedName = (dispatch: LimitDispatch, current: ModelSelection | null) =>
    detoured(dispatch, current) ? modelName(dispatch.selection) : deps.engineName(dispatch.engine.instanceId);
  /** The refused turn ran on a model a takeover had moved its conversation
   * to (a run's, or a person's message's): the conversation's own model,
   * when its own limit resets (its hold, else the reset its takeover was
   * recorded with), whether that time is Sagax's estimate, and whether that
   * limit is over now. Null when the conversation was on its own model. */
  const homeOf = (dispatch: LimitDispatch, threadId: string) => {
    const row = store.failover(dispatch.botId, threadId);
    if (!row || !same(row.to, dispatch.selection)) return null;
    const held = store.holdOf(dispatch.payer, row.from.instanceId);
    const resetsAt = Math.max(row.resetsAt, held?.until ?? 0);
    const estimated = held && held.until === resetsAt ? held.estimated : row.estimated === true;
    return { selection: row.from, name: deps.engineName(row.from.instanceId), resetsAt, estimated, free: resetsAt + store.afterResetMs <= deps.now() };
  };
  /** Who runs a routine run a limit refused: the conversation's own model
   * when only a detour refused and it is free, else a backup picked as for
   * a person's message, from what is known now (`candidates`). Never the
   * conversation's own engine (`home`) while its own limit holds: another
   * model of it is no backup for the one a limit refused. */
  const routineBackup = (dispatch: LimitDispatch, current: ModelSelection, threadId: string,
    candidates: LimitCandidate[] | undefined, home: { selection: ModelSelection } | null): ModelSelection | null => {
    if (detoured(dispatch, current) && heldUntil(dispatch.payer, current.instanceId) === null &&
      (!candidates || candidates.some((candidate) => candidate.instanceId === current.instanceId))) {
      const { auto: _auto, ...own } = current;
      return own;
    }
    if (!candidates) return null;
    const own = deps.engine(current.instanceId);
    const out = outOf(dispatch.payer, candidates, false, [dispatch.engine, ...(own ? [own] : [])]);
    if (home) out.add(home.selection.instanceId);
    return pickLimitBackup({
      from: dispatch.engine,
      preferred: deps.preferred(dispatch.botId, threadId),
      candidates,
      blocked: (instanceId) => out.has(instanceId),
      config: deps.config,
    });
  };
  /** Auto has another model to pick for this payer (as Auto picks:
   * autoExcluded): an engine not held, or another model of the refused one
   * when only that model is held. */
  const autoHasAnother = (dispatch: LimitDispatch, candidates: readonly LimitCandidate[], engineHeld: boolean): boolean => {
    const out = outOf(dispatch.payer, candidates, false, [dispatch.engine]);
    return candidates.some((candidate) => !out.has(candidate.instanceId) &&
      (candidate.instanceId !== dispatch.engine.instanceId || (!engineHeld && candidate.models.some((model) => model !== dispatch.selection.model))));
  };

  /** Until the thread is free, at most SETTLE_WAIT_MS; false when it is not. */
  const settled = async (botId: string, threadId: string): Promise<boolean> => {
    for (let waited = 0; deps.busy(botId, threadId); waited += SETTLE_POLL_MS) {
      if (waited >= SETTLE_WAIT_MS) return false;
      await new Promise<void>((resolve) => { after(SETTLE_POLL_MS, resolve); });
    }
    return true;
  };

  const arm = () => {
    timer?.cancel();
    timer = null;
    if (!started) return;
    const next = store.nextResumeAt();
    if (next === null) return;
    timer = after(Math.max(1_000, next - deps.now()), () => { void host.tick(); });
  };

  const failed = async (threadId: string, turnId: string | undefined, dispatch: LimitDispatch, resetsAt: number,
    own: { messageId: string } | null, run: { id: string; routineId: string } | null,
    auto: { modelOnly: boolean } | null = null, exhausted = false, estimated = false) => {
    const failover = store.failover(dispatch.botId, threadId);
    // The engine the thread goes back to: the one it started on.
    const home = failover && same(failover.to, dispatch.selection) ? failover : null;
    const homeEngine = home ? deps.engine(home.from.instanceId) ?? dispatch.engine : dispatch.engine;
    const homeReset = home ? Math.max(home.resetsAt, store.blockedUntil(dispatch.payer, home.from.instanceId) ?? 0) : resetsAt;
    /** The line names the time Sagax tries `instanceId` again as a reset only when the engine said it. */
    const noReset = (instanceId: string, at: number) =>
      estimatedFor(dispatch.payer, instanceId, at, at === resetsAt && estimated) ? { estimated: true as const } : {};
    /** A move to a backup returns to the engine the thread started on at
     * that engine's own reset: when the turn ran on a backup standing in for
     * it, never at the later reset of the backup that refused (2026-11-02). */
    const moved = home
      ? { resetsAt: homeReset, ...(estimatedFor(dispatch.payer, home.from.instanceId, homeReset, home.estimated === true) ? { estimated: true as const } : {}) }
      : { resetsAt, ...(estimated ? { estimated: true as const } : {}) };
    /** When the turn ran on a backup standing in for the conversation's own
     * engine (`home`), the lines name that backup as the engine that refused
     * and the conversation's own engine with its own reset, as a run's lines
     * do (routineLimit), never that engine as the one that refused
     * (2026-11-02, final review: the switch line named it, and the wait never
     * named the backup). */
    const standIn = home ? { from: deps.engineName(dispatch.engine.instanceId), home: deps.engineName(home.from.instanceId) } : null;
    /** The switch line of a move to `backup`, whose return is recorded as `kept`. */
    const switchedTo = (backup: ModelSelection, kept: { from: ModelSelection; resetsAt: number; estimated?: true }): Extract<LimitFailoverLine, { kind: "switched" }> => standIn
      ? { kind: "switched", ...standIn, to: deps.engineName(backup.instanceId), resetsAt: kept.resetsAt, ...(kept.estimated ? { estimated: true as const } : {}) }
      : { kind: "switched", from: deps.engineName(kept.from.instanceId), to: deps.engineName(backup.instanceId), resetsAt: kept.resetsAt, ...noReset(kept.from.instanceId, kept.resetsAt) };
    /** What a wait for the reset of the engine the thread goes back to names. */
    const waitFor = standIn
      ? { ...standIn, resetsAt: homeReset, ...(moved.estimated ? { estimated: true as const } : {}) }
      : { from: deps.engineName(homeEngine.instanceId), resetsAt: homeReset, ...noReset(homeEngine.instanceId, homeReset) };
    const backup = await pick(dispatch.botId, threadId, dispatch.speaker, dispatch.engine, dispatch.payer).catch(() => null);
    if (run) {
      if (backup && store.takeResend(`routine:${run.id}`)) {
        // #1696: no conversation model left on this engine. Move the routine
        // onto the backup for good (no return after a reset).
        if (exhausted) {
          const refused = deps.switchThread(dispatch.botId, threadId, backup);
          if (!refused && deps.rerunRoutine(run.routineId, run.id)) {
            deps.replaceFailure(threadId, turnId, {
              kind: "switched", from: deps.engineName(dispatch.engine.instanceId), to: deps.engineName(backup.instanceId),
              resetsAt: deps.now(), reason: "model",
            }, dispatch.at);
            return;
          }
          if (refused) console.warn(`[limit-failover] ${threadId}: could not move to ${backup.instanceId}: ${refused}`);
          return;
        }
        // Usage limit with a backup: switch the thread now, record the
        // failover (so beforeTurn stays consistent), write the switched
        // note, then rerun. Prefer backup over same-engine reconnect wait.
        const refused = deps.switchThread(dispatch.botId, threadId, backup);
        if (!refused) {
          const kept = store.record({ botId: dispatch.botId, threadId, from: dispatch.selection, to: backup, ...moved, at: deps.now() });
          deps.replaceFailure(threadId, turnId, switchedTo(backup, kept), dispatch.at);
          if (deps.rerunRoutine(run.routineId, run.id)) return;
        } else {
          console.warn(`[limit-failover] ${threadId}: could not move to ${backup.instanceId}: ${refused}`);
        }
      }
      // Exhausted with no backup: leave the engine's own error (no reset to wait for).
      if (exhausted) return;
      // Drop recoverRun's competing queued / reconnect wait so only this
      // scheduled resume restarts the routine.
      deps.clearRoutineRun?.(run.id);
      store.schedule({ kind: "routine", routineId: run.routineId, engine: homeEngine.instanceId, at: homeReset + store.afterResetMs });
      deps.replaceFailure(threadId, turnId, { kind: "waitingRoutine", ...waitFor }, dispatch.at);
      arm();
      return;
    }
    if (!own) return;
    // A newer turn took the thread meanwhile: it runs, this one is left as it failed.
    if (!await settled(dispatch.botId, threadId)) return;
    // Auto (the maintainer, 2026-10-29): the same turn goes on at once on the next model
    // that works, picked as Auto picks, with the steps it already took; the
    // chat shows nothing, the Events lens says why. Another model of the same
    // engine still runs when only this model's window refused it.
    // #1696: same when the engine had no conversation model left.
    if (auto && (backup || auto.modelOnly || exhausted) && store.takeResend(own.messageId, AUTO_MAX_RESENDS)) {
      const from = deps.engineName(dispatch.engine.instanceId);
      deps.replaceFailure(threadId, turnId, {
        kind: "switched", from, to: "Auto", resetsAt, ...(exhausted ? { reason: "model" as const } : estimated ? { estimated: true as const } : {}),
      }, dispatch.at);
      await deps.resend(dispatch.botId, threadId, own.messageId, dispatch.speaker, dispatch.trigger, turnId ? { turnId } : {});
      return;
    }
    if (!auto && backup && store.takeResend(own.messageId)) {
      const refused = deps.switchThread(dispatch.botId, threadId, backup);
      if (!refused) {
        // #1696: stay on the backup (no return after a reset). A usage limit
        // still records the failover so the thread goes back after the reset.
        if (exhausted) {
          deps.replaceFailure(threadId, turnId, {
            kind: "switched", from: deps.engineName(dispatch.engine.instanceId), to: deps.engineName(backup.instanceId),
            resetsAt: deps.now(), reason: "model",
            ...(dispatch.owner ? { owner: true as const } : {}),
          }, dispatch.at);
        } else {
          const kept = store.record({ botId: dispatch.botId, threadId, from: dispatch.selection, to: backup, ...moved, at: deps.now() });
          deps.replaceFailure(threadId, turnId, { ...switchedTo(backup, kept), ...(dispatch.owner ? { owner: true as const } : {}) }, dispatch.at);
        }
        await deps.resend(dispatch.botId, threadId, own.messageId, dispatch.speaker, dispatch.trigger, turnId ? { turnId } : {});
        return;
      }
      console.warn(`[limit-failover] ${threadId}: could not move to ${backup.instanceId}: ${refused}`);
    }
    // Exhausted with no backup: leave the engine's own error (choose another model).
    if (exhausted) return;
    // Nothing can take over: the message goes again once the limit resets, once.
    if (!store.schedule({
      kind: "message", botId: dispatch.botId, threadId, messageId: own.messageId, engine: homeEngine.instanceId,
      at: homeReset + store.afterResetMs, ...(dispatch.speaker !== undefined ? { speaker: dispatch.speaker } : {}),
      ...(dispatch.trigger !== undefined ? { trigger: dispatch.trigger } : {}),
    })) return;
    deps.replaceFailure(threadId, turnId, { kind: "waiting", ...waitFor, ...(dispatch.owner ? { owner: true as const } : {}) }, dispatch.at);
    arm();
  };

  /** A person's message whose turn ran on a quick model Sagax picked (a
   * call's, #1694) and that model's limit refused: the same message goes
   * again at once and the conversation stays on its own model; the next
   * quick pick skips what the limit holds now (hold), so it lands elsewhere.
   * The failure row becomes one hidden line naming that quick model. */
  const detourFailed = async (threadId: string, turnId: string | undefined, dispatch: LimitDispatch, current: ModelSelection,
    resetsAt: number, estimated: boolean, own: { messageId: string }) => {
    // A newer turn took the thread meanwhile: it runs, this one is left as it failed.
    if (!await settled(dispatch.botId, threadId)) return;
    deps.replaceFailure(threadId, turnId, {
      kind: "switched", from: modelName(dispatch.selection), to: deps.engineName(current.instanceId), resetsAt, detour: true,
      ...(estimated ? { estimated: true as const } : {}),
    }, dispatch.at);
    await deps.resend(dispatch.botId, threadId, own.messageId, dispatch.speaker, dispatch.trigger, turnId ? { turnId } : {});
  };

  const host: LimitFailoverHost = {
    autoExcluded(payer, engines, pick) {
      try {
        // A refusal's hold (for Sagax's quick pick, also a plan window the
        // payer's usage report showed spent), and any other sign-in to the
        // same subscription engine: never landed on (2026-11-02).
        return outOf(payer, engines, pick === "quick");
      } catch (failure) {
        console.warn(`[limit-failover] auto: ${failure instanceof Error ? failure.message : String(failure)}`);
        return new Set<string>();
      }
    },

    noteDispatch(threadId, dispatch) {
      dispatches.set(threadId, dispatch);
      errors.delete(threadId);
    },

    noteError(threadId, message, limitResetsAt, scope) {
      errors.set(threadId, { message, ...(limitResetsAt !== undefined ? { resetsAt: limitResetsAt } : {}), ...(scope ? { scope } : {}) });
    },

    refusalHoldsEngine(threadId, scope) {
      if (scope === "model") return false;
      const dispatch = dispatches.get(threadId);
      if (!dispatch) return true;
      try {
        return holdsEngine(dispatch, deps.threadSelection(dispatch.botId, threadId), scope);
      } catch (failure) {
        console.warn(`[limit-failover] ${threadId}: ${failure instanceof Error ? failure.message : String(failure)}`);
        return true;
      }
    },

    routineLimit({ threadId, cause, stopReason, takeover }) {
      try {
        const dispatch = dispatches.get(threadId);
        if (!dispatch) return null;
        const error = errors.get(threadId);
        const kind: LimitKind | null = limitKindOf(cause ?? error?.message, stopReason, { local: dispatch.local === true });
        // An exhausted catalog (#1696) and every other failure stay turnFailed's.
        if (!kind) return null;
        dispatches.delete(threadId);
        errors.delete(threadId);
        const { resetsAt, estimated } = resetOf(kind, cause, error);
        const current = deps.threadSelection(dispatch.botId, threadId);
        hold(dispatch, current, resetsAt, estimated, error?.scope);
        const auto = current?.auto === true;
        if (auto) deps.autoRefuse?.(threadId, dispatch.payer, resetsAt);
        const from = refusedName(dispatch, current);
        // Only a quick model Sagax picked refused, not the conversation's own:
        // the run's words say Sagax skips that model, never that the run goes
        // back to it (routines/routine-limit-words.ts).
        const detour = detoured(dispatch, current);
        // The engine that refused was standing in for the conversation's own
        // model (an earlier takeover): the run goes back there, at that
        // model's own reset, never to this backup (2026-11-02, review).
        const home = !detour && !auto ? homeOf(dispatch, threadId) : null;
        const verdict: RoutineUsageLimit = {
          kind, from, resetsAt, estimated, ...(detour ? { detour: true as const } : {}),
          ...(home ? { home: { name: home.name, resetsAt: home.resetsAt, estimated: home.estimated } } : {}),
        };
        if (!deps.enabled()) return { ...verdict, noTaker: "off" };
        if (!current) return { ...verdict, noTaker: "none" };
        const candidates = deps.candidatesNow?.(dispatch.botId, threadId, dispatch.speaker);
        let to: ModelSelection | null = null;
        let toName: string;
        let backHome = false;
        if (home?.free && (!candidates || candidates.some((candidate) => candidate.instanceId === home.selection.instanceId))) {
          // Its own limit is over: back there now, however many times the run
          // moved (the conversation's own engine takes nothing over).
          to = home.selection;
          toName = home.name;
          backHome = true;
        } else if (!takeover) {
          return { ...verdict, noTaker: "cap" };
        } else if (auto) {
          if (!autoHasAnother(dispatch, candidates ?? [], error?.scope !== "model")) return { ...verdict, noTaker: "none" };
          toName = "Auto";
        } else {
          to = routineBackup(dispatch, current, threadId, candidates, home);
          if (!to) return { ...verdict, noTaker: "none" };
          toName = to.instanceId === dispatch.engine.instanceId ? modelName(to) : deps.engineName(to.instanceId);
        }
        // When the run's conversation goes back to its own model once a
        // takeover moved it off (takeOver records it, beforeTurn reads it):
        // that model's own reset when the engine that refused stood in for
        // it; after a detour, the hold on the conversation's own engine that
        // kept the run off it; else the reset of the limit that refused that
        // model, model-only or not.
        let returns: { at: number; estimated: boolean } | undefined;
        if (to && !backHome && !same(to, current)) {
          const own = detour ? store.holdOf(dispatch.payer, current.instanceId) : null;
          returns = home ? { at: home.resetsAt, estimated: home.estimated }
            : own ? { at: own.until, estimated: own.estimated } : { at: resetsAt, estimated };
        }
        // The engine's error row of this turn becomes the switch line: a
        // hidden notice, its words in the Events lens (limitFailoverRow).
        const line: LimitFailoverLine = backHome
          ? { kind: "back", engine: toName, refused: from }
          : home
            ? { kind: "switched", from, to: toName, resetsAt: home.resetsAt, home: home.name, ...(home.estimated ? { estimated: true as const } : {}) }
            : { kind: "switched", from, to: toName, resetsAt, ...(estimated ? { estimated: true as const } : {}), ...(detour ? { detour: true as const } : {}) };
        track(Promise.resolve().then(() => deps.replaceFailure(threadId, undefined, line, dispatch.at)).catch((failure) => {
          console.warn(`[limit-failover] ${threadId}: ${failure instanceof Error ? failure.message : String(failure)}`);
        }));
        return {
          ...verdict, to: toName, ...(to ? { selection: to } : {}),
          ...(returns ? { returnsAt: returns.at, ...(returns.estimated ? { returnsEstimated: true as const } : {}) } : {}),
          ...(backHome ? { backHome: true as const } : {}),
          // A quick model of the conversation's own engine refused and the run
          // goes on on the conversation's own model: no other engine took it.
          ...(to && !backHome && to.instanceId === dispatch.engine.instanceId ? { sameEngine: true as const } : {}),
        };
      } catch (failure) {
        console.warn(`[limit-failover] ${threadId}: ${failure instanceof Error ? failure.message : String(failure)}`);
        return null;
      }
    },

    takeOver(botId, threadId, to, speaker, returnsAt, returnsEstimated) {
      try {
        const current = deps.threadSelection(botId, threadId);
        if (!current || same(current, to)) return;
        const row = store.failover(botId, threadId);
        const standIn = row && same(row.to, current) ? row : null;
        // Back on the conversation's own model (its limit is over): the
        // takeover that moved it off ends here, and the run's own line says
        // so, with no second line in its thread.
        if (standIn && same(standIn.from, to)) {
          const refused = deps.switchThread(botId, threadId, to);
          if (refused) console.warn(`[limit-failover] ${threadId}: could not go back to ${to.instanceId}: ${refused}`);
          else store.forget(threadId);
          return;
        }
        // Always back on its own model after the reset, as a person's
        // conversation goes back (beforeTurn): a routine that joined a
        // conversation (a wait's follow-up in the person's chat) leaves it
        // where it was. Its own model is the one a first takeover moved it
        // off when the engine it is on now stands in for it. A model-only
        // refusal holds nothing engine-wide: the takeover's own reset still
        // schedules the return, and a later hold on the engine delays it.
        const home = standIn ? standIn.from : current;
        const held = store.holdOf(deps.payer(botId, speaker), home.instanceId);
        const until = Math.max(held?.until ?? 0, returnsAt ?? 0, standIn?.resetsAt ?? 0);
        // That limit is already over when the run starts (it waited past the
        // reset, its conversation busy): the run goes on where its
        // conversation is, never moved to the backup and straight back
        // (two switches, its engine session replayed for nothing).
        if (until + store.afterResetMs <= deps.now()) return;
        const refused = deps.switchThread(botId, threadId, to);
        if (refused) {
          console.warn(`[limit-failover] ${threadId}: could not move to ${to.instanceId}: ${refused}`);
          return;
        }
        const estimated = held && held.until === until ? held.estimated : until === returnsAt ? returnsEstimated === true : standIn?.estimated === true;
        store.record({ botId, threadId, from: current, to, resetsAt: until, at: deps.now(), ...(estimated ? { estimated: true as const } : {}) });
      } catch (failure) {
        console.warn(`[limit-failover] take over ${threadId}: ${failure instanceof Error ? failure.message : String(failure)}`);
      }
    },

    turnSucceeded(threadId) {
      const dispatch = dispatches.get(threadId);
      dispatches.delete(threadId);
      errors.delete(threadId);
      // A reply on the engine proves the payer has room on it again (another
      // model, plan or a reset come early): a hold left on it is stale, and
      // so is a plan window Sagax read as spent for it.
      if (!dispatch) return;
      store.unblock(dispatch.payer, dispatch.engine.instanceId);
      try {
        deps.planWorked?.(dispatch.payer, dispatch.engine.instanceId);
      } catch (failure) {
        console.warn(`[limit-failover] plan worked: ${failure instanceof Error ? failure.message : String(failure)}`);
      }
    },

    backupRefused(botId, threadId, speaker) {
      try {
        const row = store.failover(botId, threadId);
        if (!row || !same(deps.threadSelection(botId, threadId), row.to)) return null;
        const payer = deps.payer(botId, speaker);
        store.block(payer, row.to.instanceId, deps.now() + BACKUP_REFUSED_MS);
        const refused = deps.switchThread(botId, threadId, row.from);
        if (refused) console.warn(`[limit-failover] ${threadId}: could not go back to ${row.from.instanceId}: ${refused}`);
        store.forget(threadId);
        return { from: deps.engineName(row.from.instanceId), to: deps.engineName(row.to.instanceId) };
      } catch (failure) {
        console.warn(`[limit-failover] ${threadId}: ${failure instanceof Error ? failure.message : String(failure)}`);
        return null;
      }
    },

    turnFailed({ threadId, turnId, cause, stopReason, routineRun }) {
      const dispatch = dispatches.get(threadId);
      const error = errors.get(threadId);
      dispatches.delete(threadId);
      errors.delete(threadId);
      try {
        if (!dispatch) return false;
        const message = cause ?? error?.message;
        const kind = limitKindOf(message, stopReason, { local: dispatch.local === true });
        // #1696: the engine had no conversation model left. Same host path as
        // a usage limit (another engine continues), without blocking the
        // engine or waiting for a reset.
        const exhausted = !kind && isEngineExhaustedRefusal(message);
        if (!kind && !exhausted) return false;
        const { resetsAt, estimated } = kind ? resetOf(kind, cause, error) : { resetsAt: deps.now(), estimated: false };
        const current = deps.threadSelection(dispatch.botId, threadId);
        // Known from now on, whatever happens to this turn (hold). An
        // exhausted catalog never blocks the whole engine: other models may
        // still work later.
        if (kind) hold(dispatch, current, resetsAt, estimated, error?.scope);
        if (!deps.enabled()) return false;
        if (!current) return false;
        // Auto goes on with its own next pick (failed's `auto`); a chosen
        // model moves to a backup, unless the person changed it meanwhile.
        const auto = current.auto === true;
        const run = routineRun ? { id: routineRun.id, routineId: routineRun.routineId } : null;
        const request = run ? undefined : deps.request(threadId);
        const own = request && !request.stopped && request.origin?.kind === "user" && request.messageId &&
          (!request.turnId || !turnId || request.turnId === turnId) ? { messageId: request.messageId } : null;
        // The person's message ran on a quick model Sagax picked (a call
        // turn's): it goes again at once, its conversation untouched, and no
        // incident relays the raw limit as the bot's (detourFailed).
        if (!auto && kind && !run && own && detoured(dispatch, current)) {
          if (!store.takeResend(own.messageId)) return false;
          track(detourFailed(threadId, turnId, dispatch, current, resetsAt, estimated, own).catch((failure) => {
            console.warn(`[limit-failover] ${threadId}: ${failure instanceof Error ? failure.message : String(failure)}`);
          }));
          return true;
        }
        if (!auto && !same(current, dispatch.selection)) return false;
        if (auto && kind) deps.autoRefuse?.(threadId, dispatch.payer, resetsAt);
        if (!run && !own) return false;
        track(failed(threadId, turnId, dispatch, resetsAt, own, run, auto ? { modelOnly: error?.scope === "model" || exhausted } : null, exhausted, estimated).catch((failure) => {
          console.warn(`[limit-failover] ${threadId}: ${failure instanceof Error ? failure.message : String(failure)}`);
        }));
        return true;
      } catch (failure) {
        console.warn(`[limit-failover] ${threadId}: ${failure instanceof Error ? failure.message : String(failure)}`);
        return false;
      }
    },

    beforeTurn(botId, threadId, speaker) {
      try {
        if (!deps.enabled()) return null;
        const payer = deps.payer(botId, speaker);
        const row = store.failover(botId, threadId);
        if (row) {
          const current = deps.threadSelection(botId, threadId);
          if (!same(current, row.to)) store.forget(threadId);
          else if (store.due(row) && store.blockedUntil(payer, row.from.instanceId) === null) {
            const refused = deps.switchThread(botId, threadId, row.from);
            if (!refused) {
              store.forget(threadId);
              deps.note(threadId, { kind: "back", engine: deps.engineName(row.from.instanceId) });
              return null;
            }
            console.warn(`[limit-failover] ${threadId}: could not go back to ${row.from.instanceId}: ${refused}`);
          }
        }
        // The thread's engine is known to be at its limit for this payer: a
        // backup takes the turn before it is refused.
        const selection = deps.threadSelection(botId, threadId);
        if (!selection || selection.auto === true) return null;
        const until = store.blockedUntil(payer, selection.instanceId);
        const from = until === null ? undefined : deps.engine(selection.instanceId);
        if (until === null || !from) return null;
        return pick(botId, threadId, speaker, from, payer).then((backup) => {
          // Nothing awaited after the pick: the thread is read again here.
          if (!backup || !same(deps.threadSelection(botId, threadId), selection)) return;
          // The thread runs on a backup standing in for its own engine (an
          // earlier move) and that backup is held now: back on its own engine
          // at that engine's own reset, never at the backup's later one, and
          // the line names the backup as the engine at its limit, as failed()
          // does (2026-11-02, final review).
          const earlier = store.failover(botId, threadId);
          const home = earlier && same(earlier.to, selection) ? earlier : null;
          if (deps.switchThread(botId, threadId, backup)) return;
          const owner = deps.ownerPays?.(botId, speaker) ? { owner: true as const } : {};
          if (home) {
            const resetsAt = Math.max(home.resetsAt, store.blockedUntil(payer, home.from.instanceId) ?? 0);
            const kept = store.record({
              botId, threadId, from: selection, to: backup, resetsAt, at: deps.now(),
              ...(estimatedFor(payer, home.from.instanceId, resetsAt, home.estimated === true) ? { estimated: true as const } : {}),
            });
            deps.note(threadId, {
              kind: "switched", from: deps.engineName(selection.instanceId), to: deps.engineName(backup.instanceId),
              home: deps.engineName(home.from.instanceId), resetsAt: kept.resetsAt, ...owner, ...(kept.estimated ? { estimated: true as const } : {}),
            });
            return;
          }
          const kept = store.record({
            botId, threadId, from: selection, to: backup, resetsAt: until, at: deps.now(),
            ...(estimatedFor(payer, selection.instanceId, until, false) ? { estimated: true as const } : {}),
          });
          deps.note(threadId, {
            kind: "switched", from: deps.engineName(kept.from.instanceId), to: deps.engineName(backup.instanceId), resetsAt: kept.resetsAt,
            ...owner, ...(estimatedFor(payer, kept.from.instanceId, kept.resetsAt, false) ? { estimated: true as const } : {}),
          });
        }).catch((failure) => {
          console.warn(`[limit-failover] before turn ${threadId}: ${failure instanceof Error ? failure.message : String(failure)}`);
        });
      } catch (failure) {
        console.warn(`[limit-failover] before turn ${threadId}: ${failure instanceof Error ? failure.message : String(failure)}`);
        return null;
      }
    },

    async tick() {
      for (const resume of store.takeDue()) {
        try {
          if (resume.kind === "routine") {
            deps.rerunRoutine(resume.routineId);
            continue;
          }
          const sent = await deps.resend(resume.botId, resume.threadId, resume.messageId, resume.speaker, resume.trigger);
          // Busy now: once more a minute later, unless a newer message took its place.
          if (!sent && !resume.retry && deps.threadSelection(resume.botId, resume.threadId)) {
            const request = deps.request(resume.threadId);
            // A request the person stopped is never sent again (Stop is final).
            if (request?.stopped && request.messageId === resume.messageId) continue;
            if (!request?.messageId || request.messageId === resume.messageId) store.schedule({ ...resume, at: deps.now() + RETRY_BUSY_MS, retry: true });
          }
        } catch (failure) {
          console.warn(`[limit-failover] resume: ${failure instanceof Error ? failure.message : String(failure)}`);
        }
      }
      arm();
    },

    start() {
      started = true;
      arm();
    },

    stop() {
      started = false;
      timer?.cancel();
      timer = null;
    },

    async idle() {
      while (pending.size) await Promise.allSettled(pending);
    },
  };
  return host;
}
