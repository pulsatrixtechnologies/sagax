/** Claude context-full, usage-limit and API-error helpers (issue #1383). */
import { hostTimeZone } from "../../bot-settings.ts";
import { isContextFullText } from "../../context-renewal.ts";
import { USAGE_LIMIT } from "../retry.ts";
import { engineFailureMessage, type EngineFailureKind } from "../engine-errors.ts";

export function claudeContextFull(
  frame: { error?: unknown; is_api_error_message?: unknown; api_error?: unknown; terminal_reason?: unknown },
  text: string,
): boolean {
  if (frame.api_error === "autocompact_thrashing" || frame.terminal_reason === "rapid_refill_breaker") return true;
  if (frame.is_api_error_message !== true && typeof frame.error !== "string") return false;
  return isContextFullText(text);
}

/** The usage window that refuses a Claude account's requests. */
export interface ClaudeLimit {
  /** the CLI's rateLimitType: five_hour, seven_day, seven_day_opus,
   * seven_day_sonnet, seven_day_overage_included or overage (2.1.295); null
   * when it names none */
  window: string | null;
  /** when that window reopens, in epoch seconds; null when unsaid */
  resetsAt: number | null;
  /** The plan still had room: this model runs on extra usage and its
   * credits are used up, so `resetsAt` is the billing period's reset and
   * other models on the same account keep working. */
  credits?: true;
}

/** The window a CLI's `rate_limit_info` says refuses this account, or null
 * while its requests go through. The CLI reads it from the API's headers on
 * every response and reports it in a `rate_limit_event` — "allowed",
 * "allowed_warning" near a limit, "rejected" past it (2.1.272, 2.1.295) —
 * and, from 2.1.295, on the refused call's api-error frame too
 * (`api_error_params`). A rejected window with extra usage in use still runs
 * the turn on usage credits, so only a refusal without them counts. */
export function claudeLimitRefusal(info: unknown): ClaudeLimit | null {
  if (!info || typeof info !== "object") return null;
  const { status, rateLimitType, resetsAt, isUsingOverage, errorCode, overageDisabledReason } = info as Record<string, unknown>;
  if (status !== "rejected" || isUsingOverage === true) return null;
  return {
    window: typeof rateLimitType === "string" ? rateLimitType : null,
    resetsAt: typeof resetsAt === "number" && Number.isFinite(resetsAt) && resetsAt > 0 ? resetsAt : null,
    ...(errorCode === "credits_required" || overageDisabledReason === "out_of_credits" ? { credits: true as const } : {}),
  };
}

/** The CLI's api-error frame for a call its account's usage limit refused:
 * its own code says so (`api_error: "usage_limit_reached"`, 2.1.295), or its
 * words do ("You've hit your weekly limit · resets …"), or a
 * `rate_limit_event` had already refused the account (`refused`). A refused
 * account runs nothing until the window reopens, so that is the failure to
 * report whatever else the same call said: 2.1.272 answered an account at
 * its weekly limit with "does not support this model" and an update offer,
 * and the person updated, to the same refusal. Gated on the CLI's error
 * flag, like a sign-in failure. */
export function claudeUsageLimit(
  frame: { error?: unknown; is_api_error_message?: unknown; api_error?: unknown },
  text: string,
  refused = false,
): boolean {
  if (frame.is_api_error_message !== true && typeof frame.error !== "string") return false;
  return refused || frame.api_error === "usage_limit_reached" || USAGE_LIMIT.test(text);
}

/** Each window as Settings → Usage names it ("5-hour", "Weekly"); any other
 * is the account's usage limit. */
const CLAUDE_LIMIT_NAMES: Record<string, string> = {
  five_hour: "5-hour limit",
  seven_day: "weekly limit",
  seven_day_opus: "weekly Opus limit",
  seven_day_sonnet: "weekly Sonnet limit",
};

/** A weekly window for one model family (seven_day_opus, seven_day_sonnet…),
 * not the overage windows. */
const modelWindow = (window: string | null | undefined): boolean => /^seven_day_(?!overage)[a-z]+$/.test(window ?? "");

/** What a refused turn's runtime.error says about the engine. Only a window
 * every model shares holds the whole engine until it resets; a credits
 * refusal or one model's weekly window is `limitScope: "model"`, which
 * leaves the engine free for its other models
 * (server/limit-failover-host.ts). A credits refusal's reset is the billing
 * period's, no countdown to wait for, so it carries no `limitResetsAt`. */
export function claudeLimitFields(limit: ClaudeLimit | null | undefined, now = Date.now()): { limitResetsAt?: number; limitScope?: "model" } {
  if (!limit) return {};
  if (limit.credits) return { limitScope: "model" };
  const resetsAt = limit.resetsAt ? limit.resetsAt * 1_000 : undefined;
  return {
    ...(resetsAt && resetsAt > now ? { limitResetsAt: resetsAt } : {}),
    ...(modelWindow(limit.window) ? { limitScope: "model" as const } : {}),
  };
}

/** One plain line for a turn its account's usage limit refused: which limit,
 * when it reopens, and what runs before then — a model's own weekly limit
 * leaves the account's other models running. Nothing to install, sign in to
 * or retry. The reset is written in this machine's zone, named as the turn
 * clock names it; with no reset to write, the CLI's own words (`said`) are
 * quoted, as they may carry one. */
export function claudeLimitMessage(limit: ClaudeLimit | null, said?: string, now = Date.now(), timeZone = hostTimeZone()): string {
  if (limit?.credits) {
    return "Claude refused this turn because this model runs on extra usage for your account, and those credits are used up. " +
      "Your plan's own usage is not affected: switch this bot to a model your plan includes, or add extra usage in your Claude account.";
  }
  const name = limit?.window && Object.hasOwn(CLAUDE_LIMIT_NAMES, limit.window) ? CLAUDE_LIMIT_NAMES[limit.window] : "usage limit";
  const meanwhile = modelWindow(limit?.window) ? "choose another model for this bot" : "switch this bot to another engine or Claude account";
  if (limit?.resetsAt && limit.resetsAt * 1000 > now) {
    let resets: string;
    try {
      resets = `${new Date(limit.resetsAt * 1000).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone })} (${timeZone})`;
    } catch {
      resets = `${new Date(limit.resetsAt * 1000).toISOString().slice(0, 16).replace("T", " ")} UTC`;
    }
    return `This Claude account has reached its ${name}, which resets ${resets}. Until then, ${meanwhile}.`;
  }
  const words = said?.trim().replace(/[.\s]+$/, "");
  return `This Claude account has reached its ${name}${words ? ` (Claude says: "${words}")` : ""}. For now, ${meanwhile}.`;
}

/** What an error `result` says failed its turn: its `errors` (2.1.295:
 * "No conversation found with session ID: …"), else its text, else its
 * kind. */
export function claudeResultError(frame: { errors?: unknown; result?: unknown; subtype?: unknown; terminal_reason?: unknown; api_error_status?: unknown }, reply?: string): string {
  const errors = Array.isArray(frame.errors) ? frame.errors.filter((error): error is string => typeof error === "string" && error.trim() !== "") : [];
  if (errors.length) return errors.join("; ");
  // The result's text is the turn's own reply, not what failed it: never its cause.
  if (typeof frame.result === "string" && frame.result.trim() && !resultRepeatsReply(frame, reply)) return claudeApiErrorMessage(frame, frame.result);
  return `Claude ended the turn with an error (${String((frame.subtype !== "success" && frame.subtype) || frame.terminal_reason || "unknown")}).`;
}

/** Whether an error `result` only repeats the reply the turn already gave
 * (`reply`: the turn's latest text, its last 2 000 characters): no `errors`
 * of its own, and its text is that reply. The reply then stands. */
export function resultRepeatsReply(frame: { errors?: unknown; result?: unknown }, reply: string | undefined): boolean {
  if (Array.isArray(frame.errors) && frame.errors.some((error) => typeof error === "string" && error.trim() !== "")) return false;
  const said = reply?.trim();
  const result = typeof frame.result === "string" ? frame.result.trim() : "";
  return Boolean(said && result && (result === said || result.endsWith(said)));
}

/** Claude Code 2.1.295's api-error kinds (the assistant frame's `error`) that say the cause outright. */
const CLAUDE_ERROR_KINDS: Record<string, EngineFailureKind> = {
  billing_error: "credits",
  overloaded: "overloaded",
  server_error: "server",
  rate_limit: "rate_limit",
};

/** An api-error frame or error result in plain words. Claude Code sends the frame as a synthetic message whose
 * stop_reason is "stop_sequence", with `error` (billing_error, overloaded, server_error, rate_limit, invalid_request,
 * model_not_found, unknown...) and its text ("API Error: 529 ...", "Credit balance is too low"); the result repeats the
 * text with `api_error_status`. Each is one plain row, never a reply: a kind or status Sagax words is named, anything
 * else keeps Claude's own words. */
export function claudeApiErrorMessage(frame: { error?: unknown; api_error_status?: unknown }, text: string): string {
  const said = text.trim();
  const kind = typeof frame.error === "string" && Object.hasOwn(CLAUDE_ERROR_KINDS, frame.error) ? CLAUDE_ERROR_KINDS[frame.error] : null;
  const status = typeof frame.api_error_status === "number" ? frame.api_error_status : undefined;
  return engineFailureMessage("Claude", said, { kind, status }) ?? said;
}

/** A model newer than the installed Claude Code: the API refuses it and the
 * CLI relays that as an api-error frame. Like a signed-out turn, it is fixed
 * by changing the install, not by a retry. */
export function claudeVersionTooOld(
  frame: { error?: unknown; is_api_error_message?: unknown },
  text: string,
): boolean {
  if (frame.is_api_error_message !== true && typeof frame.error !== "string") return false;
  return /\bClaude Code v?\d+(?:\.\d+)+ does not support this model\b/i.test(text);
}
