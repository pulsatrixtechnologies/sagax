// The recent sign-in an account deletion needs (2026-10-18).
//
// Perspicax erases a person from Sagax only with a sign-in token minted by an
// interactive sign-in of the last five minutes (its `403 reauth_required`,
// ERASE_REAUTH_MAX_AGE_SECS there); a token this server refreshed never
// counts. So DELETE /api/me never uses the session's own token
// (IdpSessionManager.subjectToken, which refreshes): it uses the access token
// of a fresh sign-in the person just made for this, kept here, in memory only,
// for that one deletion.
//
//   1. POST /api/me/reauth (the person's own session) opens a ticket: a
//      two-minute, single-use, random value bound to that session, its person
//      and their Perspicax subject. The answer is the address of
//      ACCOUNT_REAUTH_PATH with the ticket, which the client opens in a
//      browser (the web app itself, or the phone's authentication sheet).
//   2. GET ACCOUNT_REAUTH_PATH takes the ticket and starts an OpenID Connect
//      flow of purpose `reauth` (server/auth/oidc-rp.ts): `prompt=login`,
//      `max_age=0`, `login_hint` the person's subject, scope
//      `openid pulsabot:erase` (Perspicax dates only a sign-in with that
//      marker and warns on its page), the browser binding cookie as for a
//      sign-in.
//   3. The callback checks the same subject, the same live session, the
//      marker granted, an `auth_time` of the last five minutes, and keeps the access token here
//      (keep) until five minutes after that sign-in.
//   4. DELETE /api/me takes it (take: single use, that session and person
//      only). An unused one is dropped at expiry and its refresh token
//      revoked at Perspicax (its refresh token, else its access token), so
//      the extra sign-in leaves nothing live.
//
// Nothing here is written to disk or to a log; a token to revoke goes to
// the durable revocation queue (server/auth/idp-revocations.ts, sealed with the
// vault key).
import { randomBytes } from "node:crypto";

/** Where the browser starts the sign-in again (public, before the auth gate:
 * the ticket is its authorization). */
export const ACCOUNT_REAUTH_PATH = "/auth/oidc/reauth";
/** A ticket lives this long. */
export const ACCOUNT_REAUTH_TICKET_TTL_MS = 120_000;
/** How long a sign-in opens the deletion: Perspicax's ERASE_REAUTH_MAX_AGE_SECS. */
export const ACCOUNT_REAUTH_MAX_AGE_MS = 300_000;
/** A sign-in dated this far after this server's clock is still accepted
 * (clock skew); further is refused. */
export const ACCOUNT_REAUTH_SKEW_MS = 60_000;
const MAX_TICKETS = 1_000;
const MAX_FRESH = 1_000;

/** Where a reauth flow ends: the web app or the phone's sheet. */
export type AccountReauthClient = "web" | "phone";

/** Who asked for the sign-in again, checked at the callback. */
export interface AccountReauthExpectation {
  principalId: string;
  subject: { iss: string; sub: string };
  sessionId: string;
}

interface Ticket {
  expect: AccountReauthExpectation;
  client: AccountReauthClient;
  expiresAt: number;
}

interface Fresh {
  principalId: string;
  sub: string;
  accessToken: string;
  refreshToken?: string;
  validUntil: number;
}

/** Whether `authTimeSeconds` (an id_token's `auth_time`) is a sign-in of the
 * last ACCOUNT_REAUTH_MAX_AGE_MS at `nowMs`. */
export function recentSignIn(authTimeSeconds: number | undefined, nowMs: number): boolean {
  if (typeof authTimeSeconds !== "number" || !Number.isFinite(authTimeSeconds) || authTimeSeconds <= 0) return false;
  const at = authTimeSeconds * 1000;
  return at <= nowMs + ACCOUNT_REAUTH_SKEW_MS && nowMs - at <= ACCOUNT_REAUTH_MAX_AGE_MS;
}

/** The web app's landing after a reauth flow. */
export function webReauthReturn(outcome: { ok: true } | { error: string }): string {
  return "ok" in outcome ? "/#account-reauth=ok" : `/#account-reauth-error=${encodeURIComponent(outcome.error)}`;
}

/** The phone's: its authentication sheet listens on sagax:// only. */
export function phoneReauthReturn(publicOrigin: string, outcome: { ok: true } | { error: string }): string {
  const tail = "ok" in outcome ? "status=ok" : `error=${encodeURIComponent(outcome.error)}`;
  return `sagax://account-reauth?address=${encodeURIComponent(publicOrigin)}&${tail}`;
}

export class AccountReauth {
  private readonly tickets = new Map<string, Ticket>();
  /** sessionId -> the fresh sign-in kept for it. */
  private readonly fresh = new Map<string, Fresh>();
  private readonly now: () => number;
  private readonly revoke: (token: string, hint: "refresh_token" | "access_token", why: string) => void;

  constructor(options: { now?: () => number; revoke?: (token: string, hint: "refresh_token" | "access_token", why: string) => void } = {}) {
    this.now = options.now ?? Date.now;
    this.revoke = options.revoke ?? (() => {});
  }

  /** A ticket for `expect`'s session (single use, ACCOUNT_REAUTH_TICKET_TTL_MS). */
  openTicket(expect: AccountReauthExpectation, client: AccountReauthClient): { ticket: string; expiresAt: number } {
    this.prune();
    while (this.tickets.size >= MAX_TICKETS) {
      const oldest = this.tickets.keys().next().value;
      if (oldest === undefined) break;
      this.tickets.delete(oldest);
    }
    // One live ticket per session: a new one replaces it, so a session
    // looping on POST /api/me/reauth never pushes out other people's.
    for (const [old, entry] of this.tickets) if (entry.expect.sessionId === expect.sessionId) this.tickets.delete(old);
    const ticket = randomBytes(32).toString("base64url");
    const expiresAt = this.now() + ACCOUNT_REAUTH_TICKET_TTL_MS;
    this.tickets.set(ticket, { expect: { principalId: expect.principalId, subject: { ...expect.subject }, sessionId: expect.sessionId }, client, expiresAt });
    return { ticket, expiresAt };
  }

  /** The ticket's flow, once; null when unknown, used or expired. */
  takeTicket(ticket: string | null | undefined): { expect: AccountReauthExpectation; client: AccountReauthClient } | null {
    this.prune();
    if (typeof ticket !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(ticket)) return null;
    const found = this.tickets.get(ticket);
    if (!found) return null;
    this.tickets.delete(ticket);
    if (found.expiresAt <= this.now()) return null;
    return { expect: found.expect, client: found.client };
  }

  /** Keep a fresh sign-in's access token for its session, until
   * ACCOUNT_REAUTH_MAX_AGE_MS after `authTimeSeconds`. Refuses (false) a
   * sign-in that is not recent. Replaces (and revokes) an earlier one. */
  keep(input: { expect: AccountReauthExpectation; accessToken: string; refreshToken?: string; authTimeSeconds: number | undefined }): boolean {
    this.prune();
    if (!input.accessToken || !recentSignIn(input.authTimeSeconds, this.now())) return false;
    this.drop(input.expect.sessionId, "a newer sign-in for the account deletion");
    while (this.fresh.size >= MAX_FRESH) {
      const oldest = this.fresh.keys().next().value;
      if (oldest === undefined) break;
      this.drop(oldest, "too many sign-ins kept for account deletion");
    }
    const validUntil = Math.min(input.authTimeSeconds! * 1000, this.now()) + ACCOUNT_REAUTH_MAX_AGE_MS;
    this.fresh.set(input.expect.sessionId, {
      principalId: input.expect.principalId,
      sub: input.expect.subject.sub,
      accessToken: input.accessToken,
      ...(input.refreshToken ? { refreshToken: input.refreshToken } : {}),
      validUntil,
    });
    return true;
  }

  /** The fresh sign-in kept for this session and person, once. Its refresh
   * token comes with it: the caller revokes it unless Perspicax erased the
   * account (which ends every token of the person). */
  take(sessionId: string, principalId: string): { accessToken: string; sub: string; refreshToken?: string } | null {
    this.prune();
    const found = this.fresh.get(sessionId);
    if (!found) return null;
    if (found.principalId !== principalId) return null;
    this.fresh.delete(sessionId);
    return { accessToken: found.accessToken, sub: found.sub, ...(found.refreshToken ? { refreshToken: found.refreshToken } : {}) };
  }

  /** Whether a fresh sign-in waits for this session (for tests and the UI). */
  has(sessionId: string): boolean {
    this.prune();
    return this.fresh.has(sessionId);
  }

  /** Forget what a session holds (its end, or a person's erasure). */
  forgetSession(sessionId: string): void {
    this.drop(sessionId, "the session ended");
    for (const [ticket, entry] of this.tickets) if (entry.expect.sessionId === sessionId) this.tickets.delete(ticket);
  }

  private drop(sessionId: string, why: string): void {
    const found = this.fresh.get(sessionId);
    if (!found) return;
    this.fresh.delete(sessionId);
    revokeFresh(this.revoke, found, why);
  }

  /** Drop what expired (and revoke it at Perspicax); index.ts runs it every minute. */
  sweep(): void {
    this.prune();
  }

  private prune(): void {
    const at = this.now();
    for (const [ticket, entry] of this.tickets) if (entry.expiresAt <= at) this.tickets.delete(ticket);
    for (const [sessionId, entry] of this.fresh) if (entry.validUntil <= at) this.drop(sessionId, "an unused sign-in for account deletion expired");
  }
}

/** End an unused or refused sign-in again at Perspicax: its refresh token
 * when it has one (which ends its access token too), else the access token
 * itself (review MR-3: the reauth scope asks no offline_access). */
function revokeFresh(revoke: (token: string, hint: "refresh_token" | "access_token", why: string) => void, fresh: { accessToken: string; refreshToken?: string }, why: string): void {
  if (fresh.refreshToken) revoke(fresh.refreshToken, "refresh_token", why);
  else revoke(fresh.accessToken, "access_token", why);
}

/** What DELETE /api/me needs to erase at Perspicax (server/index.ts wires it). */
export interface PerspicaxDeletionWiring {
  /** The person's Perspicax subject when this server signs in with that issuer, else null. */
  subjectOf: (principalId: string) => { id: string; sub: string } | null;
  reauth: AccountReauth | null;
  /** PerspicaxDirectory.eraseOwnAccount. */
  erase: (accessToken: string) => Promise<{ ok: true; sub: string } | { ok: false; error: string; status?: number }>;
  revoke: (token: string, hint: "refresh_token" | "access_token", why: string) => void;
  log?: (line: string) => void;
}

/** The deletion at Perspicax with the sign-in made again for it, never the
 * session's own (refreshed) token. A refused erasure revokes that sign-in's
 * grant; an answer about another subject deletes nothing here. */
export function perspicaxDeletion(wiring: PerspicaxDeletionWiring) {
  return async (principalId: string, sessionId: string): Promise<{ ok: true } | { ok: false; error: string; status?: number }> => {
    const person = wiring.subjectOf(principalId);
    if (!person) return { ok: false, error: "link" };
    const fresh = wiring.reauth?.take(sessionId, person.id) ?? null;
    if (!fresh) return { ok: false, error: "reauth_required" };
    if (fresh.sub !== person.sub) {
      revokeFresh(wiring.revoke, fresh, "a sign-in again for another subject");
      return { ok: false, error: "reauth_required" };
    }
    const erased = await wiring.erase(fresh.accessToken);
    if (!erased.ok) {
      // Not erased: the extra sign-in's grant goes (one sign-in, one try).
      revokeFresh(wiring.revoke, fresh, "a sign-in again whose account deletion was refused");
      wiring.log?.(`account deletion: Perspicax refused (${erased.error}${erased.status ? ` ${erased.status}` : ""})`);
      return { ok: false, error: erased.error, ...(erased.status ? { status: erased.status } : {}) };
    }
    if (erased.sub !== person.sub) {
      // Never delete this person's data on an answer about someone else:
      // the account purged push names the right subject.
      wiring.log?.("account deletion: Perspicax erased an account under another subject than this person's");
      return { ok: false, error: "unreachable" };
    }
    return { ok: true };
  };
}
