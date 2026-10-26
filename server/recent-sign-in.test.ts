// 2026-10-18 (follow-up of #744): a session a bot can obtain is never "a
// sign-in younger than 15 minutes". Only an interactive sign-in stamps it.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AUTH_TIME_SKEW_MS, RECENT_SIGN_IN_MS, authAtFromAuthTime, recentInteractiveSignIn, recentPersonSignIn } from "./recent-sign-in.ts";
import type { RequestAuth } from "./request-auth.ts";
import { SessionRegistry, type SessionRecord } from "./sessions.ts";

let dir = "";
let clock = 1_800_000_000_000;
let registry: SessionRegistry;
const now = () => clock;
const sessionAuth = (session: SessionRecord): RequestAuth => ({ kind: "session", session, via: "bearer", scopes: session.scopes });
const fresh = (session: SessionRecord) => recentPersonSignIn(sessionAuth(session), { desktopManaged: false, now: clock });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "sagax-recent-sign-in-"));
  clock = 1_800_000_000_000;
  registry = new SessionRegistry({ file: join(dir, "sessions.json"), now });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("a session redeemed from a pairing code", () => {
  it("is never a recent sign-in, even a second old (a bot's manage_pairing code)", () => {
    const opened = registry.openPairing({ scopes: ["admin", "client"], principalId: "p_person" });
    const paired = registry.exchange({ code: opened.code, label: "bot", source: "127.0.0.1" });
    expect(paired.ok).toBe(true);
    if (!paired.ok) return;
    const record = registry.byId(paired.session.id)!;
    expect(record.createdAt).toBe(clock);
    expect(record.authAt).toBeUndefined();
    expect(fresh(record)).toBe(false);
  });

  it("by the phone's credential encoding too (/api/pair, device tokens)", () => {
    const opened = registry.openPairing({ principalId: "p_person" });
    const paired = registry.exchange({ code: opened.credential, label: "Pixel", source: "10.0.0.2" });
    expect(paired.ok && fresh(registry.byId(paired.session.id)!)).toBe(false);
  });

  it("from a person's own fresh session does not inherit or reset the clock", () => {
    const person = registry.issue({ label: "web", scopes: ["admin", "client"], principalId: "p_person", authAt: clock });
    expect(fresh(registry.byId(person.session.id)!)).toBe(true);
    const opened = registry.openPairing({ principalId: "p_person" });
    const paired = registry.exchange({ code: opened.code, label: "", source: "10.0.0.3" });
    expect(paired.ok && fresh(registry.byId(paired.session.id)!)).toBe(false);
  });

  it("carries an interactive sign-in only when the window was opened with one (Sign in with Pulsatrix)", () => {
    const signedInAt = clock;
    const opened = registry.openPairing({ principalId: "p_person", authAt: signedInAt });
    clock += 60_000;
    const paired = registry.exchange({ code: opened.credential, label: "My Mac", source: "10.0.0.4" });
    expect(paired.ok).toBe(true);
    if (!paired.ok) return;
    const record = registry.byId(paired.session.id)!;
    expect(record.authAt).toBe(signedInAt);
    expect(fresh(record)).toBe(true);
    // the window is the sign-in's moment, not the exchange's
    clock = signedInAt + RECENT_SIGN_IN_MS + 1;
    expect(fresh(registry.byId(paired.session.id)!)).toBe(false);
  });

  it("refuses a sign-in time from the future or that is not a time", () => {
    for (const authAt of [clock + 1, Number.NaN, Number.POSITIVE_INFINITY, -1, 0]) {
      const opened = registry.openPairing({ principalId: "p_person", authAt });
      const paired = registry.exchange({ code: opened.code, label: "", source: `10.0.1.${String(authAt).length}` });
      expect(paired.ok && registry.byId(paired.session.id)!.authAt).toBeUndefined();
      expect(registry.issue({ label: "x", scopes: ["client"], authAt }).session).toBeTruthy();
    }
    expect(registry.list().every((session) => !fresh(registry.byId(session.id)!))).toBe(true);
  });
});

describe("other sessions", () => {
  it("an account session is recent only with authAt, for 15 minutes", () => {
    const stamped = registry.issue({ label: "email", scopes: ["client"], userId: "u_a", principalId: "p_a", authAt: clock });
    const unstamped = registry.issue({ label: "Invited: a@example.com", scopes: ["client"], userId: "u_a", principalId: "p_a" });
    expect(fresh(registry.byId(stamped.session.id)!)).toBe(true);
    expect(fresh(registry.byId(unstamped.session.id)!)).toBe(false);
    clock += RECENT_SIGN_IN_MS;
    expect(fresh(registry.byId(stamped.session.id)!)).toBe(true);
    clock += 1;
    expect(fresh(registry.byId(stamped.session.id)!)).toBe(false);
  });

  it("a renewal (refresh) never resets the clock", () => {
    const issued = registry.issue({ label: "web", scopes: ["client"], principalId: "p_a", authAt: clock });
    clock += 20 * 24 * 60 * 60_000; // past half the term: renew extends it
    expect(registry.renew(issued.session.id)).toBe(true);
    expect(fresh(registry.byId(issued.session.id)!)).toBe(false);
  });

  it("a bot-act copy and an act-as session never count, even of a fresh session", () => {
    const issued = registry.issue({ label: "web", scopes: ["admin", "client"], principalId: "p_a", authAt: clock });
    const copy = registry.delegate(issued.session.id)!;
    const copied = registry.byId(copy.session.id)!;
    expect(copied.authAt).toBeUndefined();
    expect(fresh(copied)).toBe(false);
    // even a record that somehow carried one: an ephemeral session is not the person
    expect(recentInteractiveSignIn({ ...copied, authAt: clock })).toBe(false);
    const actAs = registry.actAs({ principalId: "p_a", scopes: ["client"], label: "Perspicax member API" })!;
    expect(fresh(registry.byId(actAs.session.id)!)).toBe(false);
  });

  it("survives a restart (authAt is stored)", () => {
    const issued = registry.issue({ label: "web", scopes: ["client"], principalId: "p_a", authAt: clock });
    registry.close();
    const again = new SessionRegistry({ file: join(dir, "sessions.json"), now });
    expect(again.byId(issued.session.id)?.authAt).toBe(clock);
  });
});

describe("the provider's auth_time (2026-10-19)", () => {
  it("dates the sign-in when it is recent, never later than now", () => {
    expect(authAtFromAuthTime(clock / 1000, clock)).toBe(clock);
    expect(authAtFromAuthTime(clock / 1000 - 600, clock)).toBe(clock - 600_000);
    expect(authAtFromAuthTime((clock - RECENT_SIGN_IN_MS) / 1000, clock)).toBe(clock - RECENT_SIGN_IN_MS);
    // a little skew ahead of this clock is dated now
    expect(authAtFromAuthTime((clock + AUTH_TIME_SKEW_MS) / 1000, clock)).toBe(clock);
  });

  it("gives nothing for an old sign-in (a silent single sign-on), a forged future or a value that is not a time", () => {
    expect(authAtFromAuthTime((clock - RECENT_SIGN_IN_MS) / 1000 - 1, clock)).toBeUndefined();
    expect(authAtFromAuthTime((clock + AUTH_TIME_SKEW_MS) / 1000 + 1, clock)).toBeUndefined();
    for (const value of [undefined, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(authAtFromAuthTime(value, clock)).toBeUndefined();
    }
  });
});

describe("loopback", () => {
  it("is the person only in the desktop app, never a headless server's loopback (a bot's shell)", () => {
    const owner: RequestAuth = { kind: "loopback", scopes: ["admin", "client"] };
    const service: RequestAuth = { kind: "loopback", scopes: ["client"], trust: "service" };
    expect(recentPersonSignIn(owner, { desktopManaged: true })).toBe(true);
    expect(recentPersonSignIn(owner, { desktopManaged: false })).toBe(false);
    expect(recentPersonSignIn(service, { desktopManaged: true })).toBe(false);
  });
});
