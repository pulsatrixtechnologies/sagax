// Whether a failed turn ran into its engine's usage limit, and when that
// limit resets, from what the engine said (port of OpenMausBot #3074's
// reset reading: codexLimitResetsAt, the Claude CLI's rate_limit_info).
// Pure: the clock is passed in (#3120: the reset is always read against the
// injected clock, never Date.now() behind the caller's back).
import { classifyError } from "./drivers/retry.ts";

export type LimitKind = "quota" | "rate_limited";

/** Words of a spent balance that the shared classifier leaves to "unknown"
 * (xAI, OpenRouter, OpenCode Go, Gemini, the Anthropic API). */
const SPENT = /\b(?:insufficient[_ ](?:account[_ ])?(?:funds|balance|credits?|quota)|(?:balance|credits?|quota) (?:is |are |has been )?(?:exhausted|used up|depleted|too low)|resource[_ ]exhausted|spending limit|credit balance is too low|usage balance)\b/i;
/** A driver's stop token for the same thing. */
const LIMIT_STOPS = new Set(["quota", "usage_limit", "usage_limit_reached", "insufficient_funds", "rate_limit"]);

/** "quota" for a spent usage limit or balance (hours away), "rate_limited"
 * for a 429 the driver already retried and gave up on, null otherwise. A
 * sign-in, a refused key or a bad request is never a limit. */
export function limitKindOf(cause: string | undefined, stopReason?: string | null): LimitKind | null {
  const text = cause ?? "";
  const reason = classifyError({ text }).reason;
  if (reason === "auth" || reason === "provider_safety" || reason === "interrupted") return null;
  if (reason === "quota" || SPENT.test(text)) return "quota";
  if (stopReason && LIMIT_STOPS.has(stopReason)) return stopReason === "rate_limit" ? "rate_limited" : "quota";
  if (reason === "rate_limited") return "rate_limited";
  return null;
}

/** With no reset time said, a conversation tries its own engine again no
 * sooner than this (upstream UNKNOWN_RESET_WAIT_MS). */
export const UNKNOWN_QUOTA_RESET_MS = 60 * 60_000;
/** A 429 the driver gave up on: its window is minutes, not hours. */
export const UNKNOWN_RATE_RESET_MS = 15 * 60_000;
/** A reset further away than this is not believed (a misread date). */
const MAX_RESET_MS = 8 * 24 * 60 * 60_000;

const UNIT_MS: Array<[RegExp, number]> = [
  [/^(?:ms|milliseconds?)$/i, 1],
  [/^(?:s|secs?|seconds?)$/i, 1_000],
  [/^(?:m|mins?|minutes?)$/i, 60_000],
  [/^(?:h|hrs?|hours?)$/i, 3_600_000],
  [/^(?:d|days?)$/i, 86_400_000],
];

function unitMs(unit: string | undefined): number {
  if (!unit) return 1_000;
  return UNIT_MS.find(([pattern]) => pattern.test(unit))?.[1] ?? 0;
}

/** "2h 15m", "1 hour 5 minutes", "90 seconds", "30" (seconds). */
function durationMs(words: string): number | undefined {
  const parts = [...words.matchAll(/(\d+(?:\.\d+)?)\s*([a-z]+)?/gi)];
  if (!parts.length) return undefined;
  let total = 0;
  for (const [, amount, unit] of parts) {
    const ms = unitMs(unit);
    if (!ms) return undefined;
    total += Number(amount) * ms;
  }
  return total > 0 ? total : undefined;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function clockHours(hour: string, meridiem: string | undefined): number {
  const value = Number(hour);
  if (!meridiem) return value;
  return (value % 12) + (meridiem.toUpperCase() === "PM" ? 12 : 0);
}

/** Codex's "try again at 5:23 PM" (the next such time) or "try again at
 * Oct 17th, 2026 5:23 PM", in this computer's local time. */
function codexClock(said: string, now: number): number | undefined {
  const when = /\btry again at ([^.\n]+)/i.exec(said)?.[1]?.trim() ?? "";
  const time = /^(\d{1,2}):(\d{2})\s*([AP]M)?$/i.exec(when);
  if (time) {
    const at = new Date(now);
    at.setHours(clockHours(time[1]!, time[3]), Number(time[2]), 0, 0);
    if (at.getTime() <= now) at.setDate(at.getDate() + 1);
    return at.getTime();
  }
  const dated = /^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4}),?\s+(\d{1,2}):(\d{2})\s*([AP]M)?$/i.exec(when);
  const month = dated ? MONTHS.indexOf(dated[1]!.toLowerCase()) : -1;
  if (!dated || month < 0) return undefined;
  const at = new Date(Number(dated[3]), month, Number(dated[2]), clockHours(dated[4]!, dated[6]), Number(dated[5]), 0, 0).getTime();
  return Number.isFinite(at) ? at : undefined;
}

/** When the limit an engine's error names resets, in epoch ms; undefined
 * when its words name no time, or a time already past or implausibly far. */
export function limitResetFromText(text: string | undefined, now: number): number | undefined {
  if (!text) return undefined;
  const believable = (at: number | undefined) => at !== undefined && Number.isFinite(at) && at > now && at - now <= MAX_RESET_MS ? Math.round(at) : undefined;
  // Retry-After: 120 / "retry after 30 seconds" / "retry-after-ms: 1500"
  const after = /\bretry[- _]after(?:[- _](ms))?["']?\s*[:=]?\s*(\d+(?:\.\d+)?)\s*([a-z]+)?/i.exec(text);
  if (after) {
    const ms = after[1] ? Number(after[2]) : Number(after[2]) * (unitMs(after[3]) || 1_000);
    const at = believable(now + ms);
    if (at) return at;
  }
  // "try again in 2h 15m", "resets in 47 minutes", "available again in 3 hours"
  const relative = /\b(?:try again|retry|resets?|reset|available again|refreshes|renews)\s+in\s+(?:about\s+|approximately\s+|~)?((?:\d+(?:\.\d+)?\s*[a-z]+[\s,]*(?:and\s+)?){1,4})/i.exec(text);
  if (relative) {
    const at = believable(now + (durationMs(relative[1]!.replace(/\band\b|,/gi, " ")) ?? NaN));
    if (at) return at;
  }
  // An ISO time after a reset word: "resets at 2026-10-19T18:05:00Z"
  const iso = /\b(?:resets?|reset_at|resetAt|resets_at|try again|retry)[^0-9]{0,24}(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2}))/i.exec(text);
  if (iso) {
    const at = believable(Date.parse(iso[1]!));
    if (at) return at;
  }
  // An epoch after a reset key: "reset_at": 1760896800 (seconds or ms)
  const epoch = /\b(?:reset_at|resetAt|resets_at|resetsAt|x-ratelimit-reset)["']?\s*[:=]\s*(\d{10,13})\b/i.exec(text);
  if (epoch) {
    const value = Number(epoch[1]);
    const at = believable(epoch[1]!.length === 13 ? value : value * 1_000);
    if (at) return at;
  }
  return believable(codexClock(text, now));
}

/** The reset to wait for: the engine's own time, else a prudent estimate
 * (`estimated`). */
export function limitResetOrEstimate(kind: LimitKind, said: number | undefined, now: number): { resetsAt: number; estimated: boolean } {
  if (said !== undefined && said > now) return { resetsAt: said, estimated: false };
  return { resetsAt: now + (kind === "rate_limited" ? UNKNOWN_RATE_RESET_MS : UNKNOWN_QUOTA_RESET_MS), estimated: true };
}
