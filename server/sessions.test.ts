import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as atomic from "./atomic.ts";

import {
  ENDED_SESSION_MEMORY_MS,
  EXCHANGE_REPLAY_MS,
  formatPairingCode,
  generatePairingCode,
  generatePairingCredential,
  isPairingCredential,
  LOCKOUT,
  normalizePairingCode,
  PAIRING_CODE_ALPHABET,
  PAIRING_CODE_TTL_MS,
  PAIRING_RESTART_HINT_MS,
  SESSION_TTL_MS,
  BOT_ACT_SESSION_TTL_MS,
  isBotActSession,
  SessionRegistry,
  STREAM_TICKET_TTL_MS,
  SESSION_MAX_AGE_MS,
  cookieMaxAgeSeconds,
  daysMs,
} from "./sessions.ts";

let dir: string;
let clock: number;
let registry: SessionRegistry;
const file = () => join(dir, "sessions.json");

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "omb-sessions-"));
  clock = 1_700_000_000_000;
  registry = new SessionRegistry({ file: file(), now: () => clock });
});
afterEach(() => { vi.restoreAllMocks(); rmSync(dir, { recursive: true, force: true }); });

describe("the native-app encoding of a pairing window", () => {
  it("redeems the same window as the typed code, and consumes it", () => {
    const { code, credential } = registry.openPairing({ label: "Pixel" });
    // The shape the Android companion's parser demands: the 9-character
    // prefix plus exactly 43 base64url characters (Connection.kt).
    expect(credential.startsWith("omb_pair_")).toBe(true);
    expect(credential.length).toBe(52);
    expect(credential.slice("omb_pair_".length)).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const paired = registry.exchange({ code: credential, label: "Pixel", source: "10.0.0.9" });
    expect(paired.ok).toBe(true);
    // One window, not two: the code cannot redeem it a second time.
    expect(registry.exchange({ code, label: "again", source: "10.0.0.9" }).ok).toBe(false);
    expect(registry.openPairings()).toEqual([]);
  });

  it("never normalizes a credential", () => {
    // normalizePairingCode folds 0 to O and 1 to I and strips underscores
    // and dashes. Running it over a base64url secret would both destroy the
    // secret and map distinct secrets onto one digest, so a credential must
    // be hashed exactly as presented. This is the trap the fix exists to
    // avoid, so pin it with a credential that contains every folded symbol.
    const trap = "omb_pair_0123456789-_abcdefghijklmnopqrstuvwxyzABCDE";
    expect(trap.length).toBe(52);
    expect(normalizePairingCode(trap)).not.toBe(trap);
    expect(isPairingCredential(trap)).toBe(true);

    const { credential } = registry.openPairing();
    // A different credential that normalizes to the same thing must not open
    // someone else's window.
    expect(registry.exchange({ code: trap, label: "", source: "attacker" }).ok).toBe(false);
    expect(registry.exchange({ code: credential, label: "", source: "friend" }).ok).toBe(true);
  });

  it("keeps two live windows apart", () => {
    const first = registry.openPairing({ label: "one" });
    const second = registry.openPairing({ label: "two" });
    const paired = registry.exchange({ code: second.credential, label: "", source: "10.0.0.4" });
    if (!paired.ok) throw new Error(paired.error);
    expect(paired.session.label).toBe("two");
    // The first window is untouched and still redeemable by its own code.
    expect(registry.exchange({ code: first.code, label: "", source: "10.0.0.4" }).ok).toBe(true);
  });

  it("expires with its window and is counted by the same lockout", () => {
    const { credential } = registry.openPairing();
    clock += PAIRING_CODE_TTL_MS + 1;
    expect(registry.exchange({ code: credential, label: "", source: "b" }).ok).toBe(false);

    for (let attempt = 0; attempt < LOCKOUT.failures; attempt += 1) {
      registry.exchange({ code: generatePairingCredential(), label: "", source: "attacker" });
    }
    const locked = registry.exchange({ code: registry.openPairing().credential, label: "", source: "attacker" });
    expect(locked.ok).toBe(false);
    if (locked.ok) throw new Error("expected a lockout");
    expect(locked.status).toBe(429);
  });

  it("mints a fresh credential for every window", () => {
    const seen = new Set([...Array(20)].map(() => registry.openPairing().credential));
    expect(seen.size).toBe(20);
  });
});

describe("a browser sign-in window (an OMB Cloud page's \"Use in your browser\")", () => {
  it("is redeemed only by a browser sign-in, only by its credential, and only once", () => {
    const { code, credential } = registry.openPairing({ scopes: ["admin", "client"], label: "Web browser", browser: true });
    // Not by an app or a typed code, which leave it open.
    expect(registry.exchange({ code: credential, label: "", source: "10.0.0.5" }).ok).toBe(false);
    expect(registry.exchange({ code, label: "", source: "10.0.0.5", browser: true }).ok).toBe(false);
    expect(registry.openPairings()).toHaveLength(1);
    const signedIn = registry.exchange({ code: credential, label: "Safari on iPad", source: "10.0.0.5", browser: true });
    expect(signedIn).toMatchObject({ ok: true, session: { label: "Safari on iPad", scopes: ["admin", "client"] } });
    // A replay, from anywhere and either way, is refused.
    expect(registry.exchange({ code: credential, label: "", source: "10.0.0.6", browser: true }).ok).toBe(false);
    expect(registry.exchange({ code: credential, label: "", source: "10.0.0.6" }).ok).toBe(false);
  });

  it("never redeems an ordinary window, and expires with its own term", () => {
    const ordinary = registry.openPairing({ label: "Pixel" });
    expect(registry.exchange({ code: ordinary.credential, label: "", source: "10.0.0.7", browser: true }).ok).toBe(false);
    expect(registry.exchange({ code: ordinary.code, label: "", source: "10.0.0.7", browser: true }).ok).toBe(false);
    expect(registry.exchange({ code: ordinary.credential, label: "", source: "10.0.0.7" }).ok).toBe(true);
    const { credential } = registry.openPairing({ ttlMs: 120_000, browser: true });
    clock += 120_000;
    expect(registry.exchange({ code: credential, label: "", source: "10.0.0.7", browser: true }).ok).toBe(false);
  });

  it("answers a lost-response retry only as the same kind of sign-in", () => {
    const { credential } = registry.openPairing({ browser: true });
    const first = registry.exchange({ code: credential, label: "", source: "10.0.0.8", attemptId: "attempt-browser-1", browser: true });
    expect(first.ok).toBe(true);
    expect(registry.exchange({ code: credential, label: "", source: "10.0.0.8", attemptId: "attempt-browser-1", browser: true })).toEqual(first);
    expect(registry.exchange({ code: credential, label: "", source: "10.0.0.8", attemptId: "attempt-browser-1" }).ok).toBe(false);
  });

  it("names its owner before anything is redeemed, and gives its session that owner and the cookie alone", () => {
    const { credential } = registry.openPairing({ browser: true, owner: "ada@example.test", ttlMs: 120_000 });
    // Showing it consumes nothing, and only a browser sign-in's own credential matches.
    expect(registry.previewBrowserSignIn(credential)).toEqual({ owner: "ada@example.test", expiresAt: clock + 120_000 });
    expect(registry.previewBrowserSignIn(credential)).toEqual({ owner: "ada@example.test", expiresAt: clock + 120_000 });
    const ordinary = registry.openPairing({ owner: "ignored@example.test" });
    expect(registry.previewBrowserSignIn(ordinary.credential)).toBeNull();
    expect(registry.previewBrowserSignIn(ordinary.code)).toBeNull();
    const signedIn = registry.exchange({ code: credential, label: "", source: "10.0.0.9", browser: true });
    if (!signedIn.ok) throw new Error(signedIn.error);
    expect(signedIn.session.owner).toBe("ada@example.test");
    expect(registry.authenticate(signedIn.token)).toMatchObject({ cookieOnly: true, owner: "ada@example.test" });
    expect(registry.previewBrowserSignIn(credential)).toBeNull();
    // An ordinary pairing's session is neither.
    const app = registry.exchange({ code: ordinary.code, label: "", source: "10.0.0.9" });
    if (!app.ok) throw new Error(app.error);
    expect(registry.authenticate(app.token)).not.toHaveProperty("cookieOnly");
    expect(app.session).not.toHaveProperty("owner");
    // Survives a restart.
    const reloaded = new SessionRegistry({ file: file(), now: () => clock });
    expect(reloaded.authenticate(signedIn.token)).toMatchObject({ cookieOnly: true, owner: "ada@example.test" });
  });

  it("is looked at without counting toward the lockout", () => {
    for (let attempt = 0; attempt < LOCKOUT.failures * 2; attempt += 1) registry.previewBrowserSignIn(generatePairingCredential());
    expect(registry.failureSources()).toEqual([]);
  });

  it("names the principal behind a native sign-in credential before redemption", () => {
    const { credential } = registry.openPairing({ principalId: "pr_alice", scopes: ["client"], ttlMs: 120_000 });
    expect(registry.previewSignInPrincipal(credential)).toEqual({ principalId: "pr_alice", expiresAt: clock + 120_000 });
    const signedIn = registry.exchange({ code: credential, label: "Mac", source: "10.0.0.11" });
    if (!signedIn.ok) throw new Error(signedIn.error);
    expect(registry.previewSignInPrincipal(credential)).toBeNull();
  });
});

function pair(label = "MacBook", source = "10.0.0.2") {
  const { code } = registry.openPairing();
  const result = registry.exchange({ code, label, source });
  if (!result.ok) throw new Error(result.error);
  return result;
}

describe("pairing codes", () => {
  it("are 12 unambiguous symbols and survive human retyping", () => {
    for (let i = 0; i < 50; i++) {
      const code = generatePairingCode();
      expect(code).toHaveLength(12);
      for (const ch of code) expect(PAIRING_CODE_ALPHABET).toContain(ch);
    }
    expect(formatPairingCode("ABCDEFGHJKLM")).toBe("ABCD-EFGH-JKLM");
    expect(normalizePairingCode(" abcd-efgh jklm ")).toBe("ABCDEFGHJKLM");
    expect(normalizePairingCode("0O1I")).toBe("OOII");
  });

  it("exchange once, then never again, and expire after five minutes", () => {
    const { code } = registry.openPairing({ label: "phone" });
    const first = registry.exchange({ code: formatPairingCode(code).toLowerCase(), label: "", source: "a" });
    expect(first.ok).toBe(true);
    if (first.ok) expect(first.session.label).toBe("phone");
    // without an attempt id there is no replay: the same source asking again is refused too
    const again = registry.exchange({ code, label: "x", source: "a" });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error).toMatch(/wrong or has expired/);
    const { code: stale } = registry.openPairing();
    clock += PAIRING_CODE_TTL_MS + 1;
    expect(registry.exchange({ code: stale, label: "x", source: "b" }).ok).toBe(false);
    expect(registry.openPairings()).toEqual([]);
  });

  it("locks a source out after repeated failures, and forgets on success", () => {
    for (let i = 0; i < LOCKOUT.failures; i++) {
      expect(registry.exchange({ code: "AAAAAAAAAAAA", label: "", source: "attacker" }).ok).toBe(false);
    }
    const { code } = registry.openPairing();
    const locked = registry.exchange({ code, label: "", source: "attacker" });
    expect(locked.ok).toBe(false);
    if (!locked.ok) {
      expect(locked.status).toBe(429);
      expect(locked.error).toMatch(/from your address; try again in 60s/);
    }
    // a different source is unaffected, and the code is still unused
    expect(registry.exchange({ code, label: "", source: "friend" }).ok).toBe(true);
    clock += LOCKOUT.lockMs + 1;
    const { code: fresh } = registry.openPairing();
    expect(registry.exchange({ code: fresh, label: "", source: "attacker" }).ok).toBe(true);
  });

  it("answers a lost-response retry with the same session for a minute, keyed on the client's attempt id", () => {
    const { code } = registry.openPairing();
    const first = registry.exchange({ code, label: "phone", source: "a", attemptId: "attempt-0001-abcd" });
    expect(first.ok).toBe(true);
    // same attempt id: the same answer, even from another address (the phone changed networks)
    expect(registry.exchange({ code, label: "phone", source: "b", attemptId: "attempt-0001-abcd" })).toEqual(first);
    expect(registry.list()).toHaveLength(1);
    // a different attempt id, or none, is a new attempt against a consumed code
    expect(registry.exchange({ code, label: "x", source: "a", attemptId: "attempt-0002-efgh" }).ok).toBe(false);
    expect(registry.exchange({ code, label: "x", source: "a" }).ok).toBe(false);
    // malformed attempt ids never replay
    const { code: c2 } = registry.openPairing();
    expect(registry.exchange({ code: c2, label: "p", source: "a", attemptId: "no" }).ok).toBe(true);
    expect(registry.exchange({ code: c2, label: "p", source: "a", attemptId: "no" }).ok).toBe(false);
    clock += EXCHANGE_REPLAY_MS + 1;
    expect(registry.exchange({ code, label: "phone", source: "a", attemptId: "attempt-0001-abcd" }).ok).toBe(false);
  });

  it("forgets a source's failures once its window and lock have passed", () => {
    registry.exchange({ code: "AAAAAAAAAAAA", label: "", source: "flaky" });
    expect(registry.failureSources()).toContain("flaky");
    clock += LOCKOUT.windowMs + 1;
    registry.openPairing(); // any registry activity prunes
    expect(registry.failureSources()).not.toContain("flaky");
  });

  it("names the device from the client, else the code's label, else the user agent", () => {
    const a = registry.openPairing({ label: "Milind's MacBook" });
    const named = registry.exchange({ code: a.code, label: "", source: "s1", fallbackLabel: "Safari on Mac" });
    if (!named.ok) throw new Error(named.error);
    expect(named.session.label).toBe("Milind's MacBook");
    const b = registry.openPairing();
    const ua = registry.exchange({ code: b.code, label: "  ", source: "s2", fallbackLabel: "Safari on Mac" });
    if (!ua.ok) throw new Error(ua.error);
    expect(ua.session.label).toBe("Safari on Mac");
    const c = registry.openPairing({ label: "ignored" });
    const explicit = registry.exchange({ code: c.code, label: "Kitchen iPad", source: "s3", fallbackLabel: "Safari on iPad" });
    if (!explicit.ok) throw new Error(explicit.error);
    expect(explicit.session.label).toBe("Kitchen iPad");
  });

  it("drops control and bidirectional-formatting characters from a device's name", () => {
    const { code } = registry.openPairing();
    const named = registry.exchange({ code, label: "Safari\u202E on iPad\n\u0007\u2066", source: "s4" });
    if (!named.ok) throw new Error(named.error);
    expect(named.session.label).toBe("Safari on iPad");
    const blank = registry.exchange({ code: registry.openPairing().code, label: "\u202E\u0000", source: "s5", fallbackLabel: "Chrome\u200F on Mac" });
    if (!blank.ok) throw new Error(blank.error);
    expect(blank.session.label).toBe("Chrome on Mac");
    expect(registry.issue({ label: "Ada\u202Es phone\r", scopes: ["client"] }).session.label).toBe("Adas phone");
  });

  it("carries scopes from the code into the session, deduplicated", () => {
    const { code } = registry.openPairing({ scopes: ["client", "client"] });
    const result = registry.exchange({ code, label: "viewer", source: "s" });
    if (!result.ok) throw new Error(result.error);
    expect(result.session.scopes).toEqual(["client"]);
    expect(pair().session.scopes).toEqual(["admin", "client"]);
  });
});

describe("sessions", () => {
  it("delegates a bot-act copy that is not stored, listed, or renewed", () => {
    registry = new SessionRegistry({ file: file(), now: () => clock, emailScopes: () => ["client", "admin"] });
    const issued = registry.issue({ label: "Phone", scopes: ["client"], principalId: "person-1", email: "a@b.test" });
    const before = readFileSync(file(), "utf8");
    const delegated = registry.delegate(issued.session.id);
    expect(delegated).not.toBeNull();
    expect(delegated!.token.startsWith("sgx_sess_")).toBe(true);
    expect(delegated!.session.label).toBe("Bot act");
    expect(delegated!.session.scopes).toEqual(["client"]);
    const authed = registry.authenticate(delegated!.token);
    expect(authed?.id).toBe(delegated!.session.id);
    expect(authed?.scopes).toEqual(issued.session.scopes);
    expect(authed?.ephemeral).toBe(true);
    expect(authed?.principalId).toBe("person-1");
    // 2026-10-14: the copy is the bot, never the person choosing their approval rules
    expect(isBotActSession(authed!)).toBe(true);
    expect(isBotActSession(registry.authenticate(issued.token)!)).toBe(false);
    expect(readFileSync(file(), "utf8")).toBe(before);
    expect(registry.list().map((session) => session.id)).toEqual([issued.session.id]);
    expect(registry.forPrincipal("person-1").map((session) => session.id)).toEqual([issued.session.id]);
    expect(registry.liveWhere((session) => session.principalId === "person-1").map((session) => session.id)).toEqual([issued.session.id]);
    expect(registry.renew(delegated!.session.id)).toBe(false);
    expect(registry.authenticate(delegated!.token)?.expiresAt).toBe(clock + BOT_ACT_SESSION_TTL_MS);
    expect(registry.delegate(delegated!.session.id)).toBeNull();
    expect(registry.revoke(delegated!.session.id)).toBe(true);
    expect(readFileSync(file(), "utf8")).toBe(before);
    expect(registry.authenticate(issued.token)?.id).toBe(issued.session.id);

    const again = registry.delegate(issued.session.id)!;
    clock += BOT_ACT_SESSION_TTL_MS + 1_000;
    expect(registry.authenticate(again.token)).toBeNull();
    expect(registry.authenticate(issued.token)?.id).toBe(issued.session.id);
    const afterExpiry = readFileSync(file(), "utf8");
    registry.list();
    expect(readFileSync(file(), "utf8")).toBe(afterExpiry);

    registry.close();
    const stored = JSON.parse(readFileSync(file(), "utf8")) as { sessions: Array<Record<string, unknown>> };
    stored.sessions.push({ ...stored.sessions[0], id: "hand-written", ephemeral: true, tokenHash: "ab".repeat(32) });
    writeFileSync(file(), JSON.stringify(stored));
    const dropped = new SessionRegistry({ file: file(), now: () => clock, emailScopes: () => ["client", "admin"] });
    expect(dropped.byId("hand-written")).toBeNull();
    expect(dropped.authenticate(issued.token)?.id).toBe(issued.session.id);
    dropped.close();
  });

  it("opens a 60 s session for a person the member API acts for: not stored, listed or renewed", () => {
    registry = new SessionRegistry({ file: file(), now: () => clock, emailScopes: () => ["client", "admin"] });
    const issued = registry.issue({ label: "Phone", scopes: ["client"], principalId: "person-3" });
    const before = readFileSync(file(), "utf8");
    const opened = registry.actAs({ principalId: "person-3", scopes: ["client", "client"], label: "AI client (Perspicax)", idp: { iss: "https://px.test", sub: "01J9", role: "employee", grantRef: "g1" } });
    expect(opened).not.toBeNull();
    const authed = registry.authenticate(opened!.token);
    expect(authed).toMatchObject({ principalId: "person-3", scopes: ["client"], ephemeral: true, label: "AI client (Perspicax)", idp: { iss: "https://px.test", sub: "01J9", role: "employee" } });
    expect(authed?.idp?.grantRef).toBeUndefined();
    expect(authed?.expiresAt).toBe(clock + BOT_ACT_SESSION_TTL_MS);
    expect(readFileSync(file(), "utf8")).toBe(before);
    expect(registry.list().map((session) => session.id)).toEqual([issued.session.id]);
    expect(registry.forPrincipal("person-3").map((session) => session.id)).toEqual([issued.session.id]);
    expect(registry.renew(opened!.session.id)).toBe(false);
    expect(registry.actAs({ principalId: "person-3", scopes: [], label: "x" })).toBeNull();
    expect(registry.revoke(opened!.session.id)).toBe(true);
    expect(registry.authenticate(opened!.token)).toBeNull();
    registry.close();
  });

  it("strips cookieOnly so the copy can be presented as a bearer, and a reload drops it", () => {
    const opened = registry.openPairing({ browser: true, scopes: ["admin"], principalId: "person-2", owner: "owner@test" });
    const exchanged = registry.exchange({ code: opened.credential, browser: true, label: "Browser", source: "browser" });
    if (!exchanged.ok) throw new Error(exchanged.error);
    expect(registry.authenticate(exchanged.token)?.cookieOnly).toBe(true);
    const delegated = registry.delegate(exchanged.session.id);
    expect(delegated).not.toBeNull();
    expect(registry.authenticate(delegated!.token)?.cookieOnly).toBeUndefined();
    expect(registry.authenticate(delegated!.token)?.scopes).toEqual(["admin"]);
    expect(registry.authenticate(delegated!.token)?.owner).toBe("owner@test");
    const token = delegated!.token;
    registry.close();
    const reloaded = new SessionRegistry({ file: file(), now: () => clock });
    expect(reloaded.authenticate(token)).toBeNull();
    expect(reloaded.authenticate(exchanged.token)?.id).toBe(exchanged.session.id);
    reloaded.close();
  });

  it("returns null instead of throwing when the source session is personal", () => {
    const viewer = registry.issue({ label: "Viewer", scopes: ["client"] });
    registry.requireAdmin("personal");
    expect(registry.delegate(viewer.session.id)).toBeNull();
  });

  it("delegates membership only for internally marked portal grants, never ordinary email or a userId prefix", () => {
    registry = new SessionRegistry({ file: file(), now: () => clock, emailScopes: () => null, portalMembership: true });
    const portal = registry.issuePortal({ email: "person@example.test", grant: "g".repeat(43), scopes: ["client"] });
    const injected = { label: "ordinary", email: "person@example.test", userId: `portal:${"g".repeat(43)}`, scopes: ["client" as const], membershipAuthority: "portal" };
    const ordinary = registry.issue(injected);
    const paired = pair();
    expect(registry.authenticate(portal.token)?.membershipAuthority).toBe("portal");
    expect(portal.session).not.toHaveProperty("membershipAuthority");
    expect(registry.authenticate(ordinary.token)).toBeNull();
    expect(registry.authenticate(paired.token)?.membershipAuthority).toBeUndefined();
    expect(registry.authenticate(paired.token)?.id).toBe(paired.session.id);
    registry.close();
    const reloaded = new SessionRegistry({ file: file(), now: () => clock, emailScopes: () => null, portalMembership: true });
    expect(reloaded.authenticate(portal.token)?.id).toBe(portal.session.id);
    reloaded.close();
    const localAgain = new SessionRegistry({ file: file(), now: () => clock, emailScopes: () => null });
    expect(localAgain.authenticate(portal.token)).toBeNull();
    expect(localAgain.authenticate(paired.token)?.id).toBe(paired.session.id);
  });

  it("keeps portal grants locally narrowed by default and validates stored authority markers", () => {
    const portal = registry.issuePortal({ email: "person@example.test", grant: "g".repeat(43), scopes: ["client"] });
    expect(registry.authenticate(portal.token)).toBeNull();
    registry = new SessionRegistry({ file: file(), now: () => clock, portalMembership: true });
    const next = registry.issuePortal({ email: "person@example.test", grant: "h".repeat(43), scopes: ["client"] });
    const saved = JSON.parse(readFileSync(file(), "utf8"));
    saved.sessions[0].membershipAuthority = { untrusted: true };
    writeFileSync(file(), JSON.stringify(saved));
    const loaded = new SessionRegistry({ file: file(), now: () => clock, portalMembership: true });
    expect(loaded.authenticate(next.token)).toBeNull();
    expect(() => registry.issuePortal({ email: "person@example.test", grant: "bad", scopes: ["client"] })).toThrow("verified portal identity");
  });

  it("revokes every over-scoped email device and its tickets on demotion, but not paired devices", () => {
    let scopes: Array<"admin" | "client"> | null = ["admin", "client"];
    registry = new SessionRegistry({ file: file(), now: () => clock, emailScopes: () => scopes });
    const paired = pair();
    const first = registry.issue({ label: "browser", email: "person@example.test", scopes: ["admin", "client"] });
    const second = registry.issue({ label: "phone", email: "person@example.test", scopes: ["admin", "client"] });
    const member = registry.issue({ label: "member", email: "person@example.test", scopes: ["client"] });
    const tickets = [first, second].map(({ session }) => registry.issueStreamTicket(session.id).ticket);
    const revoked: string[] = [];
    registry.onSessionRevoked((id) => revoked.push(id));
    scopes = ["client"];
    expect(registry.authenticate(first.token)).toBeNull();
    expect(registry.isLive(second.session.id)).toBe(false);
    expect(tickets.map((ticket) => registry.redeemStreamTicket(ticket))).toEqual([null, null]);
    expect(revoked).toEqual([first.session.id, second.session.id]);
    expect(registry.authenticate(paired.token)?.scopes).toEqual(["admin", "client"]);
    expect(registry.authenticate(member.token)?.scopes).toEqual(["client"]);
    scopes = ["admin", "client"]; // promotion never widens or revives a token
    expect(registry.authenticate(member.token)?.scopes).toEqual(["client"]);
    expect(registry.authenticate(first.token)).toBeNull();
    scopes = null;
    expect(registry.renew(member.session.id)).toBe(false);
    expect(registry.list().map((session) => session.id)).toEqual([paired.session.id]);
    const loaded = new SessionRegistry({ file: file(), now: () => clock, emailScopes: () => ["admin", "client"] });
    expect(loaded.authenticate(first.token)).toBeNull();
  });

  it.each([undefined, () => { throw new Error("membership unavailable"); }])("fails closed when email membership cannot be checked (%s)", (emailScopes) => {
    registry = new SessionRegistry({ file: file(), now: () => clock, emailScopes });
    const paired = pair();
    const email = registry.issue({ label: "browser", email: "person@example.test", scopes: ["client"] });
    expect(registry.authenticate(email.token)).toBeNull();
    expect(registry.authenticate(paired.token)?.id).toBe(paired.session.id);
  });

  it("rechecks membership when a stream ticket is the first use after removal", () => {
    let allowed = true;
    registry = new SessionRegistry({ file: file(), now: () => clock, emailScopes: () => allowed ? ["client"] : null });
    const email = registry.issue({ label: "browser", email: "person@example.test", scopes: ["client"] });
    const { ticket } = registry.issueStreamTicket(email.session.id);
    allowed = false;
    expect(registry.redeemStreamTicket(ticket)).toBeNull();
    expect(registry.isLive(email.session.id)).toBe(false);
  });

  it("builds one membership resolver per pass and skips snapshots with no eligible account sessions", () => {
    const resolve = vi.fn((_email: string) => ["client" as const]);
    const snapshot = vi.fn(() => resolve);
    registry = new SessionRegistry({ file: file(), now: () => clock, emailScopesSnapshot: snapshot, portalMembership: true });
    pair();
    const portal = registry.issuePortal({ email: "portal@example.test", grant: "g".repeat(43), scopes: ["client"] });
    registry.revalidateEmailSessions();
    expect(snapshot).not.toHaveBeenCalled();
    registry.issue({ label: "first", email: "one@example.test", scopes: ["client"] });
    registry.issue({ label: "second", email: "two@example.test", scopes: ["client"] });
    snapshot.mockClear(); resolve.mockClear();
    registry.revalidateEmailSessions();
    expect(snapshot).toHaveBeenCalledTimes(1);
    expect(resolve.mock.calls.map(([email]) => email)).toEqual(["one@example.test", "two@example.test"]);
    expect(registry.authenticate(portal.token)?.membershipAuthority).toBe("portal");
  });

  it("fails closed for every eligible account when a snapshot fails, without using the fallback", () => {
    let unavailable = false;
    const fallback = vi.fn(() => ["admin" as const, "client" as const]);
    registry = new SessionRegistry({ file: file(), now: () => clock, emailScopes: fallback,
      emailScopesSnapshot: () => { if (unavailable) throw new Error("private membership failure"); return () => ["client"]; },
    });
    const paired = pair();
    const first = registry.issue({ label: "first", email: "one@example.test", scopes: ["client"] });
    const second = registry.issue({ label: "second", email: "two@example.test", scopes: ["client"] });
    unavailable = true;
    registry.revalidateEmailSessions();
    expect(registry.authenticate(first.token)).toBeNull();
    expect(registry.authenticate(second.token)).toBeNull();
    expect(registry.authenticate(paired.token)?.id).toBe(paired.session.id);
    expect(fallback).not.toHaveBeenCalled();
  });

  it("restores valid email and paired sessions after clean shutdown, and rechecks one snapshot during load", () => {
    registry = new SessionRegistry({ file: file(), now: () => clock, emailScopes: () => ["client"] });
    const email = registry.issue({ label: "browser", email: "person@example.test", scopes: ["client"] });
    const paired = pair();
    expect(existsSync(`${file()}.open`)).toBe(true);
    if (process.platform !== "win32") expect(statSync(`${file()}.open`).mode & 0o777).toBe(0o600);
    registry.close(); registry.close();
    expect(existsSync(`${file()}.open`)).toBe(false);
    expect(() => registry.authenticate(email.token)).toThrow("closed");
    const snapshot = vi.fn(() => () => ["client" as const]);
    const loaded = new SessionRegistry({ file: file(), now: () => clock, emailScopesSnapshot: snapshot });
    expect(snapshot).toHaveBeenCalledTimes(1);
    expect(loaded.authenticate(email.token)?.id).toBe(email.session.id);
    expect(loaded.authenticate(paired.token)?.id).toBe(paired.session.id);
    loaded.close();
  });

  it("revokes restored email sessions if the constructor membership snapshot fails", () => {
    registry = new SessionRegistry({ file: file(), now: () => clock, emailScopes: () => ["client"] });
    const email = registry.issue({ label: "browser", email: "person@example.test", scopes: ["client"] });
    const paired = pair(); registry.close();
    const unavailable = new SessionRegistry({ file: file(), now: () => clock, emailScopesSnapshot: () => { throw new Error("unavailable"); } });
    expect(unavailable.authenticate(email.token)).toBeNull();
    unavailable.close();
    const restored = new SessionRegistry({ file: file(), now: () => clock, emailScopes: () => ["client"] });
    expect(restored.authenticate(email.token)).toBeNull();
    expect(restored.authenticate(paired.token)?.id).toBe(paired.session.id);
    restored.close();
  });

  it("never revives revoked email bearers after persistence failure, unclean restart, and membership restoration", () => {
    let allowed = true;
    registry = new SessionRegistry({ file: file(), now: () => clock, emailScopes: () => allowed ? ["client"] : null });
    const paired = pair();
    const email = registry.issue({ label: "browser", email: "person@example.test", scopes: ["client"] });
    const { ticket } = registry.issueStreamTicket(email.session.id);
    const saved = readFileSync(file(), "utf8");
    const logger = vi.spyOn(console, "error").mockImplementation(() => {});
    // The real pre-failure session file and boot marker remain on disk. Every
    // attempted atomic write now fails, including any attempted clean close.
    const writes = vi.spyOn(atomic, "writeFileAtomic").mockImplementation(() => { throw new Error("EIO: private-path-and-token"); });
    allowed = false;
    registry.revalidateEmailSessions();
    expect(registry.authenticate(email.token)).toBeNull();
    expect(registry.redeemStreamTicket(ticket)).toBeNull();
    expect(readFileSync(file(), "utf8")).toBe(saved);
    expect(existsSync(`${file()}.open`)).toBe(true);
    expect(() => registry.close()).toThrow("Could not safely close session storage.");
    expect(() => new SessionRegistry({ file: file(), now: () => clock, emailScopes: () => ["client"] })).toThrow("Could not establish safe session storage.");
    expect(logger.mock.calls.flat().join(" ")).not.toContain("private-path-and-token");
    writes.mockRestore(); allowed = true;
    const restarted = new SessionRegistry({ file: file(), now: () => clock, emailScopes: () => ["client"] });
    expect(restarted.authenticate(email.token)).toBeNull();
    expect(restarted.authenticate(paired.token)?.id).toBe(paired.session.id);
    restarted.close();
    const cleanRestart = new SessionRegistry({ file: file(), now: () => clock, emailScopes: () => ["client"] });
    expect(cleanRestart.authenticate(email.token)).toBeNull();
    expect(cleanRestart.authenticate(paired.token)?.id).toBe(paired.session.id);
    cleanRestart.close();
  });

  it("drops account and portal sessions but preserves paired phones after any unclean restart", () => {
    registry = new SessionRegistry({ file: file(), now: () => clock, emailScopes: () => ["client"], portalMembership: true });
    const paired = pair();
    const account = registry.issue({ label: "browser", email: "person@example.test", scopes: ["client"] });
    const portal = registry.issuePortal({ email: "person@example.test", grant: "g".repeat(43), scopes: ["client"] });
    const restarted = new SessionRegistry({ file: file(), now: () => clock, emailScopes: () => ["client"], portalMembership: true });
    expect(restarted.authenticate(account.token)).toBeNull();
    expect(restarted.authenticate(portal.token)).toBeNull();
    expect(restarted.authenticate(paired.token)?.id).toBe(paired.session.id);
    restarted.close();
  });

  it("refuses to load persisted sessions when the marker cannot be established on the real filesystem", () => {
    const blocked = join(dir, "blocked.json");
    const paired = pair();
    writeFileSync(blocked, readFileSync(file(), "utf8"));
    mkdirSync(`${blocked}.open`); // An atomic file replace cannot overwrite a directory, even as root.
    expect(() => new SessionRegistry({ file: blocked, now: () => clock })).toThrow("Could not establish safe session storage.");
    expect(readFileSync(blocked, "utf8")).toContain(paired.session.id);
  });

  it("stores only a hash, owner-only, and reloads from disk", () => {
    const { token, session } = pair();
    const onDisk = readFileSync(file(), "utf8");
    expect(onDisk).not.toContain(token);
    expect(onDisk).toContain(session.id);
    if (process.platform !== "win32") expect(statSync(file()).mode & 0o777).toBe(0o600); // Windows has no POSIX modes
    const reloaded = new SessionRegistry({ file: file(), now: () => clock });
    expect(reloaded.authenticate(token)?.id).toBe(session.id);
    expect(reloaded.authenticate("omb_sess_nope")).toBeNull();
  });

  it("expires after 30 days and can be revoked", () => {
    const { token, session } = pair();
    clock += SESSION_TTL_MS - 1;
    expect(registry.authenticate(token)?.id).toBe(session.id);
    clock += 2;
    expect(registry.authenticate(token)).toBeNull();
    const other = pair("iPad");
    expect(registry.list().map((s) => s.label)).toEqual(["iPad"]);
    expect(registry.revoke(other.session.id)).toBe(true);
    expect(registry.revoke(other.session.id)).toBe(false);
    expect(registry.authenticate(other.token)).toBeNull();
  });

  it("updates last-seen at most once a minute so reads stay cheap", () => {
    const { token } = pair();
    const before = statSync(file()).mtimeMs;
    clock += 1_000;
    registry.authenticate(token);
    expect(registry.list()[0]?.lastSeenAt).toBe(clock - 1_000);
    clock += 60_000;
    registry.authenticate(token);
    expect(registry.list()[0]?.lastSeenAt).toBe(clock);
    expect(statSync(file()).mtimeMs).toBeGreaterThanOrEqual(before);
  });

  it("renews a session with half its term or less left, and never revives an expired one", () => {
    const { token, session } = pair();
    clock += SESSION_TTL_MS / 2 - 60_000;
    expect(registry.renew(session.id)).toBe(false); // more than half left: untouched
    expect(registry.list()[0]?.expiresAt).toBe(session.expiresAt);
    clock += 120_000;
    expect(registry.renew(session.id)).toBe(true);
    expect(registry.list()[0]?.expiresAt).toBe(clock + SESSION_TTL_MS);
    expect(registry.renew(session.id)).toBe(false); // just renewed: nothing to do
    clock += SESSION_TTL_MS - 1;
    expect(registry.authenticate(token)?.id).toBe(session.id); // alive well past the original term
    expect(registry.renew(session.id)).toBe(true);
    const reloaded = new SessionRegistry({ file: file(), now: () => clock });
    expect(reloaded.list()[0]?.expiresAt).toBe(clock + SESSION_TTL_MS); // the renewal reached disk
    const quiet = pair("iPad");
    clock += SESSION_TTL_MS + 1;
    expect(registry.renew(quiet.session.id)).toBe(false);
    expect(registry.authenticate(quiet.token)).toBeNull();
  });

  it("stops renewing at the absolute cap counted from pairing", () => {
    const { token, session } = pair();
    const cap = session.createdAt + SESSION_MAX_AGE_MS;
    let last = session.expiresAt;
    for (let i = 0; i < 20; i += 1) {
      clock = last - SESSION_TTL_MS / 2; // exactly at the halfway mark, each time
      registry.renew(session.id);
      const now = registry.list()[0]?.expiresAt ?? 0;
      expect(now).toBeLessThanOrEqual(cap);
      expect(now).toBeGreaterThanOrEqual(last);
      last = now;
    }
    expect(last).toBe(cap);
    clock = cap - 1;
    expect(registry.authenticate(token)?.id).toBe(session.id);
    expect(registry.renew(session.id)).toBe(false); // at the cap: no further extension
    clock = cap + 1;
    expect(registry.authenticate(token)).toBeNull();
  });

  it("applies the cap to a session paired long before this version", () => {
    const day = 24 * 60 * 60_000;
    const old = {
      id: "old-device", tokenHash: "0".repeat(64), label: "old laptop", scopes: ["admin"],
      createdAt: clock - 160 * day, lastSeenAt: clock - day, expiresAt: clock + 15 * day,
    };
    const older = { ...old, id: "older-device", tokenHash: "1".repeat(64), createdAt: clock - 175 * day };
    writeFileSync(file(), JSON.stringify({ version: 1, sessions: [old, older] }));
    const loaded = new SessionRegistry({ file: file(), now: () => clock });
    // 160 days in with 15 left: the cap allows 20, so the renewal reaches the cap, not a full term
    expect(loaded.renew("old-device")).toBe(true);
    expect(loaded.list()[0]?.expiresAt).toBe(old.createdAt + SESSION_MAX_AGE_MS);
    // 175 days in with 15 left: the cap (5 days out) is already below the term it has; nothing is taken away
    expect(loaded.renew("older-device")).toBe(false);
    expect(loaded.list()[1]?.expiresAt).toBe(older.expiresAt);
  });

  it("reads whole days from the environment and falls back on anything else", () => {
    const day = 24 * 60 * 60_000;
    expect(daysMs(undefined, 30)).toBe(30 * day);
    expect(daysMs("7", 30)).toBe(7 * day);
    for (const bad of ["0", "-1", "0.5", "soon", "1e308", "3651", ""]) expect(daysMs(bad, 30)).toBe(30 * day);
    expect(daysMs("3650", 30)).toBe(3650 * day);
  });

  it("gives a cookie whole seconds, never less than one", () => {
    expect(cookieMaxAgeSeconds({ expiresAt: 10_500 }, 0)).toBe(10);
    expect(cookieMaxAgeSeconds({ expiresAt: 100 }, 0)).toBe(1);
    expect(cookieMaxAgeSeconds({ expiresAt: 0 }, 5_000)).toBe(1);
  });
});

describe("stream tickets", () => {
  it("are single use, short-lived, and die with their session", () => {
    const { session } = pair();
    const { ticket } = registry.issueStreamTicket(session.id);
    expect(registry.redeemStreamTicket(ticket)?.id).toBe(session.id);
    expect(registry.redeemStreamTicket(ticket)).toBeNull();
    const { ticket: late } = registry.issueStreamTicket(session.id);
    clock += STREAM_TICKET_TTL_MS + 1;
    expect(registry.redeemStreamTicket(late)).toBeNull();
    const { ticket: orphan } = registry.issueStreamTicket(session.id);
    registry.revoke(session.id);
    expect(registry.redeemStreamTicket(orphan)).toBeNull();
  });
});

describe("sessions carry a principal", () => {
  it("gives a paired device the principal that minted the code", () => {
    const sessions = registry;
    const opened = sessions.openPairing({ label: "Phone", principalId: "pr_11111111-1111-4111-8111-111111111111" });
    const paired = sessions.exchange({ code: opened.code, label: "", source: "test" });
    expect(paired.ok).toBe(true);
    const token = paired.ok ? paired.token : "";
    expect(sessions.authenticate(token)?.principalId).toBe("pr_11111111-1111-4111-8111-111111111111");
  });

  it("stores the principal of an account sign-in", () => {
    // Needs its own registry: an account session carrying an email is
    // fail-closed by revalidateEmailSessions unless membership resolves
    // (see "fails closed" above), which is orthogonal to principalId.
    registry = new SessionRegistry({ file: file(), now: () => clock, emailScopes: () => ["client"] });
    const sessions = registry;
    const issued = sessions.issue({ label: "Mac", scopes: ["client"], email: "zach@example.com", userId: "cp_1", principalId: "pr_22222222-2222-4222-8222-222222222222" });
    expect(sessions.authenticate(issued.token)?.principalId).toBe("pr_22222222-2222-4222-8222-222222222222");
  });

  it("lets the boot migration attach a principal to an older session", () => {
    const sessions = registry;
    const opened = sessions.openPairing({ label: "Old phone" });
    const paired = sessions.exchange({ code: opened.code, label: "", source: "test" });
    const token = paired.ok ? paired.token : "";
    const id = sessions.authenticate(token)!.id;
    expect(sessions.setPrincipal(id, "pr_33333333-3333-4333-8333-333333333333")).toBe(true);
    expect(sessions.authenticate(token)?.principalId).toBe("pr_33333333-3333-4333-8333-333333333333");
  });

  it("lists each session's identity fields for the boot migration, never its token hash", () => {
    const opened = registry.openPairing({ label: "Old phone" });
    const paired = registry.exchange({ code: opened.code, label: "", source: "test" });
    const id = paired.ok ? paired.session.id : "";
    expect(registry.listRecordsForMigration()).toEqual([{ id, label: "Old phone", email: undefined, userId: undefined, principalId: undefined, scopes: ["admin", "client"] }]);
  });
});

describe("sessions from an OpenID Connect sign-in", () => {
  it("carry the provider subject and are never revoked by the email sign-in list", () => {
    const store = new SessionRegistry({ file: join(dir, "oidc-sessions.json"), now: () => clock, emailScopes: () => null });
    const issued = store.issue({ label: "Chrome on Mac", scopes: ["admin", "client"], email: "ada@example.test", principalId: "pr_x", idp: { iss: "https://px.example.test", sub: "01J", role: "admin" } });
    const legacy = store.issue({ label: "Email", scopes: ["client"], email: "ada@example.test" });
    expect(store.authenticate(legacy.token)).toBeNull();
    const record = store.authenticate(issued.token);
    expect(record?.idp).toEqual({ iss: "https://px.example.test", sub: "01J", role: "admin" });
    expect(record?.principalId).toBe("pr_x");
    store.close();
  });

  it("survive an unclean restart only as waiting for the provider's recheck (2026-10-19)", () => {
    const path = join(dir, "oidc-unclean.json");
    const store = new SessionRegistry({ file: path, now: () => clock });
    const issued = store.issue({ label: "Chrome", scopes: ["client"], email: "y@example.test", principalId: "pr_y", idp: { iss: "https://px.example.test", sub: "01K" } });
    const email = store.issue({ label: "browser", email: "person@example.test", scopes: ["client"] });
    expect(store.needsRecheck(issued.session.id)).toBe(false);
    // no close(): the open marker stays, as after a crash
    const reopened = new SessionRegistry({ file: path, now: () => clock, emailScopes: () => ["client"] });
    expect(reopened.authenticate(issued.token)?.id).toBe(issued.session.id);
    expect(reopened.needsRecheck(issued.session.id)).toBe(true);
    // an email session still needs a clean close to come back
    expect(reopened.authenticate(email.token)).toBeNull();
    // nor does it act for anyone (bot-act copies, person lookups) before then
    expect(reopened.delegate(issued.session.id)).toBeNull();
    expect(reopened.liveWhere((s) => s.principalId === "pr_y")).toEqual([]);
    reopened.recheckDone(issued.session.id);
    expect(reopened.liveWhere((s) => s.principalId === "pr_y").map((s) => s.id)).toEqual([issued.session.id]);
    expect(reopened.needsRecheck(issued.session.id)).toBe(false);
    reopened.close();
    const clean = new SessionRegistry({ file: path, now: () => clock });
    expect(clean.needsRecheck(issued.session.id)).toBe(false);
    expect(clean.authenticate(issued.token)?.id).toBe(issued.session.id);
    clean.close();
  });

  it("do not survive an unclean restart when a session write was lost", () => {
    const path = join(dir, "oidc-unsynced.json");
    const store = new SessionRegistry({ file: path, now: () => clock });
    const kept = store.issue({ label: "Chrome", scopes: ["client"], principalId: "pr_y", idp: { iss: "https://px.example.test", sub: "01K" } });
    const revoked = store.issue({ label: "Safari", scopes: ["client"], principalId: "pr_y", idp: { iss: "https://px.example.test", sub: "01K" } });
    const writes = vi.spyOn(atomic, "writeFileAtomic").mockImplementation(() => { throw new Error("ENOSPC"); });
    const logger = vi.spyOn(console, "error").mockImplementation(() => {});
    store.revokeWhere((s) => s.id === revoked.session.id);
    writes.mockRestore(); logger.mockRestore();
    expect(existsSync(`${path}.unsynced`)).toBe(true);
    // crash: neither the revocation nor a clean close reached disk
    const reopened = new SessionRegistry({ file: path, now: () => clock });
    expect(reopened.authenticate(revoked.token)).toBeNull();
    expect(reopened.authenticate(kept.token)).toBeNull();
    reopened.close();
    expect(existsSync(`${path}.unsynced`)).toBe(false);
  });

  it("dropPendingRechecks ends the sessions a provider cannot confirm", () => {
    const path = join(dir, "oidc-drop.json");
    const store = new SessionRegistry({ file: path, now: () => clock });
    const issued = store.issue({ label: "Chrome", scopes: ["client"], principalId: "pr_y", idp: { iss: "https://px.example.test", sub: "01K" } });
    const reopened = new SessionRegistry({ file: path, now: () => clock });
    expect(reopened.dropPendingRechecks()).toBe(1);
    expect(reopened.authenticate(issued.token)).toBeNull();
    reopened.close();
  });
});

describe("OpenID Connect grants on sessions (slice 2)", () => {
  const idp = { iss: "https://px.example.test", sub: "01J9SUB", role: "employee", grantRef: "g-1" };

  it("carries a pairing's provider account and grant into the session it creates, and reports the exchange", () => {
    const seen: string[] = [];
    registry.onExchanged((session, pairing) => seen.push(`${session.idp?.grantRef}:${pairing.label}`));
    const { credential } = registry.openPairing({ scopes: ["client"], label: "Sagax phone", ttlMs: 120_000, principalId: "pr_00000000-0000-4000-8000-000000000001", idp });
    const result = registry.exchange({ code: credential, label: "", source: "1.2.3.4" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const record = registry.byId(result.session.id)!;
    expect(record.idp).toEqual(idp);
    expect(record.principalId).toBe("pr_00000000-0000-4000-8000-000000000001");
    expect(record.scopes).toEqual(["client"]);
    expect(seen).toEqual(["g-1:Sagax phone"]);
    // the 120 s window closes
    const late = registry.openPairing({ scopes: ["client"], ttlMs: 120_000, idp });
    clock += 120_001;
    expect(registry.exchange({ code: late.credential, label: "", source: "1.2.3.5" }).ok).toBe(false);
  });

  it("revokes by predicate, firing the listeners once per session, and persists once", () => {
    const fired: string[] = [];
    registry.onSessionRevoked((id) => fired.push(id));
    const a = registry.issue({ label: "a", scopes: ["client"], principalId: "pr_00000000-0000-4000-8000-00000000000a", idp });
    const b = registry.issue({ label: "b", scopes: ["client"], principalId: "pr_00000000-0000-4000-8000-00000000000a" });
    const c = registry.issue({ label: "c", scopes: ["admin", "client"] });
    const persist = vi.spyOn(atomic, "writeFileAtomic");
    const gone = registry.revokeWhere((s) => s.principalId === "pr_00000000-0000-4000-8000-00000000000a");
    expect(gone.sort()).toEqual([a.session.id, b.session.id].sort());
    expect(fired.sort()).toEqual(gone.sort());
    expect(persist.mock.calls.filter(([path]) => path === file())).toHaveLength(1);
    expect(registry.list().map((s) => s.id)).toEqual([c.session.id]);
    expect(registry.revokeWhere(() => false)).toEqual([]);
  });

  it("lists a person's sessions, narrows scopes, updates the role and cancels their codes", () => {
    const person = "pr_00000000-0000-4000-8000-00000000000b";
    const a = registry.issue({ label: "a", scopes: ["admin", "client"], principalId: person, idp });
    registry.issue({ label: "other", scopes: ["client"] });
    expect(registry.forPrincipal(person).map((s) => s.id)).toEqual([a.session.id]);
    expect(registry.setScopes(a.session.id, ["client"])).toBe(true);
    expect(registry.byId(a.session.id)!.scopes).toEqual(["client"]);
    expect(registry.setScopes(a.session.id, [])).toBe(false);
    expect(registry.setIdpRole(a.session.id, "manager")).toBe(true);
    expect(registry.byId(a.session.id)!.idp?.role).toBe("manager");
    registry.openPairing({ principalId: person });
    registry.openPairing({ principalId: person });
    registry.openPairing({ principalId: "pr_00000000-0000-4000-8000-00000000000c" });
    expect(registry.cancelPairingsFor(person)).toBe(2);
    expect(registry.openPairings()).toHaveLength(1);
    // the grant reference survives a restart
    registry.close();
    const again = new SessionRegistry({ file: file(), now: () => clock });
    expect(again.byId(a.session.id)!.idp?.grantRef).toBe("g-1");
  });
});

describe("admin scope only (an OMB Cloud home is personal: server/cloud-owner.ts)", () => {
  const PERSONAL = "My Cloud is personal: only your own devices can connect.";
  it("opens, redeems, issues and accepts nothing without admin scope; the owner's devices are unaffected", () => {
    // Made before the rule applies (as a stored session is at boot).
    const earlier = registry.openPairing({ scopes: ["client"], label: "Guest phone" });
    const stored = registry.exchange({ code: earlier.credential, label: "Guest phone", source: "a" });
    expect(stored.ok).toBe(true);
    const ticket = stored.ok ? registry.issueStreamTicket(stored.session.id).ticket : "";
    const openWindow = registry.openPairing({ scopes: ["client"] });
    const owner = registry.exchange({ code: registry.openPairing().credential, label: "Mac", source: "a" });
    registry.requireAdmin(PERSONAL);
    expect(() => registry.openPairing({ scopes: ["client"] })).toThrow(PERSONAL);
    expect(registry.exchange({ code: openWindow.credential, label: "Guest", source: "b" })).toEqual({ ok: false, status: 403, error: PERSONAL });
    expect(() => registry.issue({ label: "Friend", scopes: ["client"], email: "friend@example.test" })).toThrow(PERSONAL);
    expect(() => registry.issuePortal({ email: "friend@example.test", grant: "g".repeat(43), scopes: ["client"] })).toThrow(PERSONAL);
    if (!stored.ok || !owner.ok) throw new Error("unreachable");
    expect(registry.authenticate(stored.token)).toBeNull();
    expect(registry.redeemStreamTicket(ticket)).toBeNull();
    expect(registry.isLive(stored.session.id)).toBe(false);
    // The owner's devices: as before.
    expect(registry.authenticate(owner.token)?.id).toBe(owner.session.id);
    expect(registry.isLive(owner.session.id)).toBe(true);
    const next = registry.exchange({ code: registry.openPairing({ scopes: ["admin"] }).credential, label: "Phone", source: "c" });
    expect(next.ok).toBe(true);
  });
});

describe("a pairing window lost to a restart (2026-10-13)", () => {
  it("says the server may have restarted while it is young, and only then", () => {
    const { credential } = registry.openPairing({ label: "Mac", principalId: "p1" });
    registry.close();
    // a restart: open windows lived in memory only (hashes, never on disk)
    const restarted = new SessionRegistry({ file: file(), now: () => clock });
    expect(readFileSync(file(), "utf8")).not.toContain(credential);
    const lost = restarted.exchange({ code: credential, label: "Mac", source: "a" });
    expect(lost).toMatchObject({ ok: false, status: 401, code: "server_restarted" });
    if (!lost.ok) expect(lost.error).toMatch(/wrong or has expired.*restarted/);
    clock += PAIRING_RESTART_HINT_MS;
    const later = restarted.exchange({ code: credential, label: "Mac", source: "b" });
    expect(later).toEqual({ ok: false, status: 401, error: "pairing code is wrong or has expired; create a new one on the server" });
  });
});

// 2026-10-20: a refused token says why (the 401 code), across restarts.
describe("why a session token stopped working", () => {
  it("remembers revoked, expired and provider-ended sessions by token hash, bounded, and says unknown otherwise", () => {
    const dir = mkdtempSync(join(tmpdir(), "omb-sessions-ended-"));
    try {
      let now = 1_000_000;
      const file = join(dir, "sessions.json");
      const registry = new SessionRegistry({ file, now: () => now });
      const a = registry.issue({ label: "a", scopes: ["client"] });
      const b = registry.issue({ label: "b", scopes: ["client"] });
      const c = registry.issue({ label: "c", scopes: ["client"] });
      registry.revoke(a.session.id);
      registry.revokeWhere((s) => s.id === b.session.id, "idp_session_ended");
      expect(registry.explainRefusal(a.token)).toEqual({ code: "session_revoked", sessionId: a.session.id });
      expect(registry.explainRefusal(b.token)).toEqual({ code: "idp_session_ended", sessionId: b.session.id });
      expect(registry.explainRefusal("sgx_sess_never")).toEqual({ code: "session_unknown" });
      expect(registry.explainRefusal(undefined)).toEqual({ code: "session_unknown" });
      now += SESSION_TTL_MS + 1;
      expect(registry.explainRefusal(c.token).code).toBe("session_expired");
      registry.list(); // prunes
      expect(registry.explainRefusal(c.token).code).toBe("session_expired");
      registry.close();
      const raw = readFileSync(file, "utf8");
      for (const token of [a.token, b.token, c.token]) expect(raw).not.toContain(token);
      const reopened = new SessionRegistry({ file, now: () => now });
      expect(reopened.explainRefusal(b.token).code).toBe("idp_session_ended");
      now += ENDED_SESSION_MEMORY_MS;
      expect(reopened.explainRefusal(b.token).code).toBe("session_unknown");
      reopened.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
