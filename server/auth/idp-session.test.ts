// The identity provider grants behind "Sign in with Pulsatrix" sessions
// (slice 2): the sealed vault, refresh on use, the unreachable grace, role
// changes, release on revoke, the sweep and back-channel logout. The
// provider is a scripted stand-in; the session and principal stores are the
// real ones on a temp dir.
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  DEFAULT_REFRESH_AFTER_SECONDS,
  IDP_KEY_FILE,
  IDP_CLIENT_REFUSED_GRACE_MS,
  IDP_QUICK_RETRY_MS,
  IDP_REFRESH_WAIT_MS,
  IDP_RETRY_AFTER_FAILURE_MS,
  IDP_SUBJECT_MIN_LIFE_MS,
  IDP_SWEEP_INTERVAL_MS,
  IDP_SWEEP_SLACK_MS,
  IDP_UNREACHABLE_GRACE_MS,
  IDP_VAULT_FILE,
  IdpGrantVault,
  IdpSessionManager,
  refreshAfterMs,
  resolveIdpVaultKey,
  type IdpRelyingParty,
  type IdpSessionManagerOptions,
} from "./idp-session.ts";
import { RevocationQueue, type RevocationSink } from "./idp-revocations.ts";
import { TokenCallPacer } from "./idp-token-pacer.ts";
import type { RefreshOutcome, RevokeAttempt } from "./oidc-rp.ts";
import { PrincipalRegistry } from "./principals.ts";
import { SessionRegistry, type Scope } from "./sessions.ts";

const ISS = "https://px.example.test";
const REJ: RefreshOutcome = { ok: false, kind: "rejected", error: "invalid_grant" };
const KEY = "a".repeat(64);
let dir: string;
let clock: number;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "omb-idp-"));
  clock = 1_800_000_000_000;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("the grant vault", () => {
  it("round-trips grants sealed, and removes the file when empty", () => {
    const vault = new IdpGrantVault(dir, () => ({ kind: "key", key: Buffer.from(KEY, "hex") }));
    vault.set({ grantRef: "g1", iss: ISS, sub: "S", refreshToken: "pxlr1.secret", createdAt: 1, refreshedAt: 1, lastOkAt: 1 });
    const raw = readFileSync(join(dir, IDP_VAULT_FILE), "utf8");
    expect(raw).not.toContain("pxlr1.secret");
    if (process.platform !== "win32") expect(statSync(join(dir, IDP_VAULT_FILE)).mode & 0o777).toBe(0o600);
    const reread = new IdpGrantVault(dir, () => ({ kind: "key", key: Buffer.from(KEY, "hex") }));
    expect(reread.get("g1")).toMatchObject({ sub: "S", refreshToken: "pxlr1.secret" });
    expect(reread.list()).toHaveLength(1);
    expect(reread.delete("g1")).toBe(true);
    expect(existsSync(join(dir, IDP_VAULT_FILE))).toBe(false);
  });

  it("never overwrites a file it cannot read", () => {
    const vault = new IdpGrantVault(dir, () => ({ kind: "key", key: Buffer.from(KEY, "hex") }));
    vault.set({ grantRef: "g1", iss: ISS, sub: "S", refreshToken: "t", createdAt: 1, refreshedAt: 1, lastOkAt: 1 });
    const before = readFileSync(join(dir, IDP_VAULT_FILE), "utf8");
    const wrong = new IdpGrantVault(dir, () => ({ kind: "key", key: Buffer.from("b".repeat(64), "hex") }));
    expect(wrong.unavailableReason()).toMatch(/decrypted/);
    expect(wrong.list()).toEqual([]);
    expect(() => wrong.set({ grantRef: "g2", iss: ISS, sub: "S", refreshToken: "t", createdAt: 1, refreshedAt: 1, lastOkAt: 1 })).toThrow();
    expect(readFileSync(join(dir, IDP_VAULT_FILE), "utf8")).toBe(before);
    writeFileSync(join(dir, IDP_VAULT_FILE), "garbage");
    const damaged = new IdpGrantVault(dir, () => ({ kind: "key", key: Buffer.from(KEY, "hex") }));
    expect(damaged.unavailableReason()).not.toBeNull();
    expect(() => damaged.delete("g1")).toThrow();
    expect(readFileSync(join(dir, IDP_VAULT_FILE), "utf8")).toBe("garbage");
  });

  it("takes its key from SAGAX_IDP_VAULT_KEY, SAGAX_IDP_VAULT_KEY_FILE or a 0600 file beside the data", () => {
    expect(resolveIdpVaultKey(dir, { SAGAX_IDP_VAULT_KEY: KEY.toUpperCase() })).toEqual({ kind: "key", key: Buffer.from(KEY, "hex") });
    expect(resolveIdpVaultKey(dir, { SAGAX_IDP_VAULT_KEY: "short" }).kind).toBe("unavailable");
    expect(resolveIdpVaultKey(dir, { SAGAX_DESKTOP_PARENT: "1" }).kind).toBe("unavailable");
    const keyFile = join(dir, "elsewhere", "grants.key");
    const fromFile = resolveIdpVaultKey(dir, { SAGAX_IDP_VAULT_KEY_FILE: keyFile });
    expect(fromFile.kind).toBe("key");
    expect(readFileSync(keyFile, "utf8").trim()).toMatch(/^[0-9a-f]{64}$/);
    writeFileSync(keyFile, "not a key");
    expect(resolveIdpVaultKey(dir, { SAGAX_IDP_VAULT_KEY_FILE: keyFile }).kind).toBe("unavailable");
    const first = resolveIdpVaultKey(dir, {});
    const second = resolveIdpVaultKey(dir, {});
    expect(first).toEqual(second);
    if (process.platform !== "win32") expect(statSync(join(dir, IDP_KEY_FILE)).mode & 0o777).toBe(0o600);
  });

  it("reads SAGAX_OIDC_REFRESH_AFTER_SECONDS as 1 to 3000, else the default", () => {
    expect(refreshAfterMs(undefined)).toBe(DEFAULT_REFRESH_AFTER_SECONDS * 1000);
    expect(refreshAfterMs("1")).toBe(1000);
    expect(refreshAfterMs("3000")).toBe(3_000_000);
    for (const bad of ["0", "3001", "1.5", "abc", "", "-4"]) expect(refreshAfterMs(bad)).toBe(3_000_000);
  });
});

/** A provider stand-in: each refresh answers the next scripted outcome. */
function scriptedProvider() {
  const script: Array<RefreshOutcome | Promise<RefreshOutcome>> = [];
  const calls: string[] = [];
  const revoked: string[] = [];
  let n = 0;
  const rp: IdpRelyingParty = {
    refresh: async (token) => {
      calls.push(token);
      const next = script.shift();
      return next ?? { ok: true, refreshToken: `pxlr1.rot${++n}` };
    },
    revokeToken: async (token) => { revoked.push(token); return true; },
  };
  return { rp, script, calls, revoked };
}

function setup(options: { refreshAfterMs?: number; revocations?: RevocationSink; onRenewed?: IdpSessionManagerOptions["onRenewed"] } = {}) {
  const provider = scriptedProvider();
  const sessions = new SessionRegistry({ file: join(dir, "sessions.json"), now: () => clock });
  let id = 0;
  const principals = new PrincipalRegistry({ path: join(dir, "principals.json"), now: () => clock, newId: () => `pr_00000000-0000-4000-8000-${String(++id).padStart(12, "0")}` });
  const vault = new IdpGrantVault(dir, () => ({ kind: "key", key: Buffer.from(KEY, "hex") }));
  const logs: string[] = [];
  const timers: Array<{ run: () => void; at: number }> = [];
  const manager = new IdpSessionManager({ vault, rp: provider.rp, sessions, principals, now: () => clock, refreshAfterMs: options.refreshAfterMs ?? 3_000_000, log: (l) => logs.push(l), schedule: (run, delayMs) => { timers.push({ run, at: clock + delayMs }); }, sleep: async () => {}, ...(options.revocations ? { revocations: options.revocations } : {}), ...(options.onRenewed ? { onRenewed: options.onRenewed } : {}) });
  sessions.onSessionRevoked((sessionId) => manager.release(sessionId, { revokeAtIdp: true }));
  sessions.onExchanged((session) => { if (session.idp?.grantRef) manager.bindSession(session.idp.grantRef, session.id); });
  /** A web sign-in: principal, grant, session bound to it. */
  const signIn = (sub: string, role = "employee", scopes: Scope[] = role === "admin" ? ["admin", "client"] : ["client"], access?: { accessToken: string; accessExpiresAt: number }) => {
    const principal = principals.forSubject({ iss: ISS, sub, orgRole: role === "admin" ? "admin" : "member" });
    const grantRef = manager.createGrant({ iss: ISS, sub, refreshToken: `pxlr1.first-${sub}-${clock}`, bindBy: clock + 60_000, ...access });
    const issued = sessions.issue({ label: "web", scopes, principalId: principal.id, idp: { iss: ISS, sub, role, grantRef } });
    manager.bindSession(grantRef, issued.session.id);
    return { principal, grantRef, sessionId: issued.session.id, record: () => sessions.byId(issued.session.id) };
  };
  /** Advance the clock, firing the timers that come due. */
  const advance = (ms: number) => {
    clock += ms;
    for (const timer of timers.splice(0).sort((a, b) => a.at - b.at)) {
      if (timer.at <= clock) timer.run();
      else timers.push(timer);
    }
  };
  return { provider, sessions, principals, vault, manager, signIn, logs, timers, advance };
}

describe("refresh on use", () => {
  it("hands back the refresh in flight, so the request that found it due can wait for the new role", async () => {
    const { manager, provider, signIn, sessions } = setup({ refreshAfterMs: 1000 });
    const a = signIn("S9", "admin");
    await expect(manager.touch(a.record()!)).resolves.toBeUndefined();
    expect(provider.calls).toEqual([]);
    clock += 1000;
    provider.script.push({ ok: true, refreshToken: "pxlr1.demoted", identity: { iss: ISS, sub: "S9", role: "employee" } });
    const first = manager.touch(a.record()!);
    expect(manager.touch(a.record()!)).toBe(first); // single flight, the same promise
    await first;
    expect(sessions.byId(a.sessionId)?.scopes).toEqual(["client"]);
  });

  it("does nothing before it is due, then refreshes once in the background and keeps the rotated token", async () => {
    const { manager, provider, vault, signIn } = setup();
    const a = signIn("S1");
    manager.touch(a.record()!);
    await manager.settled();
    expect(provider.calls).toEqual([]);
    clock += 3_000_000;
    manager.touch(a.record()!);
    manager.touch(a.record()!); // single flight
    await manager.settled();
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]).toMatch(/^pxlr1\.first-S1/);
    expect(vault.get(a.grantRef)).toMatchObject({ refreshToken: "pxlr1.rot1", refreshedAt: clock, lastOkAt: clock });
    // not due again until another period has passed
    manager.touch(a.record()!);
    await manager.settled();
    expect(provider.calls).toHaveLength(1);
  });

  it("tells the renewal hook who keeps using Sagax, with the fresh access token, and not a person put out (2026-10-08)", async () => {
    const renewed: Array<{ sub: string; token?: string }> = [];
    const { manager, provider, signIn } = setup({ onRenewed: (subject, access) => renewed.push({ sub: subject.sub, ...(access ? { token: access.token } : {}) }) });
    const a = signIn("S1");
    clock += 3_000_000;
    provider.script.push({ ok: true, refreshToken: "pxlr1.r1", accessToken: "pxlo1.a1", expiresIn: 3600 });
    manager.touch(a.record()!);
    await manager.settled();
    expect(renewed).toEqual([{ sub: "S1", token: "pxlo1.a1" }]);
    clock += 3_000_000;
    provider.script.push({ ok: true, refreshToken: "pxlr1.r2", identity: { iss: ISS, sub: "S1", role: "guest" } as never });
    manager.touch(a.record()!);
    await manager.settled();
    expect(renewed).toHaveLength(1);
  });

  it("revokes every session of a grant the provider rejects twice, without calling revoke; with no other sign-in to ask, the person is marked out", async () => {
    const { manager, provider, vault, signIn, sessions, principals } = setup({ refreshAfterMs: 1000 });
    const a = signIn("S1");
    const b = signIn("S2");
    clock += 1000;
    provider.script.push(REJ, REJ);
    manager.touch(a.record()!);
    await manager.settled();
    expect(provider.calls).toHaveLength(2);
    expect(sessions.byId(a.sessionId)).toBeNull();
    expect(sessions.explainRefusal("x").code).toBe("session_unknown");
    expect(vault.get(a.grantRef)).toBeUndefined();
    expect(provider.revoked).toEqual([]);
    expect(sessions.byId(b.sessionId)).not.toBeNull();
    // refused twice and nothing else to ask: routines and channel turns stop
    // too, until the next sign-in (security review of 2026-10-20)
    expect(principals.byId(a.principal.id)?.disabledAt).toBe(clock);
    expect(principals.byId(b.principal.id)?.disabledAt).toBeUndefined();
  });

  it("a refusal answered once (a race, a provider mid-deploy) keeps the session: asked again, it refreshes", async () => {
    const { manager, provider, vault, signIn, sessions, principals, logs } = setup({ refreshAfterMs: 1000 });
    const a = signIn("S1");
    clock += 1000;
    provider.script.push(REJ);
    manager.touch(a.record()!);
    await manager.settled();
    expect(provider.calls).toHaveLength(2);
    expect(sessions.byId(a.sessionId)).not.toBeNull();
    expect(vault.get(a.grantRef)).toMatchObject({ refreshToken: "pxlr1.rot1" });
    expect(vault.get(a.grantRef)?.refreshStartedAt).toBeUndefined();
    expect(principals.byId(a.principal.id)?.disabledAt).toBeUndefined();
    expect(logs.some((line) => line.includes("asking again"))).toBe(true);
  });

  it("a refusal of a token another server already rotated is asked again with the newer token from the vault", async () => {
    const { manager, provider, signIn, sessions } = setup({ refreshAfterMs: 1000 });
    const a = signIn("S1");
    clock += 1000;
    // the old server of a deploy rotates the grant and writes it, while this
    // one already sent the old token
    let release: (outcome: RefreshOutcome) => void = () => {};
    provider.script.push(new Promise<RefreshOutcome>((resolve) => { release = resolve; }));
    manager.touch(a.record()!);
    await Promise.resolve();
    const other = new IdpGrantVault(dir, () => ({ kind: "key", key: Buffer.from(KEY, "hex") }));
    other.set({ ...other.get(a.grantRef)!, refreshToken: "pxlr1.kept-by-the-other-server" });
    release(REJ as RefreshOutcome);
    await manager.settled();
    expect(provider.calls[1]).toBe("pxlr1.kept-by-the-other-server");
    expect(sessions.byId(a.sessionId)).not.toBeNull();
  });

  it("a rejected refresh puts the person out: their paired devices, other sign-ins and open codes end, even without a back-channel push", async () => {
    const { manager, provider, vault, signIn, sessions, principals } = setup({ refreshAfterMs: 1000 });
    const bob = signIn("B1");
    clock += 1;
    const bobWeb2 = signIn("B1");
    const otherToken = vault.get(bobWeb2.grantRef)!.refreshToken;
    // a phone Bob paired himself from the web: principal-bound, no grant of its own
    const phone = sessions.issue({ label: "phone", scopes: ["client"], principalId: bob.principal.id });
    sessions.openPairing({ principalId: bob.principal.id, scopes: ["client"] });
    const alice = signIn("A1", "admin");
    clock += 1000;
    // Bob is disabled: refused twice, then his freshest other sign-in, checked next, is refused twice too
    provider.script.push(REJ, REJ, REJ, REJ);
    manager.touch(bob.record()!);
    await manager.settled();
    expect(provider.calls).toHaveLength(4);
    expect(provider.calls[2]).toBe(otherToken);
    for (const id of [bob.sessionId, bobWeb2.sessionId, phone.session.id]) expect(sessions.byId(id)).toBeNull();
    expect(vault.get(bob.grantRef)).toBeUndefined();
    expect(vault.get(bobWeb2.grantRef)).toBeUndefined();
    expect(sessions.openPairings()).toHaveLength(0);
    expect(principals.byId(bob.principal.id)?.disabledAt).toBe(clock);
    await new Promise((resolve) => setImmediate(resolve));
    // both grants were refused: nothing is left to revoke at the provider
    expect(provider.revoked).toEqual([]);
    expect(sessions.byId(alice.sessionId)).not.toBeNull();
    expect(principals.byId(alice.principal.id)?.disabledAt).toBeUndefined();
  });

  it("a refused sign-in family ends only its session when the person's other sign-in still refreshes (a cap eviction, S6-3)", async () => {
    const { manager, provider, vault, signIn, sessions, principals, logs } = setup({ refreshAfterMs: 1000 });
    const evicted = signIn("A1", "admin");
    clock += 1;
    const kept = signIn("A1", "admin");
    const phone = sessions.issue({ label: "phone", scopes: ["client"], principalId: evicted.principal.id, idp: { iss: ISS, sub: "A1" } });
    sessions.openPairing({ principalId: evicted.principal.id, scopes: ["client"] });
    vault.set({ grantRef: "rd-A1", iss: ISS, sub: "A1", refreshToken: "pxlr1.delegation-A1", createdAt: clock, refreshedAt: clock, lastOkAt: clock, kind: "routines", principalId: evicted.principal.id });
    clock += 1000;
    provider.script.push(REJ, REJ);
    manager.touch(evicted.record()!);
    await manager.settled();
    // the refused family's session ends; the freshest other one was checked and rotated
    expect(sessions.byId(evicted.sessionId)).toBeNull();
    expect(vault.get(evicted.grantRef)).toBeUndefined();
    expect(provider.calls).toHaveLength(3);
    expect(vault.get(kept.grantRef)).toMatchObject({ refreshToken: "pxlr1.rot1", lastOkAt: clock });
    // the person stays in: other sessions, paired devices, open codes, the delegation
    expect(principals.byId(evicted.principal.id)?.disabledAt).toBeUndefined();
    expect(sessions.byId(kept.sessionId)).not.toBeNull();
    expect(sessions.byId(phone.session.id)).not.toBeNull();
    expect(manager.mustRefuse(sessions.byId(phone.session.id)!)).toBeNull();
    expect(sessions.openPairings()).toHaveLength(1);
    expect(vault.get("rd-A1")).toBeDefined();
    expect(logs.some((line) => line.includes("person marked out"))).toBe(false);
  });

  it("a refused sign-in with a transient failure on the person's other sign-in keeps the person in", async () => {
    const { manager, provider, signIn, sessions, principals } = setup({ refreshAfterMs: 1000 });
    const first = signIn("A2");
    clock += 1;
    const second = signIn("A2");
    clock += 1000;
    provider.script.push(REJ, REJ, { ok: false, kind: "transient", error: "unreachable" });
    manager.touch(first.record()!);
    await manager.settled();
    expect(sessions.byId(first.sessionId)).toBeNull();
    expect(sessions.byId(second.sessionId)).not.toBeNull();
    expect(principals.byId(first.principal.id)?.disabledAt).toBeUndefined();
  });

  it("a refresh a crash interrupted is resumed at boot, at once (inside Perspicax's reuse grace)", async () => {
    const { manager, provider, vault, signIn, sessions } = setup({ refreshAfterMs: 1000 });
    const a = signIn("S1");
    signIn("S2");
    // the crash: the write-ahead mark is on disk, the answer never came back
    vault.set({ ...vault.get(a.grantRef)!, refreshStartedAt: clock });
    expect(manager.resumeInterrupted()).toBe(1);
    await manager.settled();
    expect(provider.calls).toEqual([`pxlr1.first-S1-${clock}`]);
    expect(vault.get(a.grantRef)).toMatchObject({ refreshToken: "pxlr1.rot1" });
    expect(vault.get(a.grantRef)?.refreshStartedAt).toBeUndefined();
    expect(sessions.byId(a.sessionId)).not.toBeNull();
    expect(manager.resumeInterrupted()).toBe(0);
  });

  it("a client refusal (invalid_client) is a deploy for 15 minutes, then ends the sign-in; an ignored id_token keeps the 24 h clock running", async () => {
    const { manager, provider, vault, signIn, sessions } = setup({ refreshAfterMs: 1000 });
    const a = signIn("S1");
    clock += 1000;
    provider.script.push({ ok: false, kind: "transient", error: "HTTP 401 (invalid_client)", clientRefused: true });
    manager.touch(a.record()!);
    await manager.settled();
    expect(sessions.byId(a.sessionId)).not.toBeNull();
    clock += IDP_CLIENT_REFUSED_GRACE_MS;
    provider.script.push({ ok: false, kind: "transient", error: "HTTP 401 (invalid_client)", clientRefused: true });
    manager.touch(a.record()!);
    await manager.settled();
    expect(sessions.byId(a.sessionId)).toBeNull();
    const b = signIn("S2");
    clock += 1000;
    provider.script.push({ ok: true, refreshToken: "pxlr1.unverified", note: "the refreshed id_token was ignored (bad signature)" });
    manager.touch(b.record()!);
    await manager.settled();
    expect(vault.get(b.grantRef)).toMatchObject({ refreshToken: "pxlr1.unverified", failingSince: clock });
  });

  it("a refresh never brings back a grant another process removed while it was out", async () => {
    const { manager, provider, vault, signIn } = setup({ refreshAfterMs: 1000 });
    const a = signIn("S1");
    clock += 1000;
    let release: (outcome: RefreshOutcome) => void = () => {};
    provider.script.push(new Promise<RefreshOutcome>((resolve) => { release = resolve; }));
    manager.touch(a.record()!);
    await Promise.resolve();
    const other = new IdpGrantVault(dir, () => ({ kind: "key", key: Buffer.from(KEY, "hex") }));
    other.delete(a.grantRef);
    release({ ok: true, refreshToken: "pxlr1.after-logout" });
    await manager.settled();
    expect(vault.get(a.grantRef)).toBeUndefined();
    expect(new IdpGrantVault(dir, () => ({ kind: "key", key: Buffer.from(KEY, "hex") })).get(a.grantRef)).toBeUndefined();
  });

  it("a rotated grant that cannot be written yet stays in memory, the session is kept, and the next write saves it", async () => {
    const { manager, vault, signIn, sessions, principals, provider } = setup({ refreshAfterMs: 1000 });
    const bob = signIn("B1");
    const phone = sessions.issue({ label: "phone", scopes: ["client"], principalId: bob.principal.id });
    clock += 1000;
    const internals = vault as unknown as { persist: (document: unknown) => void };
    const persist = internals.persist.bind(vault);
    internals.persist = () => { throw new Error("disk full"); };
    manager.touch(bob.record()!);
    await manager.settled();
    expect(sessions.byId(bob.sessionId)).not.toBeNull();
    expect(sessions.byId(phone.session.id)).not.toBeNull();
    expect(principals.byId(bob.principal.id)?.disabledAt).toBeUndefined();
    expect(vault.get(bob.grantRef)?.refreshToken).toBe("pxlr1.rot1");
    expect(provider.revoked).toEqual([]);
    internals.persist = persist;
    vault.set(vault.get(bob.grantRef)!);
    const reread = new IdpGrantVault(dir, () => ({ kind: "key", key: Buffer.from(KEY, "hex") }));
    expect(reread.get(bob.grantRef)?.refreshToken).toBe("pxlr1.rot1");
  });

  it("keeps the session on a transient failure, retries at 5 s and 15 s then each minute, and never ends it (24 hours of failures only pause it)", async () => {
    const { manager, provider, vault, signIn, sessions, advance } = setup({ refreshAfterMs: 1000 });
    const a = signIn("S1");
    clock += 1000;
    provider.script.push({ ok: false, kind: "transient", error: "HTTP 503" });
    manager.touch(a.record()!);
    await manager.settled();
    expect(sessions.byId(a.sessionId)).not.toBeNull();
    expect(vault.get(a.grantRef)).toMatchObject({ failedAt: clock, failingSince: clock });
    expect(manager.mustRefuse(a.record()!)).toBeNull();
    // the quick retries run on their own, inside Perspicax's reuse grace
    provider.script.push({ ok: false, kind: "transient", error: "timeout" });
    advance(IDP_QUICK_RETRY_MS[0]!);
    await manager.settled();
    expect(provider.calls).toHaveLength(2);
    provider.script.push({ ok: false, kind: "transient", error: "timeout" });
    advance(IDP_QUICK_RETRY_MS[1]!);
    await manager.settled();
    expect(provider.calls).toHaveLength(3);
    // then no new attempt inside the minute
    clock += IDP_RETRY_AFTER_FAILURE_MS - 1;
    manager.touch(a.record()!);
    await manager.settled();
    expect(provider.calls).toHaveLength(3);
    // failing, observed, for a day: not served (503 upstream), never ended
    const since = vault.get(a.grantRef)!.failingSince!;
    clock = since + IDP_UNREACHABLE_GRACE_MS;
    provider.script.push({ ok: false, kind: "transient", error: "timeout" });
    manager.touch(a.record()!);
    await manager.settled();
    expect(vault.get(a.grantRef)!.failingSince).toBe(since);
    expect(manager.mustRefuse(a.record()!)).toBe("idp_unreachable");
    expect(sessions.byId(a.sessionId)).not.toBeNull();
    // Perspicax answers again: served again
    clock += IDP_RETRY_AFTER_FAILURE_MS;
    manager.touch(a.record()!);
    await manager.settled();
    expect(vault.get(a.grantRef)!.failingSince).toBeUndefined();
    expect(manager.mustRefuse(a.record()!)).toBeNull();
    // one failure, then a quiet weekend: the next request just refreshes
    const b = signIn("S2");
    clock += 1000;
    provider.script.push({ ok: false, kind: "transient", error: "timeout" });
    manager.touch(b.record()!);
    await manager.settled();
    clock += IDP_UNREACHABLE_GRACE_MS * 2;
    expect(manager.mustRefuse(b.record()!)).toBeNull();
  });

  it("refuses a provider session with no grant", () => {
    const { manager, sessions, vault, signIn } = setup();
    const a = signIn("S1");
    vault.delete(a.grantRef);
    expect(manager.mustRefuse(a.record()!)).toBe("idp_session_ended");
    const legacy = sessions.issue({ label: "slice 1", scopes: ["client"], idp: { iss: ISS, sub: "S9" } });
    expect(manager.mustRefuse(sessions.byId(legacy.session.id)!)).toBe("idp_session_ended");
    const paired = sessions.issue({ label: "phone", scopes: ["client"] });
    expect(manager.mustRefuse(sessions.byId(paired.session.id)!)).toBeNull();
  });

  it("a device paired from a signed-in session follows its person's live grants, and ends with the last one", async () => {
    const { manager, sessions, signIn } = setup();
    const web = signIn("P1", "admin");
    const phone = sessions.issue({ label: "phone", scopes: ["admin", "client"], principalId: web.principal.id, idp: { iss: ISS, sub: "P1" } });
    const record = () => sessions.byId(phone.session.id)!;
    expect(manager.mustRefuse(record())).toBeNull();
    // an unbound grant (a native sign-in not yet exchanged) does not keep it
    manager.createGrant({ iss: ISS, sub: "P1", refreshToken: "pxlr1.unbound", bindBy: clock + 60_000 });
    sessions.revoke(web.sessionId);
    expect(manager.mustRefuse(record())).toBe("idp_session_ended");
    // another person's live grant does not either
    signIn("P2");
    expect(manager.mustRefuse(record())).toBe("idp_session_ended");
  });

  it("a device with no grant of its own is refused as unreachable when every grant of its person is past the grace", async () => {
    const { manager, sessions, vault, signIn } = setup();
    const web = signIn("P1");
    const phone = sessions.issue({ label: "phone", scopes: ["client"], principalId: web.principal.id, idp: { iss: ISS, sub: "P1" } });
    vault.set({ ...vault.get(web.grantRef)!, failingSince: clock, failedAt: clock + IDP_UNREACHABLE_GRACE_MS });
    clock += IDP_UNREACHABLE_GRACE_MS;
    expect(manager.mustRefuse(sessions.byId(phone.session.id)!)).toBe("idp_unreachable");
    const web2 = signIn("P1");
    expect(manager.mustRefuse(sessions.byId(phone.session.id)!)).toBeNull();
    expect(web2.grantRef).toBeTruthy();
  });

  it("a device with no grant of its own refreshes its person's freshest grant: a demotion narrows it, a refusal ends it", async () => {
    const { manager, provider, sessions, vault, signIn } = setup({ refreshAfterMs: 1000 });
    const older = signIn("P1", "admin");
    clock += 10;
    const newer = signIn("P1", "admin");
    const phone = sessions.issue({ label: "phone", scopes: ["admin", "client"], principalId: older.principal.id, idp: { iss: ISS, sub: "P1" } });
    clock += 1000;
    provider.script.push({ ok: true, refreshToken: "pxlr1.demoted", identity: { iss: ISS, sub: "P1", role: "employee" } });
    manager.touch(sessions.byId(phone.session.id)!);
    await manager.settled();
    expect(provider.calls).toEqual([`pxlr1.first-P1-${clock - 1000}`]);
    expect(vault.get(newer.grantRef)!.refreshToken).toBe("pxlr1.demoted");
    expect(sessions.byId(phone.session.id)!.scopes).toEqual(["client"]);
    clock += 1000;
    // the person is out: the grant tried and the other one checked are both refused (each twice)
    provider.script.push(REJ, REJ, REJ, REJ);
    manager.touch(sessions.byId(phone.session.id)!);
    await manager.settled();
    expect(sessions.byId(phone.session.id)).toBeNull();
    expect(sessions.byId(older.sessionId)).toBeNull();
  });

  it("clamps a device with no grant of its own to its person's organization role", () => {
    const { manager, sessions, signIn } = setup();
    const web = signIn("P1", "admin");
    const phone = sessions.issue({ label: "phone", scopes: ["admin", "client"], principalId: web.principal.id, idp: { iss: ISS, sub: "P1" } });
    const record = sessions.byId(phone.session.id)!;
    expect(manager.clampScopes(record, "admin")).toBeNull();
    expect(manager.clampScopes(record, "member")).toEqual(["client"]);
    expect(manager.clampScopes(record, undefined)).toEqual(["client"]);
    // a session on its own grant follows its refresh instead
    expect(manager.clampScopes(web.record()!, "member")).toBeNull();
  });

  it("follows a role change: the grant's sessions take the new scopes, the person's other devices only narrow", async () => {
    const { manager, provider, signIn, sessions, principals } = setup({ refreshAfterMs: 1000 });
    const carol = signIn("C1", "admin");
    // a phone Carol paired with an admin code, and a chat-only one
    const phone = sessions.issue({ label: "phone", scopes: ["admin", "client"], principalId: carol.principal.id });
    const chat = sessions.issue({ label: "chat", scopes: ["client"], principalId: carol.principal.id });
    clock += 1000;
    provider.script.push({ ok: true, refreshToken: "pxlr1.r", identity: { iss: ISS, sub: "C1", role: "employee", name: "Carol" } });
    manager.touch(carol.record()!);
    await manager.settled();
    expect(carol.record()).toMatchObject({ scopes: ["client"], idp: { role: "employee" } });
    expect(sessions.byId(phone.session.id)!.scopes).toEqual(["client"]);
    expect(sessions.byId(chat.session.id)!.scopes).toEqual(["client"]);
    expect(principals.byId(carol.principal.id)).toMatchObject({ orgRole: "member", name: "Carol" });
    // promoted again: the grant's own session widens, the others do not
    clock += 1000;
    provider.script.push({ ok: true, refreshToken: "pxlr1.r2", identity: { iss: ISS, sub: "C1", role: "admin" } });
    manager.touch(carol.record()!);
    await manager.settled();
    expect(carol.record()!.scopes).toEqual(["admin", "client"]);
    expect(sessions.byId(phone.session.id)!.scopes).toEqual(["client"]);
    // a role that no longer signs in ends the grant
    clock += 1000;
    provider.script.push({ ok: true, refreshToken: "pxlr1.r3", identity: { iss: ISS, sub: "C1", role: "service" } });
    manager.touch(carol.record()!);
    await manager.settled();
    expect(carol.record()).toBeNull();
  });

  it("revokes a rotated token that arrives after the session was released", async () => {
    const { manager, provider, signIn, sessions } = setup({ refreshAfterMs: 1000 });
    const a = signIn("S1");
    clock += 1000;
    let answer!: (value: RefreshOutcome) => void;
    provider.script.push(new Promise<RefreshOutcome>((resolve) => { answer = resolve; }));
    manager.touch(a.record()!);
    sessions.revoke(a.sessionId);
    expect(provider.revoked).toHaveLength(1); // the grant went with the session
    answer({ ok: true, refreshToken: "pxlr1.late" });
    await manager.settled();
    expect(provider.revoked).toContain("pxlr1.late");
  });
});

describe("release, sweep and back-channel logout", () => {
  it("releases a grant once when its session ends (logout, admin revoke, expiry)", async () => {
    const { manager, provider, vault, signIn, sessions } = setup();
    const a = signIn("S1");
    sessions.revoke(a.sessionId);
    sessions.revoke(a.sessionId);
    await manager.settled();
    expect(provider.revoked).toEqual([expect.stringMatching(/^pxlr1\.first-S1/)]);
    expect(vault.get(a.grantRef)).toBeUndefined();
    const b = signIn("S2");
    clock += 31 * 24 * 60 * 60_000; // past the session term
    sessions.list(); // prune
    expect(vault.get(b.grantRef)).toBeUndefined();
    expect(provider.revoked).toHaveLength(2);
  });

  it("sweeps an unredeemed desktop or phone grant after its window, and one whose session is gone", () => {
    const { manager, provider, vault, sessions, principals, signIn } = setup();
    const p = principals.forSubject({ iss: ISS, sub: "D1", orgRole: "member" });
    const pending = manager.createGrant({ iss: ISS, sub: "D1", refreshToken: "pxlr1.pending", bindBy: clock + 180_000 });
    const redeemed = manager.createGrant({ iss: ISS, sub: "D1", refreshToken: "pxlr1.redeemed", bindBy: clock + 180_000 });
    const pairing = sessions.openPairing({ principalId: p.id, scopes: ["client"], ttlMs: 120_000, idp: { iss: ISS, sub: "D1", role: "employee", grantRef: redeemed } });
    const exchanged = sessions.exchange({ code: pairing.credential, label: "desktop", source: "x" });
    expect(exchanged.ok).toBe(true);
    expect(vault.get(redeemed)?.sessionId).toBe(exchanged.ok ? exchanged.session.id : "");
    const web = signIn("W1");
    expect(manager.sweep()).toBe(0);
    clock += 180_001;
    expect(manager.sweep()).toBe(1);
    expect(vault.get(pending)).toBeUndefined();
    expect(provider.revoked).toEqual(["pxlr1.pending"]);
    // an orphan: its session vanished without the listener (unclean restart)
    const orphanVault = vault.get(web.grantRef)!;
    vault.set({ ...orphanVault, sessionId: "gone" });
    expect(manager.sweep()).toBe(1);
    expect(provider.revoked).toContain(orphanVault.refreshToken);
    expect(vault.get(redeemed)).toBeDefined();
  });

  it("revokes an unredeemed native grant at the provider as soon as its window closes, not at the next periodic sweep", async () => {
    const { manager, provider, vault, advance } = setup();
    // a desktop sign-in: 120 s credential plus the bind grace
    const pending = manager.createGrant({ iss: ISS, sub: "D2", refreshToken: "pxlr1.never-redeemed", bindBy: clock + 180_000 });
    advance(180_000);
    expect(vault.get(pending)).toBeDefined();
    advance(IDP_SWEEP_SLACK_MS);
    expect(vault.get(pending)).toBeUndefined();
    await manager.settled();
    expect(provider.revoked).toEqual(["pxlr1.never-redeemed"]);
    // the periodic backstop (a restart lost the timer) is at most a minute late
    expect(IDP_SWEEP_INTERVAL_MS).toBeLessThanOrEqual(60_000);
  });

  it("back-channel logout revokes by subject and by principal, drops grants silently, cancels codes and marks the person out", async () => {
    const { manager, provider, vault, sessions, principals, signIn } = setup();
    const bob = signIn("B1");
    const bob2 = signIn("B1");
    const bobPhone = sessions.issue({ label: "phone", scopes: ["client"], principalId: bob.principal.id });
    const unbound = manager.createGrant({ iss: ISS, sub: "B1", refreshToken: "pxlr1.unbound", bindBy: clock + 180_000 });
    sessions.openPairing({ principalId: bob.principal.id, scopes: ["client"] });
    const alice = signIn("A1", "admin");
    const done = manager.backchannelLogout({ iss: ISS, sub: "B1" });
    expect(done).toEqual({ sessions: 3, pairings: 1 });
    for (const id of [bob.sessionId, bob2.sessionId, bobPhone.session.id]) expect(sessions.byId(id)).toBeNull();
    expect(vault.get(bob.grantRef)).toBeUndefined();
    expect(vault.get(unbound)).toBeUndefined();
    await manager.settled();
    expect(provider.revoked).toEqual([]);
    expect(sessions.openPairings()).toHaveLength(0);
    expect(principals.byId(bob.principal.id)?.disabledAt).toBe(clock);
    expect(sessions.byId(alice.sessionId)).not.toBeNull();
    // an unknown subject: nothing happens
    expect(manager.backchannelLogout({ iss: ISS, sub: "nobody" })).toEqual({ sessions: 0, pairings: 0 });
    // signing in again clears the mark, same person
    const back = signIn("B1");
    expect(back.principal.id).toBe(bob.principal.id);
    expect(principals.byId(bob.principal.id)?.disabledAt).toBeUndefined();
  });
});

describe("a demotion the Perspicax directory reports (slice 3)", () => {
  it("narrows every session of the person at once and ends one left with nothing", () => {
    const { manager, sessions, signIn } = setup();
    const carol = signIn("C1", "admin");
    const adminOnly = sessions.issue({ label: "admin device", scopes: ["admin"], principalId: carol.principal.id, idp: { iss: ISS, sub: "C1", role: "admin" } });
    expect(manager.narrowToOrgRole(carol.principal.id, "member")).toBe(2);
    expect(carol.record()?.scopes).toEqual(["client"]);
    expect(sessions.byId(adminOnly.session.id)).toBeNull();
    // nothing left to narrow; an admin role never widens here
    expect(manager.narrowToOrgRole(carol.principal.id, "member")).toBe(0);
    expect(manager.narrowToOrgRole(carol.principal.id, "admin")).toBe(0);
    expect(carol.record()?.scopes).toEqual(["client"]);
  });
});

describe("teams on refresh (slice 4)", () => {
  it("a refreshed id_token's teams replace the person's, an absent claim leaves them, and the access listener fires", async () => {
    const { manager, provider, signIn, principals } = setup({ refreshAfterMs: 1000 });
    const changed: string[] = [];
    principals.onAccessChanged((id) => changed.push(id));
    const carol = signIn("C4");
    clock += 1000;
    provider.script.push({ ok: true, refreshToken: "pxlr1.t1", identity: { iss: ISS, sub: "C4", role: "employee", teams: [{ id: "T", name: "Team T", manager: false }] } });
    manager.touch(carol.record()!);
    await manager.settled();
    expect(principals.byId(carol.principal.id)).toMatchObject({ teams: [{ id: "T", manager: false }], perspicaxRole: "employee" });
    expect(changed).toEqual([carol.principal.id]);
    clock += 1000;
    provider.script.push({ ok: true, refreshToken: "pxlr1.t2", identity: { iss: ISS, sub: "C4", role: "employee" } });
    manager.touch(carol.record()!);
    await manager.settled();
    expect(principals.byId(carol.principal.id)?.teams).toEqual([{ id: "T", manager: false }]);
    clock += 1000;
    provider.script.push({ ok: true, refreshToken: "pxlr1.t3", identity: { iss: ISS, sub: "C4", role: "employee", teams: [] } });
    manager.touch(carol.record()!);
    await manager.settled();
    expect(principals.byId(carol.principal.id)?.teams).toBeUndefined();
    expect(changed).toEqual([carol.principal.id, carol.principal.id]);
  });
});

describe("the sign-in access token as a token exchange subject (slice 5)", () => {
  it("returns the cached access token while at least 10 minutes remain, without a refresh", async () => {
    const { manager, provider, signIn } = setup();
    signIn("S1", "employee", undefined, { accessToken: "pxlo1.S1.access-one", accessExpiresAt: clock + 3_600_000 });
    await expect(manager.subjectToken({ iss: ISS, sub: "S1" })).resolves.toEqual({ ok: true, token: "pxlo1.S1.access-one", expiresAt: clock + 3_600_000 });
    clock += 3_600_000 - IDP_SUBJECT_MIN_LIFE_MS;
    await expect(manager.subjectToken({ iss: ISS, sub: "S1" })).resolves.toMatchObject({ ok: true, token: "pxlo1.S1.access-one" });
    expect(provider.calls).toEqual([]);
  });

  it("refreshes the grant when less than 10 minutes remain, and keeps the new access token", async () => {
    const { manager, provider, vault, signIn } = setup();
    const a = signIn("S1", "employee", undefined, { accessToken: "pxlo1.S1.old", accessExpiresAt: clock + 3_600_000 });
    clock += 3_600_000 - IDP_SUBJECT_MIN_LIFE_MS + 1;
    provider.script.push({ ok: true, refreshToken: "pxlr1.next", accessToken: "pxlo1.S1.new", expiresIn: 3600 });
    const got = await manager.subjectToken({ iss: ISS, sub: "S1" });
    expect(got).toEqual({ ok: true, token: "pxlo1.S1.new", expiresAt: clock + 3_600_000 });
    expect(provider.calls).toHaveLength(1);
    expect(vault.get(a.grantRef)?.refreshToken).toBe("pxlr1.next");
    // a grant with no access token yet (signed in before this build) refreshes too
    signIn("S2");
    provider.script.push({ ok: true, refreshToken: "pxlr1.s2", accessToken: "pxlo1.S2.a", expiresIn: 900 });
    await expect(manager.subjectToken({ iss: ISS, sub: "S2" })).resolves.toMatchObject({ ok: true, token: "pxlo1.S2.a" });
  });

  it("touch and subjectToken at the same moment make one provider refresh", async () => {
    const { manager, provider, signIn } = setup({ refreshAfterMs: 1000 });
    const a = signIn("S1", "employee", undefined, { accessToken: "pxlo1.S1.old", accessExpiresAt: clock + 60_000 });
    clock += 1000;
    let release!: (outcome: RefreshOutcome) => void;
    provider.script.push(new Promise<RefreshOutcome>((resolve) => { release = resolve; }));
    const touched = manager.touch(a.record()!);
    const subject = manager.subjectToken({ iss: ISS, sub: "S1" });
    const touchedAgain = manager.touch(a.record()!);
    expect(touchedAgain).toBe(touched);
    release({ ok: true, refreshToken: "pxlr1.once", accessToken: "pxlo1.S1.once", expiresIn: 3600 });
    await touched;
    await expect(subject).resolves.toMatchObject({ ok: true, token: "pxlo1.S1.once" });
    expect(provider.calls).toHaveLength(1);
    // and the other way round: a subject refresh in flight is joined by touch
    clock += 3_600_000;
    let second!: (outcome: RefreshOutcome) => void;
    provider.script.push(new Promise<RefreshOutcome>((resolve) => { second = resolve; }));
    const subject2 = manager.subjectToken({ iss: ISS, sub: "S1" });
    await Promise.resolve();
    void manager.touch(a.record()!);
    second({ ok: true, refreshToken: "pxlr1.twice", accessToken: "pxlo1.S1.twice", expiresIn: 3600 });
    await expect(subject2).resolves.toMatchObject({ ok: true, token: "pxlo1.S1.twice" });
    await manager.settled();
    expect(provider.calls).toHaveLength(2);
  });

  it("a refresh rejected twice answers ended and ends that sign-in", async () => {
    const { manager, provider, signIn, sessions, principals } = setup();
    const a = signIn("S1", "employee", undefined, { accessToken: "pxlo1.S1.old", accessExpiresAt: clock + 1000 });
    provider.script.push(REJ, REJ);
    await expect(manager.subjectToken({ iss: ISS, sub: "S1" })).resolves.toEqual({ ok: false, error: "ended" });
    expect(sessions.byId(a.sessionId)).toBeNull();
    expect(principals.byId(a.principal.id)?.disabledAt).toBe(clock);
    await expect(manager.subjectToken({ iss: ISS, sub: "S1" })).resolves.toEqual({ ok: false, error: "no_session" });
  });

  it("a transient failure answers unreachable and waits the retry delay before the next attempt", async () => {
    const { manager, provider, signIn, sessions } = setup();
    const a = signIn("S1", "employee", undefined, { accessToken: "pxlo1.S1.old", accessExpiresAt: clock + 1000 });
    provider.script.push({ ok: false, kind: "transient", error: "HTTP 503" });
    await expect(manager.subjectToken({ iss: ISS, sub: "S1" })).resolves.toEqual({ ok: false, error: "unreachable" });
    expect(sessions.byId(a.sessionId)).not.toBeNull();
    await expect(manager.subjectToken({ iss: ISS, sub: "S1" })).resolves.toEqual({ ok: false, error: "unreachable" });
    expect(provider.calls).toHaveLength(1);
    clock += IDP_RETRY_AFTER_FAILURE_MS;
    provider.script.push({ ok: true, refreshToken: "pxlr1.back", accessToken: "pxlo1.S1.back", expiresIn: 3600 });
    await expect(manager.subjectToken({ iss: ISS, sub: "S1" })).resolves.toMatchObject({ ok: true, token: "pxlo1.S1.back" });
    // a refresh that hangs is waited on for a bounded time only
    expect(IDP_REFRESH_WAIT_MS).toBeLessThanOrEqual(5_000);
  });

  it("answers no_session without a live sign-in, and drops the token with the grant", async () => {
    const { manager, signIn, sessions } = setup();
    await expect(manager.subjectToken({ iss: ISS, sub: "nobody" })).resolves.toEqual({ ok: false, error: "no_session" });
    const a = signIn("S1", "employee", undefined, { accessToken: "pxlo1.S1.gone", accessExpiresAt: clock + 3_600_000 });
    sessions.revokeWhere((session) => session.id === a.sessionId);
    await expect(manager.subjectToken({ iss: ISS, sub: "S1" })).resolves.toEqual({ ok: false, error: "no_session" });
    const b = signIn("S2", "employee", undefined, { accessToken: "pxlo1.S2.gone", accessExpiresAt: clock + 3_600_000 });
    manager.backchannelLogout({ iss: ISS, sub: "S2" });
    expect(sessions.byId(b.sessionId)).toBeNull();
    await expect(manager.subjectToken({ iss: ISS, sub: "S2" })).resolves.toEqual({ ok: false, error: "no_session" });
  });

  it("never writes an access token to the vault file or a log line", async () => {
    const { manager, provider, signIn, logs } = setup();
    signIn("S1", "employee", undefined, { accessToken: "pxlo1.S1.secret-sign-in", accessExpiresAt: clock + 1000 });
    provider.script.push({ ok: true, refreshToken: "pxlr1.r", accessToken: "pxlo1.S1.secret-refreshed", expiresIn: 3600 });
    await manager.subjectToken({ iss: ISS, sub: "S1" });
    provider.script.push({ ok: false, kind: "transient", error: "HTTP 503" });
    clock += 3_600_000;
    await manager.subjectToken({ iss: ISS, sub: "S1" });
    const raw = readFileSync(join(dir, IDP_VAULT_FILE), "utf8");
    const key = Buffer.from(KEY, "hex");
    const plain = JSON.stringify(new IdpGrantVault(dir, () => ({ kind: "key", key })).list());
    for (const text of [raw, plain, logs.join("\n")]) {
      expect(text).not.toContain("secret-sign-in");
      expect(text).not.toContain("secret-refreshed");
    }
  });
});

describe("routine delegations beside the sign-in grants (slice 6)", () => {
  const delegation = (principalId: string, sub: string, at: number) => ({
    grantRef: `rd-${sub}`, iss: ISS, sub, refreshToken: `pxlr1.delegation-${sub}`, createdAt: at, refreshedAt: at, lastOkAt: at, kind: "routines" as const, principalId,
  });

  it("keeps a routines grant through the sweep, release, a rejected sign-in refresh and a back-channel logout", async () => {
    const { manager, provider, vault, signIn, sessions } = setup({ refreshAfterMs: 1000 });
    const bob = signIn("B1");
    vault.set(delegation(bob.principal.id, "B1", clock));
    expect(vault.get("rd-B1")?.kind).toBe("routines");
    // older grants read back as sign-ins
    expect(vault.get(bob.grantRef)?.kind).toBe("session");
    clock += 5 * 60_000;
    expect(manager.sweep()).toBe(0);
    sessions.revoke(bob.sessionId);
    await manager.settled();
    expect(vault.get("rd-B1")).toBeDefined();
    const again = signIn("B1");
    clock += 1000;
    provider.script.push(REJ, REJ);
    manager.touch(again.record()!);
    await manager.settled();
    expect(vault.get(again.grantRef)).toBeUndefined();
    expect(vault.get("rd-B1")).toBeDefined();
    signIn("B1");
    manager.backchannelLogout({ iss: ISS, sub: "B1" });
    expect(vault.get("rd-B1")).toBeDefined();
    await new Promise((resolve) => setImmediate(resolve));
    expect(provider.revoked).not.toContain("pxlr1.delegation-B1");
  });

  it("never serves a routines grant as a session's subject token or refreshes it on touch", async () => {
    const { manager, provider, vault, principals } = setup({ refreshAfterMs: 1000 });
    const p = principals.forSubject({ iss: ISS, sub: "C1", orgRole: "member" });
    vault.set({ ...delegation(p.id, "C1", clock), sessionId: "not-a-session" });
    clock += 60 * 60_000;
    expect(await manager.subjectToken({ iss: ISS, sub: "C1" })).toEqual({ ok: false, error: "no_session" });
    const session = { id: "x", idp: { iss: ISS, sub: "C1", role: "employee", grantRef: "rd-C1" } } as unknown as Parameters<IdpSessionManager["touch"]>[0];
    await manager.touch(session);
    expect(provider.calls).toEqual([]);
    expect(manager.mustRefuse(session)).toBe("idp_session_ended");
  });
});

describe("rate limits (slice 6, fix 2)", () => {
  const limited = (retryAfterMs = 60_000): RefreshOutcome => ({ ok: false, kind: "transient", rateLimited: true, retryAfterMs, error: `Perspicax is rate limiting this server (retry in ${retryAfterMs / 1000} s)` });

  it("25 hours of 429 answers never end a session; 25 hours of network errors still do", async () => {
    const { manager, provider, vault, signIn, sessions, logs } = setup({ refreshAfterMs: 1000 });
    const a = signIn("S1");
    const end = clock + 25 * 3_600_000;
    while (clock < end) {
      clock += 600_000;
      provider.script.push(limited());
      manager.touch(a.record()!);
      await manager.settled();
    }
    expect(vault.get(a.grantRef)?.failingSince).toBeUndefined();
    expect(manager.mustRefuse(a.record()!)).toBeNull();
    expect(sessions.byId(a.sessionId)).not.toBeNull();
    expect(logs).toContain("idp: renewal deferred (Perspicax is rate limiting this server; retry in 60 s)");

    const b = signIn("S2");
    const stop = clock + 25 * 3_600_000;
    while (clock < stop) {
      clock += 600_000;
      provider.script.push({ ok: false, kind: "transient", error: "the identity provider could not be reached" });
      manager.touch(b.record()!);
      await manager.settled();
    }
    expect(manager.mustRefuse(b.record()!)).toBe("idp_unreachable");
  });

  it("waits max(60 s, Retry-After) before the next attempt, and answers rate_limited meanwhile", async () => {
    const { manager, provider, signIn } = setup({ refreshAfterMs: 1000 });
    const a = signIn("S1", "employee", undefined, { accessToken: "pxlo1.S1.old", accessExpiresAt: clock + 1000 });
    provider.script.push(limited(120_000));
    await expect(manager.subjectToken({ iss: ISS, sub: "S1" })).resolves.toEqual({ ok: false, error: "rate_limited", retryAfterMs: 120_000 });
    clock += 90_000;
    manager.touch(a.record()!);
    await manager.settled();
    await expect(manager.subjectToken({ iss: ISS, sub: "S1" })).resolves.toEqual({ ok: false, error: "rate_limited", retryAfterMs: 30_000 });
    expect(provider.calls).toHaveLength(1);
    clock += 30_000;
    provider.script.push({ ok: true, refreshToken: "pxlr1.back", accessToken: "pxlo1.S1.back", expiresIn: 3600 });
    await expect(manager.subjectToken({ iss: ISS, sub: "S1" })).resolves.toMatchObject({ ok: true, token: "pxlo1.S1.back" });
    // A short Retry-After still waits the minute.
    const b = signIn("S2", "employee", undefined, { accessToken: "pxlo1.S2.old", accessExpiresAt: clock + 1000 });
    provider.script.push(limited(5_000));
    await manager.subjectToken({ iss: ISS, sub: "S2" });
    clock += 30_000;
    manager.touch(b.record()!);
    await manager.settled();
    expect(provider.calls).toHaveLength(3);
  });

  it("sends 120 releases in one tick through the queue at most 35 a rolling minute with a budget of 45, all within 4 minutes", async () => {
    const pacer = new TokenCallPacer({ budget: 45, now: () => clock });
    const sent: number[] = [];
    const queue = new RevocationQueue({
      dataDir: dir,
      keySource: () => ({ kind: "key", key: Buffer.from(KEY, "hex") }),
      pacer,
      send: async (): Promise<RevokeAttempt> => { sent.push(clock); return { kind: "done" }; },
      now: () => clock,
      log: () => {},
      schedule: () => () => {},
    });
    const { signIn, sessions } = setup({ revocations: queue });
    const ids = Array.from({ length: 120 }, (_, i) => signIn(`S${i}`).sessionId);
    const start = clock;
    sessions.revokeWhere((session) => ids.includes(session.id));
    expect(queue.size()).toBe(120);
    while (sent.length < 120 && clock - start <= 4 * 60_000) {
      await queue.pump();
      clock += 1_000;
    }
    expect(sent).toHaveLength(120);
    expect(Math.max(...sent) - start).toBeLessThanOrEqual(4 * 60_000);
    for (const at of sent) expect(sent.filter((other) => other >= at && other < at + 60_000).length).toBeLessThanOrEqual(35);
    expect(queue.size()).toBe(0);
  });
});
