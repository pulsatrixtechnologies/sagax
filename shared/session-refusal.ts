// Why a server refused a session credential (2026-10-20, JC: "a person is
// signed out only when their session is revoked, their account disabled, or
// after a long real inactivity"). The server puts one of these in the `code`
// of every 401 it answers for a presented credential; clients sign out only
// on a definitive one and retry the rest silently (a deploy, a restart, a
// provider that is down for a minute).

/** The session is gone for good: show the sign-in screen. */
export const DEFINITIVE_SESSION_CODES = [
  "session_revoked",
  "session_expired",
  "idp_session_ended",
  "principal_disabled",
  "session_cookie_only",
  // no credential at all where one is needed: nothing to retry
  "sign_in_required",
] as const;

/** The session may come back (a server restarted from an older copy, a
 * request that raced a deploy): retry, and sign out only if it persists. */
export const RETRYABLE_SESSION_CODES = ["session_unknown", "stream_ticket_invalid"] as const;

export type SessionRefusal = typeof DEFINITIVE_SESSION_CODES[number] | typeof RETRYABLE_SESSION_CODES[number];

export function isDefinitiveSessionRefusal(code: unknown): boolean {
  return typeof code === "string" && (DEFINITIVE_SESSION_CODES as readonly string[]).includes(code);
}

/** How many `session_unknown` answers in a row (or 401 without a code, from
 * an older server) a client takes before it shows the sign-in screen. */
export const UNKNOWN_SESSION_RETRIES = 3;

/** Delay before the attempt numbered `attempt` (1 for the first retry):
 * doubling from `baseMs`, capped at `maxMs`, with up to 20% jitter so a
 * fleet of clients does not come back in step after a deploy. */
export function sessionRetryDelay(attempt: number, options: { baseMs?: number; maxMs?: number; random?: () => number } = {}): number {
  const base = options.baseMs ?? 1_000;
  const max = options.maxMs ?? 60_000;
  const raw = Math.min(max, base * 2 ** Math.max(0, attempt - 1));
  const jitter = 1 + 0.2 * ((options.random ?? Math.random)() - 0.5) * 2;
  return Math.max(0, Math.min(max, Math.round(raw * jitter)));
}
