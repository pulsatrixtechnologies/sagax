// The sign-in again an account deletion needs (2026-10-18): tickets, the
// kept access token, its expiry, and the revocation of what goes unused.
import { describe, expect, it } from "vitest";

import { ACCOUNT_REAUTH_MAX_AGE_MS, ACCOUNT_REAUTH_TICKET_TTL_MS, AccountReauth, perspicaxDeletion, phoneReauthReturn, recentSignIn, webReauthReturn } from "./account-reauth.ts";

const ADA = { principalId: "pr_ada", subject: { iss: "https://px.example.test", sub: "ada-sub" }, sessionId: "s-ada" };
const T0 = 1_800_000_000_000;

function setup() {
  let clock = T0;
  const revoked: string[] = [];
  const reauth = new AccountReauth({ now: () => clock, revoke: (token, hint) => revoked.push(hint === "access_token" ? `access:${token}` : token) });
  return { reauth, revoked, tick: (ms: number) => { clock += ms; }, now: () => clock };
}

describe("recentSignIn", () => {
  it("is an auth_time of the last five minutes, never later than a minute ahead, never missing", () => {
    const now = T0;
    expect(recentSignIn(now / 1000, now)).toBe(true);
    expect(recentSignIn((now - ACCOUNT_REAUTH_MAX_AGE_MS) / 1000, now)).toBe(true);
    expect(recentSignIn((now - ACCOUNT_REAUTH_MAX_AGE_MS - 1000) / 1000, now)).toBe(false);
    expect(recentSignIn((now + 30_000) / 1000, now)).toBe(true);
    expect(recentSignIn((now + 120_000) / 1000, now)).toBe(false);
    expect(recentSignIn(undefined, now)).toBe(false);
    expect(recentSignIn(0, now)).toBe(false);
    expect(recentSignIn(Number.NaN, now)).toBe(false);
  });
});

describe("AccountReauth", () => {
  it("hands a ticket out once, before it expires", () => {
    const { reauth, tick } = setup();
    const { ticket, expiresAt } = reauth.openTicket(ADA, "phone");
    expect(expiresAt).toBe(T0 + ACCOUNT_REAUTH_TICKET_TTL_MS);
    expect(reauth.takeTicket(ticket)).toEqual({ expect: ADA, client: "phone" });
    expect(reauth.takeTicket(ticket)).toBeNull();
    const late = reauth.openTicket(ADA, "web").ticket;
    tick(ACCOUNT_REAUTH_TICKET_TTL_MS);
    expect(reauth.takeTicket(late)).toBeNull();
    expect(reauth.takeTicket("not-a-ticket")).toBeNull();
    expect(reauth.takeTicket(null)).toBeNull();
  });

  it("keeps one live ticket per session: a new one replaces it", () => {
    const { reauth } = setup();
    const first = reauth.openTicket(ADA, "web").ticket;
    const second = reauth.openTicket(ADA, "web").ticket;
    const other = reauth.openTicket({ ...ADA, sessionId: "s-other" }, "web").ticket;
    expect(reauth.takeTicket(first)).toBeNull();
    expect(reauth.takeTicket(second)).not.toBeNull();
    expect(reauth.takeTicket(other)).not.toBeNull();
  });

  it("keeps a recent sign-in for its session and person only, once", () => {
    const { reauth, revoked } = setup();
    expect(reauth.keep({ expect: ADA, accessToken: "at-1", refreshToken: "rt-1", authTimeSeconds: T0 / 1000 })).toBe(true);
    expect(reauth.take("s-ada", "pr_other")).toBeNull();
    expect(reauth.take("s-other", "pr_ada")).toBeNull();
    expect(reauth.take("s-ada", "pr_ada")).toEqual({ accessToken: "at-1", sub: "ada-sub", refreshToken: "rt-1" });
    expect(reauth.take("s-ada", "pr_ada")).toBeNull();
    // taken: the caller decides about its refresh token
    expect(revoked).toEqual([]);
  });

  it("refuses a sign-in that is not recent, or without an access token", () => {
    const { reauth } = setup();
    expect(reauth.keep({ expect: ADA, accessToken: "at", authTimeSeconds: (T0 - ACCOUNT_REAUTH_MAX_AGE_MS - 1000) / 1000 })).toBe(false);
    expect(reauth.keep({ expect: ADA, accessToken: "at", authTimeSeconds: undefined })).toBe(false);
    expect(reauth.keep({ expect: ADA, accessToken: "", authTimeSeconds: T0 / 1000 })).toBe(false);
    expect(reauth.has("s-ada")).toBe(false);
  });

  it("drops an unused sign-in five minutes after it was made and revokes its refresh token", () => {
    const { reauth, revoked, tick } = setup();
    // signed in 4 minutes ago: one minute left
    reauth.keep({ expect: ADA, accessToken: "at", refreshToken: "rt", authTimeSeconds: (T0 - 240_000) / 1000 });
    tick(59_000);
    expect(reauth.has("s-ada")).toBe(true);
    tick(1_000);
    reauth.sweep();
    expect(reauth.has("s-ada")).toBe(false);
    expect(revoked).toEqual(["rt"]);
    expect(reauth.take("s-ada", "pr_ada")).toBeNull();
  });

  it("revokes an unused access token itself at expiry when there is no refresh token", () => {
    const { reauth, revoked, tick } = setup();
    reauth.keep({ expect: ADA, accessToken: "at-only", authTimeSeconds: T0 / 1000 });
    tick(ACCOUNT_REAUTH_MAX_AGE_MS);
    reauth.sweep();
    expect(revoked).toEqual(["access:at-only"]);
  });

  it("replaces an earlier sign-in of the session, and forgets a session that ends, revoking both", () => {
    const { reauth, revoked } = setup();
    reauth.keep({ expect: ADA, accessToken: "at-1", refreshToken: "rt-1", authTimeSeconds: T0 / 1000 });
    reauth.keep({ expect: ADA, accessToken: "at-2", refreshToken: "rt-2", authTimeSeconds: T0 / 1000 });
    expect(revoked).toEqual(["rt-1"]);
    const ticket = reauth.openTicket(ADA, "web").ticket;
    reauth.forgetSession("s-ada");
    expect(revoked).toEqual(["rt-1", "rt-2"]);
    expect(reauth.takeTicket(ticket)).toBeNull();
  });

  it("lands the web app and the phone on their own returns", () => {
    expect(webReauthReturn({ ok: true })).toBe("/#account-reauth=ok");
    expect(webReauthReturn({ error: "reauth_subject" })).toBe("/#account-reauth-error=reauth_subject");
    expect(phoneReauthReturn("https://sagax.example.test", { ok: true })).toBe("sagax://account-reauth?address=https%3A%2F%2Fsagax.example.test&status=ok");
    expect(phoneReauthReturn("https://sagax.example.test", { error: "reauth_stale" })).toBe("sagax://account-reauth?address=https%3A%2F%2Fsagax.example.test&error=reauth_stale");
  });
});

describe("perspicaxDeletion (the wiring of DELETE /api/me)", () => {
  const person = { id: "pr_ada", sub: "ada-sub" };
  function wired(answer: { ok: true; sub: string } | { ok: false; error: string; status?: number }) {
    const { reauth, revoked } = setup();
    const erased: string[] = [];
    const revokedHere: string[] = [];
    const run = perspicaxDeletion({
      subjectOf: (id) => id === "pr_ada" ? person : null,
      reauth,
      erase: async (token) => { erased.push(token); return answer; },
      revoke: (token, hint) => revokedHere.push(hint === "access_token" ? `access:${token}` : token),
    });
    return { reauth, revoked, erased, revokedHere, run };
  }

  it("never erases without a sign-in made again for this session: the session's own token is never asked", async () => {
    const { run, erased } = wired({ ok: true, sub: "ada-sub" });
    expect(await run("pr_ada", "s-ada")).toEqual({ ok: false, error: "reauth_required" });
    expect(erased).toEqual([]);
    expect(await run("pr_nobody", "s-ada")).toEqual({ ok: false, error: "link" });
  });

  it("erases with the fresh access token once, then asks again", async () => {
    const { reauth, run, erased, revokedHere } = wired({ ok: true, sub: "ada-sub" });
    reauth.keep({ expect: ADA, accessToken: "fresh-at", refreshToken: "fresh-rt", authTimeSeconds: T0 / 1000 });
    expect(await run("pr_ada", "s-other")).toEqual({ ok: false, error: "reauth_required" });
    expect(await run("pr_ada", "s-ada")).toEqual({ ok: true });
    expect(erased).toEqual(["fresh-at"]);
    expect(revokedHere).toEqual([]);
    expect(await run("pr_ada", "s-ada")).toEqual({ ok: false, error: "reauth_required" });
  });

  it("revokes the sign-in's grant when Perspicax refuses (a refresh it found too old included)", async () => {
    const { reauth, run, revokedHere } = wired({ ok: false, error: "reauth_required", status: 403 });
    reauth.keep({ expect: ADA, accessToken: "fresh-at", refreshToken: "fresh-rt", authTimeSeconds: T0 / 1000 });
    expect(await run("pr_ada", "s-ada")).toEqual({ ok: false, error: "reauth_required", status: 403 });
    expect(revokedHere).toEqual(["fresh-rt"]);
  });

  it("revokes the access token itself when the sign-in again has no refresh token (no offline_access)", async () => {
    const { reauth, run, revokedHere, revoked } = wired({ ok: false, error: "last_admin", status: 409 });
    reauth.keep({ expect: ADA, accessToken: "only-at", authTimeSeconds: T0 / 1000 });
    expect(await run("pr_ada", "s-ada")).toMatchObject({ ok: false, error: "last_admin" });
    expect(revokedHere).toEqual(["access:only-at"]);
    expect(revoked).toEqual([]);
  });

  it("deletes nothing on an answer about another subject", async () => {
    const { reauth, run } = wired({ ok: true, sub: "someone-else" });
    reauth.keep({ expect: ADA, accessToken: "fresh-at", authTimeSeconds: T0 / 1000 });
    expect(await run("pr_ada", "s-ada")).toEqual({ ok: false, error: "unreachable" });
  });
});
