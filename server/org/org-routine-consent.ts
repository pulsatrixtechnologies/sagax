// Routine delegations (slice 6, spec sections 4 "Délégation pour les
// routines", 4 bis and 11): the routines that run as a person act in their
// name while they are away. Since 2026-10-08 this is not a choice: the
// delegation is issued automatically from the person's live sign-in (at
// sign-in, while they keep using Sagax, and at a run that finds none), with
// no consent step and no switch, and a routine is never paused for lack of
// it while the account is active. The permission is an ordinary
// `pulsa-bot` grant whose scope carries `pulsabot:routines`; Perspicax keeps
// it 30 days, sliding, and each run renews it with one refresh. It lives in
// the same sealed vault as the sign-in grants (`kind: "routines"`, one per
// principal, never bound to a session) and IdpSessionManager never touches
// it: this class owns it.
//
//   - `prepare` is the admission of a run: a refresh at most every
//     ROUTINE_CONSENT_RENEW_MS, one flight per principal; within the window
//     a cached access token with at least 10 minutes left is reused;
//   - `ensure` issues it from the person's sign-in access token
//     (RoutineConsentsOptions.issue, an RFC 8693 exchange through the link),
//     one flight per principal, retried after a minute on a failure;
//   - a refused renewal (`invalid_grant`) drops the grant and the next run
//     issues a new one; only a person Perspicax put out (back-channel
//     logout, a disable, a role that no longer signs in) pauses their
//     routines (`onEnded` with `person_out`); a transient failure only skips
//     the run;
//   - no token ever reaches a log line, an error or the wire.
import { randomUUID } from "node:crypto";

import {
  IDP_REFRESH_WAIT_MS,
  IDP_SUBJECT_MIN_LIFE_MS,
  isSessionGrant,
  perspicaxRoleOf,
  refreshAskingAgain,
  settledWithin,
  type IdpGrant,
  type IdpGrantVault,
  type IdpPrincipalStore,
  type IdpRelyingParty,
  type SubjectTokenOutcome,
} from "../auth/idp-session.ts";
import { immediateRevocations, type RevocationSink } from "../auth/idp-revocations.ts";
import { orgRoleForRole } from "../auth/oidc-login.ts";
import type { OidcIdentity } from "../auth/oidc-rp.ts";

/** A run renews the delegation at most this often (D6). */
export const ROUTINE_CONSENT_RENEW_MS = 600_000;

/** SAGAX_ROUTINE_RENEW_SECONDS (tests): a whole number from 1 to 600, else
 * the default. A shorter window only renews more often. */
export function routineRenewMs(value: string | undefined): number {
  const seconds = Number(value);
  const ok = value !== undefined && value.trim() !== "" && Number.isInteger(seconds) && seconds >= 1 && seconds <= ROUTINE_CONSENT_RENEW_MS / 1000;
  return ok ? seconds * 1000 : ROUTINE_CONSENT_RENEW_MS;
}
/** Perspicax keeps a delegation this long after its last renewal. */
export const ROUTINE_CONSENT_LIFE_MS = 30 * 86_400_000;
/** The directory may end a delegation only if it was created this long
 * before the fetch started (a consent racing a poll is not undone). */
export const ROUTINE_CONSENT_RECONCILE_SLACK_MS = 5_000;

/** Why a delegation ended. Only `person_out` pauses the person's routines;
 * `delegation_ended` is issued again at the next run or sign-in. */
export type RoutineConsentEnd = "delegation_ended" | "person_out";

/** While the person uses Sagax, a session renewal also slides their
 * delegation when it was last renewed this long ago. */
export const ROUTINE_DELEGATION_KEEPALIVE_MS = 86_400_000;
/** A failed issue is not tried again for this long (per person). */
export const ROUTINE_DELEGATION_ISSUE_RETRY_MS = 60_000;
/** A Perspicax that cannot issue one is asked again after this long. */
export const ROUTINE_DELEGATION_UNSUPPORTED_RETRY_MS = 600_000;

/** What issuing a delegation from a sign-in access token answered
 * (server/perspicax/perspicax-link.ts issueRoutineDelegation). */
export type RoutineDelegationIssue =
  | { ok: true; refreshToken: string; accessToken?: string; accessExpiresAt?: number }
  | { ok: false; error: "unsupported" | "subject" | "link" | "rate_limited" | "unreachable"; retryAfterMs?: number };

export type RoutineDelegationEnsure = "active" | "granted" | "unavailable";

export type RoutineConsentStatus =
  | { state: "active"; consentedAt: number; renewedAt: number; expiresAt: number }
  | { state: "none" };

export type RoutineConsentPrepare =
  | { ok: true }
  /** `interrupted` (#3661, said once): the provider ended the delegation
   * after a refresh whose answer was lost, and it could not be issued again. */
  | { ok: false; error: "missing" | "ended" | "unreachable"; interrupted?: true }
  /** Perspicax is rate limiting this server: the run is retried later. */
  | { ok: false; error: "rate_limited"; retryAfterMs: number };

/** A rate-limited renewal is not tried again for at least this long. */
export const ROUTINE_CONSENT_RATE_LIMIT_MIN_MS = 60_000;

export interface RoutineConsentsOptions {
  vault: IdpGrantVault;
  rp: IdpRelyingParty;
  principals: Pick<IdpPrincipalStore, "forSubject" | "bySubject">;
  now?: () => number;
  /** How long a renewal is reused (ROUTINE_CONSENT_RENEW_MS). */
  renewMs?: number;
  log?: (line: string) => void;
  /** The person's routines stop (suspendFor, forget MCP entries, audit). */
  onEnded?: (principalId: string, reason: RoutineConsentEnd) => void;
  /** The person's delegation is live again: their suspended routines resume. */
  onActive?: (principalId: string) => void;
  /** Issues a delegation from a sign-in access token (the link's RFC 8693
   * exchange). Absent: none is ever issued here. */
  issue?: (subjectToken: string) => Promise<RoutineDelegationIssue>;
  /** The person's live sign-in access token (IdpSessionManager.subjectToken). */
  sessionSubject?: (principalId: string) => Promise<SubjectTokenOutcome>;
  /** The person's Perspicax subject, null when they have none. */
  subjectOf?: (principalId: string) => { iss: string; sub: string } | null;
  /** Where provider revocations go (the durable queue, idp-revocations.ts). */
  revocations?: RevocationSink;
  /** Waits `delayMs` inside a refresh (a lost answer asked again). Tests
   * pass an immediate one. */
  sleep?: (delayMs: number) => Promise<void>;
}

/** `out`: the person no longer signs in (their role); `ended`: Perspicax
 * ended that family only. */
type RefreshResult = "ok" | "ended" | "out" | "unreachable" | "rate_limited";

export class RoutineConsents {
  private readonly vault: IdpGrantVault;
  private readonly rp: IdpRelyingParty;
  private readonly principals: RoutineConsentsOptions["principals"];
  private readonly now: () => number;
  private readonly renewMs: number;
  private readonly log: (line: string) => void;
  private readonly onEnded: (principalId: string, reason: RoutineConsentEnd) => void;
  private readonly onActive: (principalId: string) => void;
  /** principalId -> the latest access token (memory only). */
  private readonly access = new Map<string, { token: string; expiresAt: number }>();
  /** principalId -> the refresh in flight. */
  private readonly inflight = new Map<string, Promise<RefreshResult>>();
  /** Principals whose reuse window was dropped (an exchange refused the
   * cached subject): the next prepare refreshes at once. */
  private readonly stale = new Set<string>();
  /** principalId -> no renewal before this time (Perspicax rate limited it). */
  private readonly retryAt = new Map<string, number>();
  private readonly revocations: RevocationSink;
  private readonly issue?: RoutineConsentsOptions["issue"];
  private readonly sessionSubject?: RoutineConsentsOptions["sessionSubject"];
  private readonly subjectOf?: RoutineConsentsOptions["subjectOf"];
  /** principalId -> the issue in flight. */
  private readonly issuing = new Map<string, Promise<RoutineDelegationEnsure>>();
  /** principalId -> no new issue before this time. */
  private readonly issueRetryAt = new Map<string, number>();
  private readonly sleep: (delayMs: number) => Promise<void>;
  /** #3661: principals whose delegation the provider ended after a refresh
   * whose answer was lost, not told yet (prepare says it once). */
  private readonly interrupted = new Set<string>();

  constructor(options: RoutineConsentsOptions) {
    this.vault = options.vault;
    this.rp = options.rp;
    this.principals = options.principals;
    this.now = options.now ?? Date.now;
    this.renewMs = options.renewMs ?? ROUTINE_CONSENT_RENEW_MS;
    this.log = options.log ?? ((line) => console.warn(line));
    this.onEnded = options.onEnded ?? (() => {});
    this.onActive = options.onActive ?? (() => {});
    this.revocations = options.revocations ?? immediateRevocations((token, hint) => this.rp.revokeToken(token, hint), this.log, "routine delegation");
    this.issue = options.issue;
    this.sessionSubject = options.sessionSubject;
    this.subjectOf = options.subjectOf;
    this.sleep = options.sleep ?? ((delayMs) => new Promise((resolve) => { setTimeout(resolve, delayMs).unref(); }));
  }

  /** Make sure the person holds a delegation: issue one from `given` (a
   * fresh sign-in access token) or their live session when they hold none.
   * One flight per person; a failure waits a minute (ten when Perspicax
   * cannot issue one) before the next try. Never throws. */
  async ensure(principalId: string, given?: { token: string; expiresAt?: number }): Promise<RoutineDelegationEnsure> {
    const grant = this.safeGrantOf(principalId);
    if (grant === null) return "unavailable";
    if (grant) return "active";
    let flight = this.issuing.get(principalId);
    if (!flight) {
      const until = this.issueRetryAt.get(principalId);
      if (until !== undefined && this.now() < until) return "unavailable";
      flight = this.issueFor(principalId, given).catch((error: unknown) => {
        this.log(`routine delegation: issue failed unexpectedly: ${error instanceof Error ? error.message : String(error)}`);
        return "unavailable" as const;
      }).finally(() => this.issuing.delete(principalId));
      this.issuing.set(principalId, flight);
    }
    return flight;
  }

  /** The person keeps using Sagax (a sign-in, a session renewal): issue the
   * delegation when they hold none, else slide it once a day. Never throws. */
  async keepAlive(principalId: string, given?: { token: string; expiresAt?: number }): Promise<void> {
    const grant = this.safeGrantOf(principalId);
    if (grant === null) return;
    if (!grant) {
      await this.ensure(principalId, given);
      return;
    }
    if (this.now() - grant.lastOkAt < ROUTINE_DELEGATION_KEEPALIVE_MS) return;
    if (this.rateLimitedFor(principalId)) return;
    await this.refreshWithin(principalId, grant);
  }

  private async issueFor(principalId: string, given?: { token: string; expiresAt?: number }): Promise<RoutineDelegationEnsure> {
    const subject = this.subjectOf?.(principalId) ?? null;
    const issue = this.issue;
    if (!issue || !subject) return "unavailable";
    let outcome: RoutineDelegationIssue | null = given?.token ? await issue(given.token) : null;
    if (!outcome || (!outcome.ok && outcome.error === "subject")) {
      const live = this.sessionSubject ? await this.sessionSubject(principalId) : null;
      if (live?.ok) outcome = await issue(live.token);
      else if (!outcome) {
        // Nobody is signed in to issue it from: tried again later.
        this.issueRetryAt.set(principalId, this.now() + ROUTINE_DELEGATION_ISSUE_RETRY_MS);
        return "unavailable";
      }
    }
    if (outcome.ok) {
      try {
        this.create({ principalId, iss: subject.iss, sub: subject.sub, refreshToken: outcome.refreshToken,
          ...(outcome.accessToken && outcome.accessExpiresAt !== undefined ? { accessToken: outcome.accessToken, accessExpiresAt: outcome.accessExpiresAt } : {}) });
      } catch (error) {
        this.revokeAtProvider(outcome.refreshToken, "unkept");
        this.log(`routine delegation: could not keep an issued grant: ${error instanceof Error ? error.message : String(error)}`);
        this.issueRetryAt.set(principalId, this.now() + ROUTINE_DELEGATION_ISSUE_RETRY_MS);
        return "unavailable";
      }
      return "granted";
    }
    const wait = outcome.error === "unsupported"
      ? ROUTINE_DELEGATION_UNSUPPORTED_RETRY_MS
      : Math.max(ROUTINE_DELEGATION_ISSUE_RETRY_MS, outcome.retryAfterMs ?? 0);
    this.issueRetryAt.set(principalId, this.now() + wait);
    this.log(`routine delegation: not issued (${outcome.error}); tried again later`);
    return "unavailable";
  }

  /** How long the rate limit window of this person still lasts (0: none). */
  private rateLimitedFor(principalId: string): number {
    const until = this.retryAt.get(principalId);
    if (until === undefined) return 0;
    const left = until - this.now();
    if (left <= 0) {
      this.retryAt.delete(principalId);
      return 0;
    }
    return left;
  }

  /** Null when delegations can be kept. */
  unavailableReason(): string | null {
    return this.vault.unavailableReason();
  }

  private grantOf(principalId: string): IdpGrant | undefined {
    return this.vault.list().find((grant) => !isSessionGrant(grant) && grant.principalId === principalId);
  }

  private safeGrantOf(principalId: string): IdpGrant | undefined | null {
    try {
      return this.grantOf(principalId);
    } catch {
      return null;
    }
  }

  status(principalId: string): RoutineConsentStatus {
    const grant = this.safeGrantOf(principalId);
    if (!grant) return { state: "none" };
    return { state: "active", consentedAt: grant.createdAt, renewedAt: grant.lastOkAt, expiresAt: grant.lastOkAt + ROUTINE_CONSENT_LIFE_MS };
  }

  /** The principals holding a delegation now. */
  principalsWithConsent(): string[] {
    try {
      return this.vault.list().filter((grant) => !isSessionGrant(grant) && grant.principalId).map((grant) => grant.principalId!);
    } catch {
      return [];
    }
  }

  /** Keep a fresh consent; the previous one of that person is revoked at
   * the provider and dropped. Throws when the vault is unavailable. */
  create(input: { principalId: string; iss: string; sub: string; refreshToken: string; accessToken?: string; accessExpiresAt?: number }): void {
    const previous = this.grantOf(input.principalId);
    const now = this.now();
    this.vault.set({
      grantRef: randomUUID(), iss: input.iss, sub: input.sub, refreshToken: input.refreshToken,
      createdAt: now, refreshedAt: now, lastOkAt: now, kind: "routines", principalId: input.principalId,
    });
    if (previous) {
      this.safeDelete(previous.grantRef);
      this.revokeAtProvider(previous.refreshToken, "replaced");
    }
    this.stale.delete(input.principalId);
    this.issueRetryAt.delete(input.principalId);
    this.interrupted.delete(input.principalId);
    if (input.accessToken && input.accessExpiresAt !== undefined) this.access.set(input.principalId, { token: input.accessToken, expiresAt: input.accessExpiresAt });
    else this.access.delete(input.principalId);
    this.onActive(input.principalId);
  }

  /** The admission of a run: issues the delegation when the person holds
   * none, renews it when due. Never throws. */
  async prepare(principalId: string): Promise<RoutineConsentPrepare> {
    const grant = this.safeGrantOf(principalId);
    if (grant === null) return { ok: false, error: "unreachable" };
    if (!grant) return await this.ensure(principalId) === "unavailable" ? this.endedOnce(principalId, "missing") : { ok: true };
    if (!this.stale.has(principalId) && grant.answerLostAt === undefined && this.now() - grant.refreshedAt < this.renewMs && this.usable(principalId)) return { ok: true };
    const waiting = this.rateLimitedFor(principalId);
    if (waiting) return { ok: false, error: "rate_limited", retryAfterMs: waiting };
    const result = await this.refreshWithin(principalId, grant);
    if (result === "ok") return { ok: true };
    if (result === "rate_limited") return { ok: false, error: "rate_limited", retryAfterMs: this.rateLimitedFor(principalId) || ROUTINE_CONSENT_RATE_LIMIT_MIN_MS };
    if (result === "ended") {
      // Perspicax ended that family: a new one is issued at once while the
      // person is still in (a person put out never reaches this point).
      if (this.safeGrantOf(principalId) === undefined && await this.ensure(principalId) !== "unavailable") return { ok: true };
      return this.endedOnce(principalId, "ended");
    }
    if (result === "out") return { ok: false, error: "ended" };
    return { ok: false, error: "unreachable" };
  }

  /** A delegation that could not be issued again; `interrupted` the first
   * time after the provider ended it following a lost answer (#3661). */
  private endedOnce(principalId: string, error: "missing" | "ended"): RoutineConsentPrepare {
    return this.interrupted.delete(principalId) ? { ok: false, error, interrupted: true } : { ok: false, error };
  }

  /** Boot (#3661): a delegation whose last refresh got no answer is
   * refreshed again now, before a run or anything else presents its old
   * token, while the provider still answers a retry. Returns how many. */
  resumeInterrupted(): number {
    let grants: IdpGrant[];
    try {
      grants = this.vault.list().filter((grant) => !isSessionGrant(grant) && grant.principalId && grant.answerLostAt !== undefined);
    } catch {
      return 0;
    }
    for (const grant of grants) void this.flightFor(grant.principalId!, grant.grantRef);
    if (grants.length) this.log(`routine delegation: asking again for ${grants.length} renewal(s) whose answer a stop lost`);
    return grants.length;
  }

  /** The delegation's access token, the subject of a token exchange for the
   * routine's Perspicax tools (slice 5 shape). */
  async subjectToken(principalId: string): Promise<SubjectTokenOutcome> {
    let grant = this.safeGrantOf(principalId);
    if (grant === null) return { ok: false, error: "unreachable" };
    if (!grant && await this.ensure(principalId) !== "unavailable") grant = this.safeGrantOf(principalId);
    if (!grant) return { ok: false, error: "no_session" };
    const cached = this.stale.has(principalId) ? undefined : this.usable(principalId);
    if (cached) return { ok: true, token: cached.token, expiresAt: cached.expiresAt };
    const waiting = this.rateLimitedFor(principalId);
    if (waiting) return { ok: false, error: "rate_limited", retryAfterMs: waiting };
    const result = await this.refreshWithin(principalId, grant);
    if (result === "ended" || result === "out") return { ok: false, error: "ended" };
    if (result === "rate_limited") return { ok: false, error: "rate_limited", retryAfterMs: this.rateLimitedFor(principalId) || ROUTINE_CONSENT_RATE_LIMIT_MIN_MS };
    const renewed = this.usable(principalId);
    if (result === "ok" && renewed) return { ok: true, token: renewed.token, expiresAt: renewed.expiresAt };
    return { ok: false, error: "unreachable" };
  }

  /** Forget the cached access token and the reuse window: the next prepare
   * or subjectToken refreshes (an exchange refused the cached subject). */
  dropCache(principalId: string): void {
    this.access.delete(principalId);
    this.stale.add(principalId);
  }

  /** Perspicax put the person out (back-channel logout, a directory disable):
   * the provider already ended the family, no call. */
  endForSubject(iss: string, sub: string): number {
    let grants: IdpGrant[];
    try {
      grants = this.vault.list().filter((grant) => !isSessionGrant(grant) && grant.iss === iss && grant.sub === sub);
    } catch {
      return 0;
    }
    for (const grant of grants) {
      this.safeDelete(grant.grantRef);
      if (grant.principalId) {
        this.forget(grant.principalId);
        this.onEnded(grant.principalId, "person_out");
      }
    }
    return grants.length;
  }

  /** The directory reported each person's delegation: `false` (null in the
   * directory) ends ours, if it is older than the fetch; `undefined` (an
   * older Perspicax without the field) never ends anything. */
  reconcile(present: (sub: string) => boolean | undefined, fetchStartedAt: number): number {
    let grants: IdpGrant[];
    try {
      grants = this.vault.list().filter((grant) => !isSessionGrant(grant));
    } catch {
      return 0;
    }
    let ended = 0;
    for (const grant of grants) {
      if (present(grant.sub) !== false) continue;
      if (grant.createdAt >= fetchStartedAt - ROUTINE_CONSENT_RECONCILE_SLACK_MS) continue;
      if (this.inflight.has(grant.principalId ?? "")) continue;
      this.safeDelete(grant.grantRef);
      if (grant.principalId) {
        this.forget(grant.principalId);
        this.onEnded(grant.principalId, "delegation_ended");
      }
      ended += 1;
    }
    return ended;
  }

  /** For tests: the refresh in flight. */
  settled(principalId?: string): Promise<void> {
    const flights = principalId ? [this.inflight.get(principalId)].filter(Boolean) : [...this.inflight.values()];
    return Promise.all(flights).then(() => {});
  }

  private usable(principalId: string): { token: string; expiresAt: number } | undefined {
    const cached = this.access.get(principalId);
    return cached && cached.expiresAt - this.now() >= IDP_SUBJECT_MIN_LIFE_MS ? cached : undefined;
  }

  private forget(principalId: string): void {
    this.access.delete(principalId);
    this.stale.delete(principalId);
    this.retryAt.delete(principalId);
  }

  /** The one refresh in flight for a principal: a second caller joins it. */
  private flightFor(principalId: string, ref: string): Promise<RefreshResult> {
    let flight = this.inflight.get(principalId);
    if (!flight) {
      flight = this.refresh(principalId, ref).catch((error: unknown) => {
        this.log(`routine delegation: refresh failed unexpectedly: ${error instanceof Error ? error.message : String(error)}`);
        return "unreachable" as const;
      }).finally(() => this.inflight.delete(principalId));
      this.inflight.set(principalId, flight);
    }
    return flight;
  }

  /** Join or start the single flight, waiting at most IDP_REFRESH_WAIT_MS. */
  private async refreshWithin(principalId: string, grant: IdpGrant): Promise<RefreshResult> {
    const flight = this.flightFor(principalId, grant.grantRef);
    let result: RefreshResult = "unreachable";
    await settledWithin(flight.then((value) => { result = value; }), IDP_REFRESH_WAIT_MS);
    return result;
  }

  private async refresh(principalId: string, ref: string): Promise<RefreshResult> {
    const grant = this.vault.get(ref);
    if (!grant) return "ended";
    // #3661: an answer lost on the way is asked again at once, inside this
    // flight; the grant keeps the mark so a restart asks again first.
    const { outcome, answerLost: lostNow } = await refreshAskingAgain(this.rp, grant.refreshToken, { sub: grant.sub }, this.sleep, () => {
      try {
        const latest = this.vault.get(ref);
        if (latest) this.vault.set({ ...latest, answerLostAt: this.now() });
      } catch {
        /* asked again in this flight all the same */
      }
    });
    const answerLost = lostNow || grant.answerLostAt !== undefined;
    let current: IdpGrant | undefined;
    try {
      current = this.vault.get(ref);
    } catch {
      current = undefined;
    }
    if (outcome.ok) {
      if (!current) {
        // Revoked or ended while the refresh was out: the rotated token must
        // not outlive it.
        this.revokeAtProvider(outcome.refreshToken, "ended during a refresh");
        return "ended";
      }
      const now = this.now();
      const next: IdpGrant = { ...current, refreshToken: outcome.refreshToken, refreshedAt: now, lastOkAt: now };
      delete next.failedAt;
      delete next.failingSince;
      delete next.answerLostAt;
      // The rotated token is persisted first: the old one is dead.
      try {
        this.vault.set(next);
      } catch (error) {
        this.log(`routine delegation: could not keep a rotated grant: ${error instanceof Error ? error.message : String(error)}`);
        this.revokeAtProvider(outcome.refreshToken, "unkept");
        this.end(principalId, ref, "the rotated grant could not be kept");
        return "ended";
      }
      this.stale.delete(principalId);
      this.retryAt.delete(principalId);
      if (outcome.accessToken) this.access.set(principalId, { token: outcome.accessToken, expiresAt: now + (outcome.expiresIn ?? 3600) * 1000 });
      if (outcome.identity && !this.applyIdentity(next, outcome.identity)) {
        this.revokeAtProvider(outcome.refreshToken, "role gone");
        this.end(principalId, ref, "the role no longer signs in", "person_out");
        return "out";
      }
      return "ok";
    }
    if (!current) return "ended";
    if (outcome.kind === "rejected") {
      if (answerLost) {
        // The provider took the retry of a lost answer for a reuse: it is
        // the authority, the delegation ends, and the person is told why once.
        this.end(principalId, ref, `${outcome.error} after a refresh was interrupted`);
        this.interrupted.add(principalId);
        return "ended";
      }
      this.end(principalId, ref, outcome.error);
      return "ended";
    }
    const now = this.now();
    if (outcome.rateLimited) {
      // An answer, not an outage: failingSince stays as it was.
      this.retryAt.set(principalId, now + Math.max(ROUTINE_CONSENT_RATE_LIMIT_MIN_MS, outcome.retryAfterMs ?? ROUTINE_CONSENT_RATE_LIMIT_MIN_MS));
      this.log("routine delegation: renewal deferred (Perspicax is rate limiting this server); the run is retried, the permission kept");
      return "rate_limited";
    }
    try {
      this.vault.set({ ...current, failedAt: now, failingSince: current.failingSince ?? now });
    } catch {
      /* nothing to keep */
    }
    this.log(`routine delegation: renewal deferred (${outcome.error}); the run is skipped, the permission kept`);
    return "unreachable";
  }

  /** The refreshed claims flow into the person. False: the role no longer signs in. */
  private applyIdentity(grant: IdpGrant, identity: OidcIdentity): boolean {
    const orgRole = orgRoleForRole(identity.role);
    if (!orgRole) return false;
    this.principals.forSubject({
      iss: grant.iss,
      sub: grant.sub,
      claims: { email: identity.email, name: identity.name, login: identity.preferredUsername, ...(identity.avatar ? { avatar: identity.avatar } : {}) },
      orgRole,
      ...(identity.teams ? { teams: identity.teams.map(({ id, manager }) => ({ id, manager })) } : {}),
      ...(perspicaxRoleOf(identity.role) ? { perspicaxRole: perspicaxRoleOf(identity.role) } : {}),
    });
    return true;
  }

  private end(principalId: string, ref: string, why: string, reason: RoutineConsentEnd = "delegation_ended"): void {
    this.safeDelete(ref);
    this.forget(principalId);
    this.log(`routine delegation: ended (${why})`);
    this.onEnded(principalId, reason);
  }

  private safeDelete(grantRef: string): void {
    try {
      this.vault.delete(grantRef);
    } catch (error) {
      this.log(`routine delegation: could not drop a grant: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private revokeAtProvider(refreshToken: string, why: string): void {
    this.revocations.enqueue(refreshToken, "refresh_token", why);
  }
}
