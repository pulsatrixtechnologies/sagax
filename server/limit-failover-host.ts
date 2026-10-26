// The harness side of the automatic backup on a usage limit
// (server/limit-failover.ts): what a failed turn, a turn about to start and
// the reset timer do. Everything that touches the server's state comes in
// through deps, so the rules are tested here without a server
// (server/limit-failover-host.test.ts) and through it in
// server/limit-failover.e2e.test.ts.
import type { LimitFailoverLine } from "../shared/limit-failover.ts";
import type { ModelSelection } from "../shared/wire.ts";
import { pickLimitBackup, type LimitCandidate, type LimitEngine, type LimitFailoverStore } from "./limit-failover.ts";
import { limitKindOf, limitResetFromText, limitResetOrEstimate } from "./limit-reset-time.ts";

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
  /** One `recovery:` row in the thread. */
  note: (threadId: string, line: LimitFailoverLine) => void;
  /** Turns this turn's failure row (its own, or the last written since the
   * turn was dispatched) into the line; appends it when there is none. */
  replaceFailure: (threadId: string, turnId: string | undefined, line: LimitFailoverLine, since: number) => void;
  request: (threadId: string) => LimitRequest | undefined;
  /** Sends the person's message again on the thread's engine now; false
   * when it is no longer the latest, or the thread is busy or gone. */
  resend: (botId: string, threadId: string, messageId: string, speaker: unknown, trigger: unknown) => Promise<boolean>;
  rerunRoutine: (routineId: string) => boolean;
  /** Schedules `run` in `ms`; the default is an unref'd timer. */
  after?: (ms: number, run: () => void) => { cancel(): void };
}

export interface LimitFailoverHost {
  /** Remember what a turn runs on, for its failure. */
  noteDispatch(threadId: string, dispatch: LimitDispatch): void;
  /** A runtime.error: keeps the reset the engine said, if any. */
  noteError(threadId: string, message: string, limitResetsAt?: number): void;
  /** A failed turn. True when its failure is a usage limit this module
   * takes over (no incident: the turn continues, or waits for the reset). */
  turnFailed(input: {
    threadId: string; turnId?: string; cause: string | undefined; stopReason?: string | null;
    /** The routine run this failure just failed (RoutineManager.handleRuntimeEvent), if any. */
    routineRun?: { id: string; routineId: string } | null;
  }): boolean;
  /** A turn that completed: nothing to keep for it. */
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

const RETRY_BUSY_MS = 60_000;
/** How long a failed turn's own settling may hold its thread before the
 * backup gives up waiting (the turn.completed handler releases it). */
const SETTLE_WAIT_MS = 10_000;
const SETTLE_POLL_MS = 50;

export function createLimitFailoverHost(deps: LimitFailoverHostDeps): LimitFailoverHost {
  const { store } = deps;
  const after = deps.after ?? ((ms: number, run: () => void) => {
    const timer = setTimeout(run, Math.max(0, Math.min(ms, 2_147_000_000)));
    timer.unref?.();
    return { cancel: () => clearTimeout(timer) };
  });
  const dispatches = new Map<string, LimitDispatch>();
  const errors = new Map<string, { message: string; resetsAt?: number }>();
  const pending = new Set<Promise<unknown>>();
  let timer: { cancel(): void } | null = null;
  let started = false;

  const track = (work: Promise<unknown>) => {
    pending.add(work);
    void work.finally(() => pending.delete(work));
  };
  const same = (left: ModelSelection | null | undefined, right: ModelSelection | null | undefined) =>
    Boolean(left && right && left.instanceId === right.instanceId && left.model === right.model);
  const pick = async (botId: string, threadId: string, speaker: unknown, from: LimitEngine, payer: string) => pickLimitBackup({
    from,
    preferred: deps.preferred(botId, threadId),
    candidates: await deps.candidates(botId, threadId, speaker),
    blocked: (instanceId) => store.blockedUntil(payer, instanceId) !== null,
    config: deps.config,
  });

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
    own: { messageId: string } | null, run: { id: string; routineId: string } | null) => {
    const failover = store.failover(dispatch.botId, threadId);
    // The engine the thread goes back to: the one it started on.
    const home = failover && same(failover.to, dispatch.selection) ? failover : null;
    const homeEngine = home ? deps.engine(home.from.instanceId) ?? dispatch.engine : dispatch.engine;
    const homeReset = home ? Math.max(home.resetsAt, store.blockedUntil(dispatch.payer, home.from.instanceId) ?? 0) : resetsAt;
    const backup = await pick(dispatch.botId, threadId, dispatch.speaker, dispatch.engine, dispatch.payer).catch(() => null);
    if (run) {
      if (backup && store.takeResend(`routine:${run.id}`)) {
        // The next run starts on the backup (beforeTurn) and says so there.
        if (deps.rerunRoutine(run.routineId)) return;
      }
      store.schedule({ kind: "routine", routineId: run.routineId, engine: homeEngine.instanceId, at: homeReset + store.afterResetMs });
      deps.replaceFailure(threadId, turnId, { kind: "waitingRoutine", from: deps.engineName(homeEngine.instanceId), resetsAt: homeReset }, dispatch.at);
      arm();
      return;
    }
    if (!own) return;
    // A newer turn took the thread meanwhile: it runs, this one is left as it failed.
    if (!await settled(dispatch.botId, threadId)) return;
    if (backup && store.takeResend(own.messageId)) {
      const refused = deps.switchThread(dispatch.botId, threadId, backup);
      if (!refused) {
        const kept = store.record({ botId: dispatch.botId, threadId, from: dispatch.selection, to: backup, resetsAt, at: deps.now() });
        deps.replaceFailure(threadId, turnId, {
          kind: "switched", from: deps.engineName(kept.from.instanceId), to: deps.engineName(backup.instanceId), resetsAt: kept.resetsAt,
          ...(dispatch.owner ? { owner: true as const } : {}),
        }, dispatch.at);
        await deps.resend(dispatch.botId, threadId, own.messageId, dispatch.speaker, dispatch.trigger);
        return;
      }
      console.warn(`[limit-failover] ${threadId}: could not move to ${backup.instanceId}: ${refused}`);
    }
    // Nothing can take over: the message goes again once the limit resets, once.
    if (!store.schedule({
      kind: "message", botId: dispatch.botId, threadId, messageId: own.messageId, engine: homeEngine.instanceId,
      at: homeReset + store.afterResetMs, ...(dispatch.speaker !== undefined ? { speaker: dispatch.speaker } : {}),
      ...(dispatch.trigger !== undefined ? { trigger: dispatch.trigger } : {}),
    })) return;
    deps.replaceFailure(threadId, turnId, {
      kind: "waiting", from: deps.engineName(homeEngine.instanceId), resetsAt: homeReset, ...(dispatch.owner ? { owner: true as const } : {}),
    }, dispatch.at);
    arm();
  };

  const host: LimitFailoverHost = {
    noteDispatch(threadId, dispatch) {
      dispatches.set(threadId, dispatch);
      errors.delete(threadId);
    },

    noteError(threadId, message, limitResetsAt) {
      errors.set(threadId, { message, ...(limitResetsAt !== undefined ? { resetsAt: limitResetsAt } : {}) });
    },

    turnSucceeded(threadId) {
      dispatches.delete(threadId);
      errors.delete(threadId);
    },

    turnFailed({ threadId, turnId, cause, stopReason, routineRun }) {
      const dispatch = dispatches.get(threadId);
      const error = errors.get(threadId);
      dispatches.delete(threadId);
      errors.delete(threadId);
      try {
        const kind = limitKindOf(cause ?? error?.message, stopReason);
        if (!kind || !dispatch) return false;
        const now = deps.now();
        const said = error?.resetsAt ?? limitResetFromText(cause, now) ?? limitResetFromText(error?.message, now);
        const { resetsAt } = limitResetOrEstimate(kind, said, now);
        // Known from now on, whatever happens to this turn: no other turn of
        // this payer starts on it before the reset.
        store.block(dispatch.payer, dispatch.engine.instanceId, resetsAt);
        if (!deps.enabled()) return false;
        const current = deps.threadSelection(dispatch.botId, threadId);
        // Auto picks its own engine; a viewer's own model is theirs to change.
        if (!current || current.auto === true || !same(current, dispatch.selection)) return false;
        const run = routineRun ? { id: routineRun.id, routineId: routineRun.routineId } : null;
        const request = run ? undefined : deps.request(threadId);
        const own = request && !request.stopped && request.origin?.kind === "user" && request.messageId &&
          (!request.turnId || !turnId || request.turnId === turnId) ? { messageId: request.messageId } : null;
        if (!run && !own) return false;
        track(failed(threadId, turnId, dispatch, resetsAt, own, run).catch((failure) => {
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
          if (!backup || !same(deps.threadSelection(botId, threadId), selection) || deps.switchThread(botId, threadId, backup)) return;
          const kept = store.record({ botId, threadId, from: selection, to: backup, resetsAt: until, at: deps.now() });
          deps.note(threadId, {
            kind: "switched", from: deps.engineName(kept.from.instanceId), to: deps.engineName(backup.instanceId), resetsAt: kept.resetsAt,
            ...(deps.ownerPays?.(botId, speaker) ? { owner: true as const } : {}),
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
