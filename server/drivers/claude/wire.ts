/** Wire settle/reachLimit/cost helpers onto a Claude turn ctx (#1383). */
import { rmSync } from "node:fs";
import { dirname } from "node:path";
import { USAGE_LIMIT } from "../retry.ts";
import { claudeSignInExpired } from "../claude-errors.ts";
import {
  claudeCostSnapshot,
  readCostHistory,
  recordCostState,
  restoredCostBase,
  turnCostFromRunningTotal,
} from "./cost.ts";
import {
  claudeLimitFields,
  claudeLimitMessage,
  claudeLimitRefusal,
} from "./limits.ts";
import { removePrivateTempDir } from "./helpers.ts";
import type { NativeTurnResult } from "./session-types.ts";
import type { ClaudeTurnCtx } from "./turn-ctx.ts";

export function attachClaudeWire(ctx: ClaudeTurnCtx): void {
  const {
    session, threadId, turnId, emit, base, retryState, active,
    closeSession, armIdle, carriedCosts, renewedTurns,
    refreshSubscriptionHome, sendTurn,
  } = ctx;

const settle = (
  ok: boolean,
  stopReason: string | null,
  total: number | null = null,
  usage?: { input: number; output: number; cachedInput?: number },
) => {
  const t = session.turn;
  if (!t || t.settled) return;
  // #1768: a concurrent refresh of this person's login home can revoke
  // the token this process held. Renew once under the shared flight and
  // relaunch before treating the sign-in as gone.
  const retry = retryState.get(threadId) ?? { attempt: 0, cancelled: false };
  const loginDir = t.input.access?.via === "subscription" ? t.input.access.claudeConfigDir?.trim() : "";
  if (!ok && stopReason === "auth_required" && loginDir && !retry.authRaced && !retry.cancelled && !t.stopRequested) {
    t.settled = true;
    session.lastTurnFailed = true;
    session.broker?.pause();
    if (session.mcpConfigPath) {
      try { rmSync(dirname(session.mcpConfigPath), { recursive: true, force: true }); } catch {}
      session.mcpConfigPath = null;
    }
    if (session.systemPromptPath) {
      if (removePrivateTempDir(session.systemPromptPath)) session.systemPromptPath = null;
    }
    const { turnId: racedTurnId, input: racedTurn, retryAbort } = t;
    session.turn = null;
    retry.authRaced = true;
    retryState.set(threadId, retry);
    active.set(threadId, { stop: () => { retry.cancelled = true; retryAbort.abort(); }, turnId: racedTurnId });
    closeSession(threadId, "authentication race");
    void (async () => {
      const failure = t.authFailureText ?? claudeSignInExpired("authentication_failed");
      try {
        const fresh = await refreshSubscriptionHome(racedTurn, true);
        if (retry.cancelled || !fresh.ok) {
          if (active.get(threadId)?.turnId === racedTurnId) active.delete(threadId);
          retryState.delete(threadId);
          emit({ ...base(threadId, racedTurnId), type: "runtime.error", message: failure, setup: true });
          emit({ ...base(threadId, racedTurnId), type: "turn.completed", ok: false, stopReason: "auth_required", cost: null });
          return;
        }
        await sendTurn({ ...racedTurn, sessionReset: false }, racedTurnId);
      } catch (error) {
        if (active.get(threadId)?.turnId === racedTurnId) active.delete(threadId);
        retryState.delete(threadId);
        const message = error instanceof Error ? error.message : String(error);
        emit({ ...base(threadId, racedTurnId), type: "runtime.error", message: claudeSignInExpired(message), setup: true });
        emit({ ...base(threadId, racedTurnId), type: "turn.completed", ok: false, stopReason: "auth_required", cost: null });
      }
    })();
    return;
  }
  if (!ok && stopReason === "auth_required" && t.authFailureDeferred && t.authFailureText) {
    emit({ ...base(threadId, t.turnId), type: "runtime.error", message: t.authFailureText, setup: true });
  }
  t.settled = true;
  session.lastTurnFailed = !ok;
  if (t.continuationGrace) {
    clearTimeout(t.continuationGrace);
    t.continuationGrace = null;
  }
  if (t.continuationSilence) {
    clearTimeout(t.continuationSilence);
    t.continuationSilence = null;
  }
  // Resolve any ask still open for this turn, but keep the broker
  // listening for the next turn on the retained process. Between turns
  // isActive() rejects late background asks without creating cards.
  session.broker?.pause();
  // the config file holds live credentials — the CLI read it at start;
  // it must not sit on disk for the life of the session
  if (session.mcpConfigPath) {
    try {
      rmSync(dirname(session.mcpConfigPath), { recursive: true, force: true });
    } catch {}
    session.mcpConfigPath = null;
  }
  if (session.systemPromptPath) {
    if (removePrivateTempDir(session.systemPromptPath)) session.systemPromptPath = null;
  }
  active.delete(threadId);
  session.turn = null;
  // A settled turn owns no retry budget. Retained CLI sessions may run
  // many later turns on this thread, and each must start fresh.
  retryState.delete(threadId);
  // Updating the executable cannot update code already loaded by this
  // pooled child. Retire it before announcing completion so an explicit
  // retry resumes on a fresh process; healthy sibling sessions stay warm.
  // An authentication failure can leave the CLI alive while it retries
  // its shared OAuth refresh: a pooled process kept around would block
  // other Claude bots refreshing their own turn. Like an incompatible
  // update, it needs a fresh process next time (port de OpenMausBot #2867).
  if (stopReason === "update_required" || stopReason === "auth_required") {
    closeSession(threadId, stopReason === "auth_required" ? "authentication required" : "update required");
  }
  // `total` is the CLI's running total for this process; the harness
  // books turn.completed.cost as this turn's own spend
  const own = turnCostFromRunningTotal(total, session.costTotal ?? null);
  if (total !== null) session.costTotal = total;
  // a turn that went on in a fresh session also spent what the full one did
  const carried = carriedCosts.get(t.turnId);
  carriedCosts.delete(t.turnId);
  renewedTurns.delete(t.turnId);
  const cost = carried === undefined ? own : Number(((own ?? 0) + carried).toFixed(10));
  emit({ ...base(threadId, t.turnId), type: "turn.completed", ok, stopReason, cost, ...(usage ? { usage } : {}) });
  if (session.child.exitCode === null && !session.closing) armIdle(threadId);
};
const settleResult = (result: NativeTurnResult) => settle(result.ok, result.stopReason, result.cost, result.usage);
const currentTurnId = () => session.turn?.turnId ?? turnId;
// The turn ran into its account's usage limit: one plain line, once, in
// place of the CLI's words or whatever else the refused call said. It
// settles as "quota" — never a setup failure or an update offer. The
// refused call's own window (`api_error_params`) outranks the event's.
const reachLimit = (frame: { api_error_params?: { rate_limit_info?: unknown } }, words: unknown) => {
  const t = session.turn;
  if (!t || t.limitReached) return;
  t.limitReached = t.explained = true;
  t.limit = claudeLimitRefusal(frame.api_error_params?.rate_limit_info) ?? t.limit;
  const said = typeof words === "string" && USAGE_LIMIT.test(words) ? words : undefined;
  emit({ ...base(threadId, currentTurnId()), type: "runtime.error", message: claudeLimitMessage(t.limit ?? null, said),
    ...claudeLimitFields(t.limit) });
};
// The process's first result with a cost says what --resume restored,
// which its turns are measured from; every result is kept for a later
// resume. A result without one (an API error) decides nothing yet.
const noteCostState = (total: unknown, modelUsage: unknown, usage: Parameters<typeof restoredCostBase>[2]) => {
  const state = claudeCostSnapshot(total, modelUsage);
  if (!state) return;
  if (session.costTotal === undefined) {
    session.costTotal = session.sessionId
      ? restoredCostBase(readCostHistory()[session.sessionId] ?? [], state, usage)
      : null;
  }
  if (session.sessionId) recordCostState(session.sessionId, state);
};

  ctx.settle = settle;
  ctx.settleResult = settleResult;
  ctx.currentTurnId = currentTurnId;
  ctx.reachLimit = reachLimit;
  ctx.noteCostState = noteCostState;
}
