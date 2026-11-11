// An engine account refusing work in its own words: its usage limit, or its
// credit. One copy for the server (server/drivers/retry.ts,
// server/routines/routine-recovery.ts) and the chat, which writes no card
// for either (the maintainer, 2026-11-04; #3552: the conversation's one limit line says it).

/** A usage limit (a plan window, a weekly or 5-hour limit). */
export const USAGE_LIMIT = /\busage limits?\b|\breached (?:your|its) (?:(?:weekly|daily|monthly|session|5-hour|plan|subscription) )?limits?\b|\bhit your (?:(?!rate\b)[\w'’-]+ ){0,3}(?:limit|budget)\b|\b(?:weekly|daily|monthly|subscription|usage|session|5-hour) limit reached\b|\bout of (?:usage(?: credits)?|extra usage|credits)\b/i;

/** A provider refusing for want of credit or payment. */
export const OUT_OF_CREDITS = /\bpayment required\b|\b(?:http|status) 402\b|\binsufficient (?:account )?(?:funds|balance|credits?)\b|\b(?:credit|account) balance is too low\b|\busage balance (?:is |has been )?(?:used up|exhausted)\b|\bout of credits?\b|\bno credits? (?:left|remaining)\b|\bused all (?:available |of (?:your|its) )?credits\b/i;

/** Whether a failed turn's cause is the engine account's limit or credit. */
export function isEngineLimitWords(cause: string): boolean {
  return USAGE_LIMIT.test(cause) || OUT_OF_CREDITS.test(cause);
}
