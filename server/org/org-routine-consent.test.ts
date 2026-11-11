// Routine delegations (slice 6): the per-person grant that lets routines act
// in their person's name while they are away. The provider is a scripted
// stand-in; the vault and the principal store are the real ones.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { IDP_VAULT_FILE, IdpGrantVault, isSessionGrant, type IdpRelyingParty } from "../auth/idp-session.ts";
import type { OidcIdentity, RefreshOutcome } from "../auth/oidc-rp.ts";
import type { SubjectTokenOutcome } from "../auth/idp-session.ts";
import {
  ROUTINE_CONSENT_LIFE_MS, ROUTINE_CONSENT_RENEW_MS, ROUTINE_DELEGATION_ISSUE_RETRY_MS, ROUTINE_DELEGATION_KEEPALIVE_MS,
  ROUTINE_DELEGATION_UNSUPPORTED_RETRY_MS, RoutineConsents, routineRenewMs, type RoutineConsentEnd, type RoutineDelegationIssue,
} from "./org-routine-consent.ts";
import { PrincipalRegistry } from "../auth/principals.ts";
import { rotatingRefreshProvider } from "../testing/rotating-refresh-provider.ts";

const ISS = "https://px.example.test";
const KEY = "c".repeat(64);
let dir: string;
let clock: number;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "omb-rc-"));
  clock = 1_800_000_000_000;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function setup(auto: {
  issue?: (token: string) => Promise<RoutineDelegationIssue>;
  session?: (principalId: string) => Promise<SubjectTokenOutcome>;
} = {}) {
  const script: Array<RefreshOutcome | Promise<RefreshOutcome>> = [];
  const calls: string[] = [];
  const revoked: string[] = [];
  let n = 0;
  const rp: IdpRelyingParty = {
    refresh: async (token) => {
      calls.push(token);
      const next = script.shift();
      return next ?? { ok: true, refreshToken: `pxlr1.rot${++n}`, accessToken: `pxlo1.acc${n}`, expiresIn: 3600 };
    },
    revokeToken: async (token) => { revoked.push(token); return true; },
  };
  let id = 0;
  const principals = new PrincipalRegistry({ path: join(dir, "principals.json"), now: () => clock, newId: () => `pr_00000000-0000-4000-8000-${String(++id).padStart(12, "0")}` });
  const vault = new IdpGrantVault(dir, () => ({ kind: "key", key: Buffer.from(KEY, "hex") }));
  const ended: Array<[string, RoutineConsentEnd]> = [];
  const active: string[] = [];
  const logs: string[] = [];
  const consents = new RoutineConsents({
    vault, rp, principals, now: () => clock, log: (line) => logs.push(line),
    onEnded: (pid, reason) => ended.push([pid, reason]),
    onActive: (pid) => active.push(pid),
    ...(auto.issue ? { issue: auto.issue } : {}),
    ...(auto.session ? { sessionSubject: auto.session } : {}),
    subjectOf: (pid) => {
      const person = principals.byId(pid);
      return person?.subject && person.disabledAt === undefined ? { iss: person.subject.iss, sub: person.subject.sub } : null;
    },
  });
  const alice = principals.forSubject({ iss: ISS, sub: "A1", claims: { name: "Alice" }, orgRole: "member" });
  const consent = (principalId = alice.id, sub = "A1", token = "pxlr1.first") =>
    consents.create({ principalId, iss: ISS, sub, refreshToken: token, accessToken: "pxlo1.first", accessExpiresAt: clock + 3_600_000 });
  return { consents, vault, rp, script, calls, revoked, principals, ended, active, logs, alice, consent };
}

const identity = (overrides: Partial<OidcIdentity> = {}): OidcIdentity => ({ iss: ISS, sub: "A1", name: "Alice Renamed", email: "alice@example.test", role: "employee", ...overrides } as OidcIdentity);

describe("routine delegations (slice 6)", () => {
  it("keeps one routines grant per person; a new consent replaces and revokes the previous one", async () => {
    const { consents, vault, revoked, active, alice, consent } = setup();
    expect(consents.status(alice.id)).toEqual({ state: "none" });
    consent();
    const first = vault.list();
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ kind: "routines", principalId: alice.id, sub: "A1" });
    expect(first[0]!.sessionId).toBeUndefined();
    expect(isSessionGrant(first[0]!)).toBe(false);
    clock += 1000;
    consent(alice.id, "A1", "pxlr1.second");
    await new Promise((resolve) => setImmediate(resolve));
    expect(vault.list()).toHaveLength(1);
    expect(vault.list()[0]!.refreshToken).toBe("pxlr1.second");
    expect(revoked).toEqual(["pxlr1.first"]);
    expect(active).toEqual([alice.id, alice.id]);
    expect(consents.status(alice.id)).toEqual({ state: "active", consentedAt: clock, renewedAt: clock, expiresAt: clock + ROUTINE_CONSENT_LIFE_MS });
  });

  it("reuses a fresh renewal and its access token for 10 minutes, then refreshes", async () => {
    const { consents, calls, alice, consent } = setup();
    expect(await consents.prepare(alice.id)).toEqual({ ok: false, error: "missing" });
    consent();
    expect(await consents.prepare(alice.id)).toEqual({ ok: true });
    clock += ROUTINE_CONSENT_RENEW_MS - 1;
    expect(await consents.prepare(alice.id)).toEqual({ ok: true });
    expect(calls).toEqual([]);
    clock += 1;
    expect(await consents.prepare(alice.id)).toEqual({ ok: true });
    expect(calls).toEqual(["pxlr1.first"]);
    expect(consents.status(alice.id)).toMatchObject({ state: "active", renewedAt: clock });
    // the rotated token went to the vault first
    expect(await consents.prepare(alice.id)).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
  });

  it("refreshes once for concurrent runs of one person", async () => {
    const { consents, calls, script, alice, consent } = setup();
    consent();
    clock += ROUTINE_CONSENT_RENEW_MS;
    let release!: (value: RefreshOutcome) => void;
    script.push(new Promise<RefreshOutcome>((resolve) => { release = resolve; }));
    const a = consents.prepare(alice.id);
    const b = consents.prepare(alice.id);
    await new Promise((resolve) => setImmediate(resolve));
    release({ ok: true, refreshToken: "pxlr1.once", accessToken: "pxlo1.once", expiresIn: 3600 });
    expect(await Promise.all([a, b])).toEqual([{ ok: true }, { ok: true }]);
    expect(calls).toHaveLength(1);
  });

  it("ends the delegation on a refusal and tells the routines once", async () => {
    const { consents, vault, script, ended, alice, consent } = setup();
    consent();
    clock += ROUTINE_CONSENT_RENEW_MS;
    script.push({ ok: false, kind: "rejected", error: "invalid_grant" });
    expect(await consents.prepare(alice.id)).toEqual({ ok: false, error: "ended" });
    expect(vault.list()).toEqual([]);
    expect(ended).toEqual([[alice.id, "delegation_ended"]]);
    expect(await consents.prepare(alice.id)).toEqual({ ok: false, error: "missing" });
    expect(ended).toHaveLength(1);
  });

  it("keeps the delegation through a transient failure: the run is skipped", async () => {
    const { consents, vault, script, ended, alice, consent, logs } = setup();
    consent();
    clock += ROUTINE_CONSENT_RENEW_MS;
    script.push({ ok: false, kind: "transient", error: "HTTP 503" });
    expect(await consents.prepare(alice.id)).toEqual({ ok: false, error: "unreachable" });
    expect(vault.list()).toHaveLength(1);
    expect(ended).toEqual([]);
    expect(await consents.prepare(alice.id)).toEqual({ ok: true });
    expect(logs.join("\n")).not.toMatch(/pxl[ro]1\./);
  });

  it("applies the refreshed claims, and ends when the role no longer signs in", async () => {
    const { consents, script, principals, ended, alice, consent, revoked } = setup();
    consent();
    clock += ROUTINE_CONSENT_RENEW_MS;
    script.push({ ok: true, refreshToken: "pxlr1.r1", accessToken: "pxlo1.a1", expiresIn: 3600, identity: identity() });
    expect(await consents.prepare(alice.id)).toEqual({ ok: true });
    expect(principals.byId(alice.id)?.name).toBe("Alice Renamed");
    clock += ROUTINE_CONSENT_RENEW_MS;
    script.push({ ok: true, refreshToken: "pxlr1.r2", accessToken: "pxlo1.a2", expiresIn: 3600, identity: identity({ role: "guest" }) });
    expect(await consents.prepare(alice.id)).toEqual({ ok: false, error: "ended" });
    expect(ended).toEqual([[alice.id, "person_out"]]);
    await new Promise((resolve) => setImmediate(resolve));
    expect(revoked).toContain("pxlr1.r2");
  });

  it("reconciles with the directory: only false on a grant older than the fetch ends it", () => {
    const { consents, vault, ended, alice, principals, consent } = setup();
    const bob = principals.forSubject({ iss: ISS, sub: "B1", orgRole: "member" });
    consent();
    clock += 10_000;
    consent(bob.id, "B1", "pxlr1.bob");
    // bob consented 1 s after the fetch started: kept; unknown never ends
    expect(consents.reconcile((sub) => (sub === "A1" ? undefined : false), clock - 1000)).toBe(0);
    expect(vault.list()).toHaveLength(2);
    expect(consents.reconcile((sub) => (sub === "A1" ? false : true), clock)).toBe(1);
    expect(ended).toEqual([[alice.id, "delegation_ended"]]);
    expect(consents.status(bob.id).state).toBe("active");
  });

  it("serves the delegation's access token as a token exchange subject, and refreshes after dropCache", async () => {
    const { consents, calls, alice, consent } = setup();
    expect(await consents.subjectToken(alice.id)).toEqual({ ok: false, error: "no_session" });
    consent();
    expect(await consents.subjectToken(alice.id)).toEqual({ ok: true, token: "pxlo1.first", expiresAt: clock + 3_600_000 });
    consents.dropCache(alice.id);
    const renewed = await consents.subjectToken(alice.id);
    expect(renewed).toMatchObject({ ok: true, token: "pxlo1.acc1" });
    expect(calls).toHaveLength(1);
    // the next run still reuses the renewal
    expect(await consents.prepare(alice.id)).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
  });

  it("refreshes the subject when the cached token has under 10 minutes left", async () => {
    const { consents, calls, alice } = setup();
    consents.create({ principalId: alice.id, iss: ISS, sub: "A1", refreshToken: "pxlr1.x", accessToken: "pxlo1.short", accessExpiresAt: clock + 60_000 });
    expect(await consents.subjectToken(alice.id)).toMatchObject({ ok: true, token: "pxlo1.acc1" });
    expect(calls).toEqual(["pxlr1.x"]);
  });

  it("has no revoke from Sagax, and ends on a person out without a provider call", async () => {
    const { consents, revoked, ended, alice, principals, consent } = setup();
    const bob = principals.forSubject({ iss: ISS, sub: "B1", orgRole: "member" });
    expect("revoke" in consents).toBe(false);
    consent();
    consent(bob.id, "B1", "pxlr1.bob");
    expect(consents.endForSubject(ISS, "B1")).toBe(1);
    await new Promise((resolve) => setImmediate(resolve));
    expect(revoked).toEqual([]);
    expect(ended).toEqual([[bob.id, "person_out"]]);
    expect(consents.principalsWithConsent()).toEqual([alice.id]);
  });

  it("reads SAGAX_ROUTINE_RENEW_SECONDS as 1 to 600, else 10 minutes", () => {
    expect(routineRenewMs(undefined)).toBe(ROUTINE_CONSENT_RENEW_MS);
    expect(routineRenewMs("20")).toBe(20_000);
    for (const bad of ["0", "601", "1.5", "x", ""]) expect(routineRenewMs(bad)).toBe(ROUTINE_CONSENT_RENEW_MS);
  });

  it("never writes a token in plain text", async () => {
    const { consents, alice, consent } = setup();
    consent();
    clock += ROUTINE_CONSENT_RENEW_MS;
    await consents.prepare(alice.id);
    const raw = readFileSync(join(dir, IDP_VAULT_FILE), "utf8");
    expect(raw).not.toMatch(/pxl[ro]1\./);
    expect(JSON.stringify(consents.status(alice.id))).not.toMatch(/pxl/);
  });

  it("defers a rate-limited renewal without a call inside its window, keeps failingSince and the permission (fix 2)", async () => {
    const { consents, vault, script, calls, ended, alice, consent, logs } = setup();
    consent();
    clock += ROUTINE_CONSENT_RENEW_MS;
    script.push({ ok: false, kind: "transient", rateLimited: true, retryAfterMs: 90_000, error: "Perspicax is rate limiting this server (retry in 90 s)" });
    expect(await consents.prepare(alice.id)).toEqual({ ok: false, error: "rate_limited", retryAfterMs: 90_000 });
    expect(calls).toHaveLength(1);
    expect(vault.list()[0]?.failingSince).toBeUndefined();
    expect(ended).toEqual([]);
    expect(logs).toContain("routine delegation: renewal deferred (Perspicax is rate limiting this server); the run is retried, the permission kept");
    clock += 30_000;
    expect(await consents.prepare(alice.id)).toEqual({ ok: false, error: "rate_limited", retryAfterMs: 60_000 });
    consents.dropCache(alice.id);
    expect(await consents.subjectToken(alice.id)).toEqual({ ok: false, error: "rate_limited", retryAfterMs: 60_000 });
    expect(calls).toHaveLength(1);
    clock += 60_000;
    expect(await consents.prepare(alice.id)).toEqual({ ok: true });
    expect(calls).toHaveLength(2);
    // A short Retry-After still waits the minute.
    clock += ROUTINE_CONSENT_RENEW_MS;
    script.push({ ok: false, kind: "transient", rateLimited: true, retryAfterMs: 1_000, error: "Perspicax is rate limiting this server (retry in 1 s)" });
    expect(await consents.prepare(alice.id)).toEqual({ ok: false, error: "rate_limited", retryAfterMs: 60_000 });
  });

  it("revokes through the revocation sink when one is given", async () => {
    const queued: Array<[string, string]> = [];
    const { alice, principals } = setup();
    const vault = new IdpGrantVault(join(dir, "other"), () => ({ kind: "key", key: Buffer.from(KEY, "hex") }));
    const rp: IdpRelyingParty = { refresh: async () => ({ ok: false, kind: "transient", error: "x" }), revokeToken: async () => { throw new Error("never called directly"); } };
    const consents = new RoutineConsents({ vault, rp, principals, now: () => clock, log: () => {}, revocations: { enqueue: (token, _hint, why) => queued.push([token, why]) } });
    consents.create({ principalId: alice.id, iss: ISS, sub: "A1", refreshToken: "pxlr1.one" });
    consents.create({ principalId: alice.id, iss: ISS, sub: "A1", refreshToken: "pxlr1.two" });
    expect(queued).toEqual([["pxlr1.one", "replaced"]]);
  });
});

describe("routines always act in their owner's name (2026-10-08)", () => {
  const issued = (n: number): RoutineDelegationIssue => ({ ok: true, refreshToken: `pxlr1.issued${n}`, accessToken: `pxlo1.issued${n}`, accessExpiresAt: clock + 3_600_000 });

  it("issues the delegation at a run from the owner's live session, with no consent", async () => {
    const subjects: string[] = [];
    let n = 0;
    const { consents, vault, active, alice } = setup({
      issue: async (token) => { subjects.push(token); return issued(++n); },
      session: async () => ({ ok: true, token: "pxlo1.session", expiresAt: clock + 3_600_000 }),
    });
    expect(await consents.prepare(alice.id)).toEqual({ ok: true });
    expect(subjects).toEqual(["pxlo1.session"]);
    expect(vault.list()).toEqual([expect.objectContaining({ kind: "routines", principalId: alice.id, sub: "A1", refreshToken: "pxlr1.issued1" })]);
    expect(active).toEqual([alice.id]);
    expect(await consents.subjectToken(alice.id)).toEqual({ ok: true, token: "pxlo1.issued1", expiresAt: clock + 3_600_000 });
    expect(subjects).toHaveLength(1);
  });

  it("issues it at sign-in from the sign-in access token, once for concurrent calls", async () => {
    const subjects: string[] = [];
    let release!: (value: RoutineDelegationIssue) => void;
    const { consents, alice } = setup({
      issue: (token) => { subjects.push(token); return new Promise((resolve) => { release = resolve; }); },
    });
    const a = consents.keepAlive(alice.id, { token: "pxlo1.signin" });
    const b = consents.ensure(alice.id, { token: "pxlo1.signin" });
    await new Promise((resolve) => setImmediate(resolve));
    release(issued(1));
    await a;
    expect(await b).toBe("granted");
    expect(subjects).toEqual(["pxlo1.signin"]);
    expect(consents.status(alice.id).state).toBe("active");
    expect(await consents.ensure(alice.id)).toBe("active");
  });

  it("issues a new one at once when Perspicax ended the family: the routine is never paused", async () => {
    let n = 0;
    const { consents, script, ended, alice, consent } = setup({
      issue: async () => issued(++n),
      session: async () => ({ ok: true, token: "pxlo1.session", expiresAt: clock + 3_600_000 }),
    });
    consent();
    clock += ROUTINE_CONSENT_RENEW_MS;
    script.push({ ok: false, kind: "rejected", error: "invalid_grant" });
    expect(await consents.prepare(alice.id)).toEqual({ ok: true });
    expect(ended).toEqual([[alice.id, "delegation_ended"]]);
    expect(consents.status(alice.id).state).toBe("active");
    // the directory's reconcile (a console revoke) is issued again the same way
    clock += 10_000;
    expect(consents.reconcile(() => false, clock)).toBe(1);
    expect(await consents.prepare(alice.id)).toEqual({ ok: true });
    expect(n).toBe(2);
  });

  it("falls back to the live session when the given token is refused", async () => {
    const subjects: string[] = [];
    const { consents, alice } = setup({
      issue: async (token) => { subjects.push(token); return token === "pxlo1.stale" ? { ok: false, error: "subject" } : issued(1); },
      session: async () => ({ ok: true, token: "pxlo1.fresh", expiresAt: clock + 3_600_000 }),
    });
    expect(await consents.ensure(alice.id, { token: "pxlo1.stale" })).toBe("granted");
    expect(subjects).toEqual(["pxlo1.stale", "pxlo1.fresh"]);
  });

  it("only skips the run when no one is signed in or Perspicax cannot issue it, and waits before asking again", async () => {
    let calls = 0;
    let answer: RoutineDelegationIssue = { ok: false, error: "unsupported" };
    let signedIn = false;
    const { consents, ended, alice } = setup({
      issue: async () => { calls++; return answer; },
      session: async () => signedIn ? { ok: true, token: "pxlo1.s", expiresAt: clock + 3_600_000 } : { ok: false, error: "no_session" },
    });
    expect(await consents.prepare(alice.id)).toEqual({ ok: false, error: "missing" });
    expect(calls).toBe(0);
    clock += ROUTINE_DELEGATION_ISSUE_RETRY_MS - 1;
    expect(await consents.prepare(alice.id)).toEqual({ ok: false, error: "missing" });
    clock += 1;
    signedIn = true;
    expect(await consents.prepare(alice.id)).toEqual({ ok: false, error: "missing" });
    expect(calls).toBe(1);
    clock += ROUTINE_DELEGATION_UNSUPPORTED_RETRY_MS - 1;
    expect(await consents.prepare(alice.id)).toEqual({ ok: false, error: "missing" });
    expect(calls).toBe(1);
    clock += 1;
    answer = issued(1);
    expect(await consents.prepare(alice.id)).toEqual({ ok: true });
    expect(calls).toBe(2);
    expect(ended).toEqual([]);
  });

  it("never issues one for a person who is out", async () => {
    let calls = 0;
    const { consents, principals, alice } = setup({
      issue: async () => { calls++; return issued(1); },
      session: async () => ({ ok: true, token: "pxlo1.s", expiresAt: clock + 3_600_000 }),
    });
    principals.markDisabled(ISS, "A1", clock);
    expect(principals.byId(alice.id)?.disabledAt).toBe(clock);
    expect(await consents.ensure(alice.id)).toBe("unavailable");
    expect(calls).toBe(0);
  });

  it("slides the delegation once a day while the person keeps using Sagax", async () => {
    const { consents, calls, alice, consent } = setup({ issue: async () => issued(1) });
    consent();
    clock += ROUTINE_DELEGATION_KEEPALIVE_MS - 1;
    await consents.keepAlive(alice.id);
    expect(calls).toEqual([]);
    clock += 1;
    await consents.keepAlive(alice.id);
    expect(calls).toEqual(["pxlr1.first"]);
    expect(consents.status(alice.id)).toMatchObject({ state: "active", renewedAt: clock });
  });
});

describe("a refresh whose answer was lost (#3661)", () => {
  function lostSetup(graceMs: number) {
    const provider = rotatingRefreshProvider({ first: "pxlr1.first", graceMs, now: () => clock });
    let id = 0;
    const principals = new PrincipalRegistry({ path: join(dir, "principals.json"), now: () => clock, newId: () => `pr_00000000-0000-4000-8000-${String(++id).padStart(12, "0")}` });
    const vault = new IdpGrantVault(dir, () => ({ kind: "key", key: Buffer.from(KEY, "hex") }));
    const ended: Array<[string, RoutineConsentEnd]> = [];
    const logs: string[] = [];
    const build = () => new RoutineConsents({
      vault, rp: provider, principals, now: () => clock, log: (line) => logs.push(line),
      onEnded: (pid, reason) => ended.push([pid, reason]),
      // the waits between the retries pass on the provider's clock
      sleep: async (ms) => { clock += ms; },
    });
    const consents = build();
    const alice = principals.forSubject({ iss: ISS, sub: "A1", claims: { name: "Alice" }, orgRole: "member" });
    consents.create({ principalId: alice.id, iss: ISS, sub: "A1", refreshToken: "pxlr1.first" });
    clock += ROUTINE_CONSENT_RENEW_MS;
    return { provider, vault, consents, alice, ended, logs, build };
  }

  it("asks again at once with the same token: the rotated answer comes back inside the grace and the permission stays", async () => {
    const { provider, vault, consents, alice, ended } = lostSetup(30_000);
    provider.loseNextAnswers(1);
    expect(await consents.prepare(alice.id)).toEqual({ ok: true });
    expect(provider.calls).toEqual(["pxlr1.first", "pxlr1.first"]);
    expect(provider.revoked()).toBe(false);
    const grant = vault.list()[0]!;
    expect(grant.refreshToken).toBe(provider.current());
    expect(grant.answerLostAt).toBeUndefined();
    expect(ended).toEqual([]);
  });

  it("ends the permission when the provider refuses the retry, and says why once", async () => {
    const { provider, consents, alice, ended, logs } = lostSetup(0);
    provider.loseNextAnswers(1);
    expect(await consents.prepare(alice.id)).toEqual({ ok: false, error: "ended", interrupted: true });
    expect(ended).toEqual([[alice.id, "delegation_ended"]]);
    expect(logs.filter((line) => /ended .*after a refresh was interrupted/.test(line))).toHaveLength(1);
    // told once: the next run says the usual
    expect(await consents.prepare(alice.id)).toEqual({ ok: false, error: "missing" });
  });

  it("a refused connection is one deferred line and no retry, as before", async () => {
    const { provider, vault, consents, alice, logs } = lostSetup(30_000);
    provider.refuseNextConnection();
    expect(await consents.prepare(alice.id)).toEqual({ ok: false, error: "unreachable" });
    expect(provider.calls).toEqual(["pxlr1.first"]);
    expect(logs.filter((line) => line.includes("renewal deferred"))).toHaveLength(1);
    expect(vault.list()[0]!.answerLostAt).toBeUndefined();
  });

  it("a restart between the lost answer and the retry asks again first, before any run", async () => {
    const { provider, vault, alice, build } = lostSetup(30_000);
    // every answer of the first flight is lost (the provider is slow)
    provider.loseNextAnswers(4);
    const before = build();
    expect(await before.prepare(alice.id)).toEqual({ ok: false, error: "unreachable" });
    expect(vault.list()[0]!.answerLostAt).toBeDefined();
    const calls = provider.calls.length;
    // a restart: a new process, the grant read back from the vault
    const after = build();
    expect(after.resumeInterrupted()).toBe(1);
    await after.settled(alice.id);
    expect(provider.calls.length).toBe(calls + 1);
    expect(provider.calls.at(-1)).toBe("pxlr1.first");
    expect(vault.list()[0]).toMatchObject({ refreshToken: provider.current() });
    expect(vault.list()[0]!.answerLostAt).toBeUndefined();
    expect(provider.revoked()).toBe(false);
  });
});
