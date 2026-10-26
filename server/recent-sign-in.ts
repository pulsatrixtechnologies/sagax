// "A sign-in younger than 15 minutes" (2026-10-18). Some actions accept a
// recent sign-in in place of a security key: the first key, and exporting
// the credential vault in clear for a person without a key. Recent means
// the person proved themselves interactively a short while ago, never that
// a session is new: a bot that can create a pairing code (manage_pairing,
// or act on POST /api/auth/pairing) can redeem it into a brand new session
// in a second. So the clock is the session's `authAt`
// (server/sessions.ts), which only "Sign in with Pulsatrix" stamps
// (OpenID Connect, in the browser or handed to the desktop or a phone), and
// only from the id_token's verified `auth_time` when that moment is itself
// recent (authAtFromAuthTime): a silent single sign-on at the provider never
// counts, and "Sign in again" asks Perspicax for `prompt=login` and
// `max_age=0` (server/oidc-rp.ts, 2026-10-19). An email code is a valid
// sign-in but never a recent one: a bot that reads the person's mailbox can
// type it. A pairing code, an invite link, a renewal, a bot-act copy and an
// act-as session stamp nothing.
import type { RequestAuth } from "./request-auth.ts";
import type { SessionRecord } from "./sessions.ts";

export const RECENT_SIGN_IN_MS = 15 * 60_000;
/** An `auth_time` this far after this server's clock is still accepted
 * (clock skew, dated now); further is a forged or broken value. */
export const AUTH_TIME_SKEW_MS = 60_000;

/** The `authAt` a "Sign in with Pulsatrix" stamps: the id_token's verified
 * `auth_time` (seconds) when it is a sign-in of the last RECENT_SIGN_IN_MS,
 * never later than now; undefined otherwise (absent, invalid, older than the
 * window, or further in the future than the skew), so the session is valid
 * but not recent. */
export function authAtFromAuthTime(authTimeSeconds: number | undefined, nowMs: number): number | undefined {
  if (typeof authTimeSeconds !== "number" || !Number.isFinite(authTimeSeconds) || authTimeSeconds <= 0) return undefined;
  const at = authTimeSeconds * 1000;
  if (at > nowMs + AUTH_TIME_SKEW_MS || nowMs - at > RECENT_SIGN_IN_MS) return undefined;
  return Math.min(at, nowMs);
}

/** Whether this session carries an interactive sign-in of its person made
 * within the window. A bot-act or act-as copy never does. */
export function recentInteractiveSignIn(session: Pick<SessionRecord, "authAt" | "ephemeral">, now = Date.now()): boolean {
  if (session.ephemeral) return false;
  const at = session.authAt;
  return typeof at === "number" && Number.isFinite(at) && at <= now && now - at <= RECENT_SIGN_IN_MS;
}

/** The person is present right now: a session with a recent interactive
 * sign-in, or the desktop app's own person (its loopback, owner trust).
 * A headless server's loopback never counts: a bot's shell is a loopback
 * caller there. */
export function recentPersonSignIn(auth: RequestAuth, options: { desktopManaged: boolean; now?: number }): boolean {
  if (auth.kind === "loopback") return options.desktopManaged && auth.trust !== "service";
  return recentInteractiveSignIn(auth.session, options.now ?? Date.now());
}
