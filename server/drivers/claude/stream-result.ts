/** Claude stream-json `result` frame handling (#1383). */
import { isContextFullText } from "../../context-renewal.ts";
import { appendNative } from "../native.ts";
import { USAGE_LIMIT } from "../retry.ts";
import {
  claudeContextFull,
  claudeResultError,
  resultRepeatsReply,
} from "./limits.ts";
import {
  STEERED_CONTINUATION_GRACE_MS,
  steerGraceScale,
  sumNativeTurnResults,
  type NativeTurnResult,
} from "./session-types.ts";
import type { ClaudeTurnCtx } from "./turn-ctx.ts";

export function handleClaudeResult(ctx: ClaudeTurnCtx, o: any): void {
  const {
    session, threadId, sessionId, emit, base, settleResult, reachLimit,
    noteCostState, currentTurnId, closeSession,
  } = ctx;

// A synthetic background completion is not the result of the
// submitted user turn. Settling it would revoke browser access
// and deny approvals while that user turn is still running.
if (o.origin?.kind === "task-notification") return;
// A --resume the CLI refused before announcing the session: no
// `init`, so it never took the prompt. After a long idle 2.1.295
// answers a session it no longer has with an error result
// ("No conversation found with session ID …") and stays up,
// instead of exiting. End the process: its close rebuilds the
// conversation on a fresh session, once, as for a CLI that exits
// before `init` (classifyResumeFailure).
if (o.is_error === true && sessionId && !session.sawInit && session.turn && !session.turn.settled) {
  closeSession(threadId, "resume refused");
  return;
}
// The context filled up: the api-error frame said so, or only
// this result does. Nothing is settled or shown here; the close
// goes on in a fresh session (finalizeClose). A Stop is no
// failure, and a turn already renewed once is reported there.
if (o.is_error === true && session.turn && !session.turn.settled && !session.turn.stopRequested &&
    (session.turn.contextFull || claudeContextFull(o, "") || isContextFullText([o.result, ...(Array.isArray(o.errors) ? o.errors : [])].filter((said) => typeof said === "string").join("\n")))) {
  session.turn.contextFull = session.turn.explained = true;
  if (typeof o.total_cost_usd === "number") session.turn.contextFullTotal = o.total_cost_usd;
  closeSession(threadId, "context full");
  return;
}
// The usage limit refused this turn even if no frame said so: the
// result's own error code (2.1.295) or words do, or the CLI's
// rate_limit_event did and nothing failed the turn before it.
if (o.is_error === true && !session.turn?.authFailed && (session.turn?.limit ||
    o.api_error === "usage_limit_reached" || USAGE_LIMIT.test(String(o.result ?? "")))) reachLimit(o, o.result);
// Any other error result nothing has explained yet is a turn that
// failed without an api-error frame: its own words say why, so a
// failed turn is never an empty one. A Stop is no failure.
// An error result whose text is the reply the turn already gave
// (Claude Code can flag a turn that answered in full): the reply
// stands and the turn completes. The flag is a technical note for
// the Events lens, never the reply repainted as an error.
const replyStands = o.is_error === true && session.turn != null && !session.turn.settled && !session.turn.explained &&
  !session.turn.stopRequested && resultRepeatsReply(o, session.turn.lastText);
if (replyStands && session.turn) {
  session.turn.explained = true;
  emit({ ...base(threadId, currentTurnId()), type: "runtime.notice",
    message: `Claude flagged the turn as an error after its reply (${String((o.subtype !== "success" && o.subtype) || o.terminal_reason || "no reason given")}); the reply stands.` });
}
if (o.is_error === true && session.turn && !session.turn.settled && !session.turn.explained && !session.turn.stopRequested) {
  session.turn.explained = true;
  emit({ ...base(threadId, currentTurnId()), type: "runtime.error", message: claudeResultError(o, session.turn.lastText) });
}
// result.usage is this turn's own figure, "per-turn in
// streaming-input sessions" (2.1.282) even on a retained process.
// cache reads count as input: they are billed (at the cache rate)
// and they fill the window — but they are reported separately
// too, so the UI can show how much of the figure was context
// re-read rather than new text. total_cost_usd is instead the
// process's running total; settle() books this turn's share.
noteCostState(o.total_cost_usd, o.modelUsage, {
  input: o.usage?.input_tokens || 0,
  cacheRead: o.usage?.cache_read_input_tokens || 0,
  cacheWrite: o.usage?.cache_creation_input_tokens || 0,
  output: o.usage?.output_tokens || 0,
});
const native: NativeTurnResult = {
  ok: o.is_error !== true || replyStands,
  // An error result's stop_reason is its synthetic message's
  // ("stop_sequence") or none, which says nothing; its terminal
  // reason ("api_error") or kind ("error_during_execution") does.
  stopReason: session.turn?.authFailed
    ? "auth_required"
    : session.turn?.limitReached
      ? "quota"
      : session.turn?.updateRequired
        ? "update_required"
        : o.is_error === true && !replyStands
          ? o.terminal_reason ?? (typeof o.subtype === "string" && o.subtype !== "success" ? o.subtype : null) ?? o.stop_reason ?? null
          : o.stop_reason ?? o.terminal_reason ?? null,
  cost: o.total_cost_usd ?? null,
  ...(o.usage
    ? {
        usage: {
          input: (o.usage.input_tokens || 0) + (o.usage.cache_read_input_tokens || 0) + (o.usage.cache_creation_input_tokens || 0),
          output: o.usage.output_tokens || 0,
          ...(typeof o.usage.cache_read_input_tokens === "number"
            ? { cachedInput: o.usage.cache_read_input_tokens }
            : {}),
        },
      }
    : {}),
};
const t = session.turn;
// Does another user turn follow this result without more input?
// The CLI says so itself when it can: queued_turn_count ("greater
// than 0 means at least one more user turn (and result) follows",
// 2.1.282) counts its command queue. A message steered in over
// stdin is not in that queue when the result is written — the
// incident's result said 0 and the CLI ran the message 58 ms later
// — so 0, like an absent field, decides nothing; the steers the
// driver has not seen taken in do. With --replay-user-messages the
// CLI echoes a steer as a model call takes it in, so one still
// pending here runs next. Without it (an older CLI), nothing says
// whether a steer was folded in or runs next (the time a tool
// result is read proves nothing about when stdin was taken), so
// any steer holds the result: if no `init` follows within the
// grace, it was folded, and the held result is the turn's. A steer
// landing while a result is held extends the hold.
const queuedTurns = typeof o.queued_turn_count === "number" ? o.queued_turn_count : 0;
if (t && !t.settled && (queuedTurns > 0 || t.pendingSteers.size > 0)) {
  // The CLI runs the queued message next, in this process, with
  // this turn's tools, and the harness recorded it as part of this
  // turn. A `turn.completed` now would revoke the turn's
  // capabilities under that continuation (its internal tools would
  // answer 401) and show the bot idle while it works. Hold this
  // result until the continuation's own arrives.
  // Echoed steers leave the set as their turn takes them in;
  // without the echo, this hold answers for every steer so far.
  if (!session.replaysUserMessages) t.pendingSteers.clear();
  t.deferred = sumNativeTurnResults(t.deferred, native);
  t.armGrace = () => {
    if (t.continuationGrace) clearTimeout(t.continuationGrace);
    t.continuationGrace = setTimeout(() => {
      // No `init` came: the message was folded into the call that
      // just finished after all (or a queued send was cancelled),
      // and the held result is the turn's.
      if (session.turn !== t || t.settled) return;
      // A Stop or a close settles the turn in finalizeClose: as
      // interrupted after a Stop, else on the held result, which
      // the grace still being set tells it the turn owns. (taskkill
      // is asynchronous on Windows, so the CLI can outlive a Stop
      // by longer than this grace.)
      if (t.stopRequested || session.closing) return;
      t.continuationGrace = null;
      if (t.deferred) settleResult(t.deferred);
    }, STEERED_CONTINUATION_GRACE_MS * steerGraceScale());
    t.continuationGrace.unref?.();
  };
  t.armGrace();
  appendNative(threadId, { dir: "out", source: "claude.session", msg: { hold: `result: a steered message is still queued (queued_turn_count ${o.queued_turn_count ?? "absent"})` } });
  return;
}
settleResult(sumNativeTurnResults(t?.deferred ?? null, native));
return;
}
