// What an unattended routine run's failure turns into: a passing failure starts the run once more after a short wait, a
// busy target is waited for, a usage limit with a known reset is waited out, and what only the owner can fix fails at
// once and is told to them once per bot and cause, until one of that bot's runs completes.
import type { RuntimeEvent } from "../shared/runtime-events.ts";
import type { RoutineRetryCause } from "../shared/routines.ts";
import { CLAUDE_NEEDS_RECONNECTING, CLAUDE_SIGN_IN_EXPIRED, isClaudeReconnectCondition } from "./drivers/claude-errors.ts";
import { classifyError, USAGE_LIMIT } from "./drivers/retry.ts";
import type { RoutineRun } from "./routines.ts";
import { hostTimeZone } from "./turn-clock.ts";

export type RoutineOwnerCause = "signed_out" | "credits" | "usage_limit" | "setup";

/** What is known about a failure besides its words: a cause the server words itself, and the engine's own flags. */
export interface RoutineFailureFacts {
  cause?: "stalled" | "busy";
  stopReason?: string | null;
  setup?: boolean;
  stalled?: boolean;
  limitResetsAt?: number;
  /** Model-only refusal (Claude extra-usage credits, one model's weekly window). */
  limitScope?: "model";
}

export type RoutineFailureClass =
  | { kind: "retry"; cause: Exclude<RoutineRetryCause, "usage_limit"> }
  | { kind: "busy" }
  | { kind: "owner"; cause: RoutineOwnerCause; resetsAt?: number }
  | { kind: "final" };

/** A failure notification's own words; null stays quiet because the owner was already told. */
export interface RoutineAlert { detail: string }

export interface RoutineOwnerNotice { botId: string; cause: RoutineOwnerCause; at: number }

export type RoutineRecovery =
  | { queued: true; alert?: RoutineAlert }
  | { queued: false; error: string; alert?: RoutineAlert | null }
  /** Pause until the person reconnects Claude; the run is not lost and does not fail. */
  | { waiting: true; attention: string; alert?: RoutineAlert | null };

const RETRY_MS = 15_000;
const RATE_LIMIT_RETRY_MS = 60_000;
export const ROUTINE_BUSY_RECHECK_MS = 30_000;
export const ROUTINE_BUSY_WAIT_MS = 60 * 60_000;
/** Past this, a usage limit fails the run instead: the routine's next scheduled runs come sooner. */
const LIMIT_WAIT_MS = 12 * 60 * 60_000;
const AFTER_RESET_MS = 60_000;
const WEEK_MS = 7 * 24 * 60 * 60_000;
/** startTurn's codes for a bot or thread that is busy for now. */
const BUSY_CODES = new Set(["thread_busy", "thread_limit", "workspace_busy", "settling"]);
const OWNER_CAUSES = new Set<RoutineOwnerCause>(["signed_out", "credits", "usage_limit", "setup"]);

/** Codex's ChatGPT workspace routing lookup: passing, unlike its "unauthorized" variant (a sign-in problem). */
const ROUTING_LOOKUP = /\bworkspace routing discovery (?:failed|timed out)\b/i;

/** A provider refusing for want of credit or payment, in its own words. */
const OUT_OF_CREDITS = /\bpayment required\b|\b(?:http|status) 402\b|\binsufficient (?:account )?(?:funds|balance|credits?)\b|\b(?:credit|account) balance is too low\b|\bout of credits?\b|\bno credits? (?:left|remaining)\b|\bused all (?:available |of (?:your|its) )?credits\b/i;

const OWNER_ACTION: Record<Exclude<RoutineOwnerCause, "setup">, string> = {
  signed_out: "This bot's engine is signed out. Sign in again in Settings → Model providers.",
  credits: "This bot's engine account is out of credit. Add credit with the provider, or choose another engine for this bot.",
  usage_limit: "This bot's engine reached its usage limit. Its routines work again once it resets, or choose another engine for this bot now.",
};

const CLAUDE_RECONNECT_ACTION =
  `${CLAUDE_SIGN_IN_EXPIRED} Routines that use Claude wait until you reconnect; they resume on their own after.`;
const RETRY_WHY: Record<Exclude<RoutineRetryCause, "usage_limit">, string> = {
  stalled: "the engine stalled", restarted: "Sagax restarted while it ran", rate_limited: "a rate limit", provider: "a temporary error",
};
const FIRST_START: Record<RoutineRetryCause, string> = {
  stalled: "stopped when its engine stalled", restarted: "was cut off when Sagax restarted", rate_limited: "was stopped by a rate limit",
  provider: "failed on a temporary engine error", usage_limit: "was refused by the engine's usage limit",
};

export function classifyRoutineFailure(failure: string, facts: RoutineFailureFacts = {}): RoutineFailureClass {
  if (facts.cause === "busy") return { kind: "busy" };
  if (facts.cause === "stalled" || facts.stalled) return { kind: "retry", cause: "stalled" };
  const { reason, transient } = classifyError({ text: failure });
  if (OUT_OF_CREDITS.test(failure)) return { kind: "owner", cause: "credits" };
  // Claude extra-usage credits: model-only, no reset to wait for. Never a plan window.
  if (isClaudeReconnectCondition(failure) && (facts.limitScope === "model" || !facts.limitResetsAt) &&
    (facts.stopReason === "quota" || reason === "quota" || /extra usage/i.test(failure))) {
    return { kind: "owner", cause: "credits" };
  }
  if (facts.limitResetsAt || facts.stopReason === "quota" || USAGE_LIMIT.test(failure)) {
    return { kind: "owner", cause: "usage_limit", ...(facts.limitResetsAt ? { resetsAt: facts.limitResetsAt } : {}) };
  }
  if (facts.stopReason === "auth_required" || reason === "auth") return { kind: "owner", cause: "signed_out" };
  if (reason === "quota") return { kind: "owner", cause: "credits" };
  if (facts.setup || facts.stopReason === "update_required" || facts.stopReason === "setup_required") return { kind: "owner", cause: "setup" };
  if (reason === "rate_limited") return { kind: "retry", cause: "rate_limited" };
  if (transient || ROUTING_LOOKUP.test(failure)) return { kind: "retry", cause: "provider" };
  return { kind: "final" };
}

export function dispatchRefusal(error: unknown): RoutineFailureFacts {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && BUSY_CODES.has(code) ? { cause: "busy" } : {};
}

export function engineFacts({ setup, stalled, limitResetsAt, limitScope }: RuntimeEvent & { type: "runtime.error" }): RoutineFailureFacts {
  return { setup, stalled, limitResetsAt, ...(limitScope === "model" ? { limitScope } : {}) };
}

/** Host-local, with its zone: on a Cloud home the host's zone need not be the reader's. */
function when(at: number): string {
  const timeZone = hostTimeZone();
  try {
    return `${new Date(at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone })} (${timeZone})`;
  } catch {
    return `${new Date(at).toISOString().slice(0, 16).replace("T", " ")} UTC`;
  }
}

/** Queues the run's one second start; false when it already had it or is not a bot's run. */
export function requeueOnce(run: RoutineRun, cause: RoutineRetryCause, failure: string, now: number,
  at = now + (cause === "rate_limited" ? RATE_LIMIT_RETRY_MS : RETRY_MS)): boolean {
  if (run.target !== "bot" || run.retried !== undefined) return false;
  run.status = "queued";
  run.retried = cause;
  run.retryAt = at;
  run.attention = cause === "usage_limit"
    ? `Waiting for the engine's usage limit to reset; this run starts again at ${when(at)}`
    : `Starting again shortly after ${RETRY_WHY[cause]}${cause === "restarted" ? "" : `: ${failure}`}`.slice(0, 500);
  delete run.error;
  return true;
}

/** The second start's own line, so a run that already did part of its work does not do it twice. */
export function retryNote(cause: RoutineRetryCause): string {
  return `[Sagax: this run's first start ${FIRST_START[cause]} before it finished. If it already did part of the work, ` +
    "check what it did (files, messages sent, anything started) so nothing is done twice; then finish the routine.]";
}

function firstNotice(notices: RoutineOwnerNotice[], botId: string, cause: RoutineOwnerCause, at: number): boolean {
  if (notices.some((notice) => notice.botId === botId && notice.cause === cause)) return false;
  notices.push({ botId, cause, at });
  return true;
}

/** What a failed attempt becomes. A queued run is changed in place; a failing one is the caller's to fail with `error`. */
export function recoverRun(run: RoutineRun, failure: string, facts: RoutineFailureFacts, now: number, notices: RoutineOwnerNotice[]): RoutineRecovery {
  const verdict: RoutineFailureClass = run.target === "bot" ? classifyRoutineFailure(failure, facts) : { kind: "final" };
  const again = run.retried ? `Failed after one automatic retry: ${failure}` : failure;
  if (verdict.kind === "busy") {
    run.deferredAt ??= now;
    if (now - run.deferredAt >= ROUTINE_BUSY_WAIT_MS) return { queued: false, error: `Did not start: still busy after ${ROUTINE_BUSY_WAIT_MS / 60_000} minutes (${failure})` };
    run.status = "queued";
    run.retryAt = now + ROUTINE_BUSY_RECHECK_MS;
    run.attention = `Waiting to start: ${failure}`.slice(0, 500);
    delete run.error;
    return { queued: true };
  }
  if (verdict.kind === "retry") return requeueOnce(run, verdict.cause, failure, now) ? { queued: true } : { queued: false, error: again };
  if (verdict.kind === "final") return { queued: false, error: again };
  const first = firstNotice(notices, run.botId, verdict.cause, now);
  const reset = verdict.resetsAt;
  if (reset && reset > now && reset - now <= LIMIT_WAIT_MS && requeueOnce(run, "usage_limit", failure, now, reset + AFTER_RESET_MS)) {
    return { queued: true, ...(first ? { alert: { detail: `This bot's engine reached its usage limit. This run starts again at ${when(reset + AFTER_RESET_MS)}.` } } : {}) };
  }
  // Claude auth expired or extra-usage credits: pause the run until reconnect.
  // No failed status, so the proactive waker never loops on the same cause.
  if ((verdict.cause === "signed_out" || verdict.cause === "credits") && isClaudeReconnectCondition(failure)) {
    delete run.error;
    delete run.retryAt;
    delete run.retried;
    return {
      waiting: true,
      attention: CLAUDE_NEEDS_RECONNECTING,
      alert: first ? { detail: CLAUDE_RECONNECT_ACTION } : null,
    };
  }
  const action = verdict.cause === "setup" ? failure : OWNER_ACTION[verdict.cause];
  return { queued: false, error: verdict.cause === "signed_out" ? `${action} The engine said: “${failure}”` : failure, alert: first ? { detail: action } : null };
}

export function loadOwnerNotices(value: unknown): RoutineOwnerNotice[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((notice) => typeof notice?.botId === "string" && OWNER_CAUSES.has(notice.cause) && Number.isFinite(notice.at)
    ? [{ botId: notice.botId, cause: notice.cause as RoutineOwnerCause, at: notice.at as number }] : []).slice(-500);
}

export function weekRuns(runs: readonly RoutineRun[], routineId: string, now: number): { ok: number; total: number } | undefined {
  let ok = 0, total = 0;
  for (const run of runs) {
    if (run.routineId !== routineId || !["completed", "failed", "missed"].includes(run.status) || (run.finishedAt ?? run.createdAt) < now - WEEK_MS) continue;
    total += 1;
    // Completed with problems (2026-11-01) is not a clean run.
    if (run.status === "completed" && !run.problems) ok += 1;
  }
  return total ? { ok, total } : undefined;
}
