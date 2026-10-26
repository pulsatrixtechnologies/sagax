// 2026-10-20 (JC): a person is signed out ONLY when their session is
// revoked, their account disabled, or after 30 days without use. Never by a
// Sagax or Perspicax deploy, an app update, a refresh that failed, or a
// sensitive action. A real organization server on a fake Perspicax that
// rotates refresh tokens and keeps a 30 s reuse grace, like the real one.
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startOrgServer, type Auth, type OrgServer } from "./testing/org-server-harness.ts";
import type { FakeOidcUser } from "./testing/fake-oidc-provider.ts";

const posixOnly = describe.skipIf(process.platform === "win32");
const person = (name: string, role = "employee"): FakeOidcUser => ({
  sub: `01JNOLOGOUT${name.toUpperCase().padEnd(15, "0")}`.slice(0, 26),
  email: `${name}@example.test`, name, preferred_username: name, role,
});
const ALICE = person("alice", "admin");
const BOB = person("bob");
const CAROL = person("carol");
const DAVE = person("dave");
const ERIN = person("erin");
const FRED = person("fred");
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let org: OrgServer;
const session = (auth: Auth) => org.api("GET", "/api/auth/session", auth);
async function until(check: () => Promise<boolean>, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`timed out\n${org.log().slice(-3000)}`);
    await sleep(250);
  }
}

posixOnly("no sign-out by a deploy, an update or a refresh", () => {
  beforeAll(async () => {
    // every request after a second refreshes its grant: the refresh path is
    // exercised on almost every call
    org = await startOrgServer({ user: ALICE, refreshAfterSeconds: 1, prefix: "sagax-no-logout-" });
    org.idp.reuseGraceMs = 30_000;
  }, 60_000);

  afterAll(async () => {
    await org?.close();
  });

  it("jeton expiré -> rafraîchi en silence", async () => {
    const alice = await org.signIn(ALICE);
    await sleep(1_200);
    const before = org.idp.refreshCount;
    const answer = await session(alice);
    expect(answer.status).toBe(200);
    expect(org.idp.refreshCount).toBeGreaterThan(before);
    // the cookie is sent back with its full 30-day term on use
    const cookie = answer.headers.get("set-cookie") ?? "";
    const maxAge = Number(/Max-Age=(\d+)/.exec(cookie)?.[1] ?? 0);
    expect(maxAge).toBeGreaterThan(29 * 86_400);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).not.toMatch(/Domain=/i);
    await sleep(1_200);
    expect((await session(alice)).status).toBe(200);
  });

  it("redéploiement Sagax : une session survit à un arrêt propre, à un arrêt brutal et à un arrêt pendant un rafraîchissement", async () => {
    const bob = await org.signIn(BOB);
    const carol = await org.signIn(CAROL);
    // clean stop
    await org.restart("SIGTERM");
    expect((await session(bob)).status).toBe(200);
    // unclean stop
    await org.restart("SIGKILL");
    expect((await session(bob)).status, org.log().slice(-2000)).toBe(200);
    expect((await session(carol)).status).toBe(200);
    // a stop in the middle of a refresh: Perspicax rotated, the answer is
    // lost with the process. The next boot resumes the refresh at once and
    // Perspicax's reuse grace hands back the same pair.
    await sleep(1_200);
    org.idp.delayNextRefreshAnswer(4_000);
    const pending = session(carol).catch(() => null);
    await sleep(600);
    await org.kill("SIGKILL");
    await pending;
    await org.start();
    expect(org.log()).toMatch(/resuming 1 sign-in refresh/);
    const after = await session(carol);
    expect(after.status, org.log().slice(-3000)).toBe(200);
    // and the token it kept is the live one: the next refreshes still pass
    for (let i = 0; i < 2; i++) {
      await sleep(1_200);
      expect((await session(carol)).status, org.log().slice(-3000)).toBe(200);
    }
    expect((await session(bob)).status).toBe(200);
  }, 90_000);

  it("redéploiement Perspicax : fournisseur arrêté puis relancé pendant un rafraîchissement, aucune déconnexion", async () => {
    const dave = await org.signIn(DAVE);
    await sleep(1_200);
    // Perspicax is down: the refresh fails, the session is still served
    await org.idp.stop();
    for (let i = 0; i < 3; i++) {
      const answer = await session(dave);
      expect(answer.status, org.log().slice(-2000)).toBe(200);
      await sleep(400);
    }
    await org.idp.start();
    // the quick retry (5 s) refreshes it on its own
    const before = org.idp.refreshCount;
    await until(async () => org.idp.refreshCount > before, 20_000);
    expect((await session(dave)).status).toBe(200);
    // its answer lost on the way (a deploy cutting the connection): the
    // quick retry inside the 30 s grace gets the same pair, the session stays
    await sleep(1_200);
    org.idp.dropNextRefreshAnswer();
    expect((await session(dave)).status).toBe(200);
    await sleep(7_000);
    for (let i = 0; i < 2; i++) {
      await sleep(1_200);
      expect((await session(dave)).status, org.log().slice(-3000)).toBe(200);
    }
    // client errors from a provider being reconfigured are no refusal
    await sleep(1_200);
    org.idp.failNextToken(503);
    expect((await session(dave)).status).toBe(200);
    expect(org.log()).not.toMatch(/auth: session ended[^\n]*session=/);
  }, 90_000);

  it("mise à jour de l'app : un nouveau client avec le seul cookie, après un redéploiement, reste connecté", async () => {
    const erin = await org.signIn(ERIN);
    await org.restart("SIGKILL");
    const res = await fetch(`${org.base}/api/auth/session`, { headers: { cookie: erin.cookie, "cache-control": "no-cache" } });
    expect(res.status, org.log().slice(-2000)).toBe(200);
  });

  it("révocation -> déconnexion, avec un code net et une ligne de journal", async () => {
    const fred = await org.signIn(FRED);
    const fredPhone = await org.signIn(FRED);
    expect((await session(fred)).status).toBe(200);
    // signed out (the person's own choice): out at once, told why
    expect((await org.api("POST", "/api/auth/logout", fred, {})).status).toBeLessThan(300);
    const out = await session(fred);
    expect(out.status).toBe(401);
    expect(out.body.code).toBe("session_revoked");
    expect(out.headers.get("set-cookie") ?? "").toMatch(/Max-Age=0/);
    // still told why after a restart
    await org.restart("SIGTERM");
    expect((await session(fred)).body.code).toBe("session_revoked");
    // a token this server never issued: unknown, which clients retry
    const stranger = await session({ cookie: fred.cookie.replace(/=.*/, "=sgx_sess_never-issued") });
    expect(stranger.status).toBe(401);
    expect(stranger.body.code).toBe("session_unknown");
    // disabled at Perspicax: refused twice, the sign-in ends
    await sleep(1_200);
    org.idp.disable(FRED.sub);
    const ended = await session(fredPhone);
    expect(ended.status).toBe(401);
    expect(ended.body.code).toBe("idp_session_ended");
    expect((await session(fredPhone)).body.code).toBe("idp_session_ended");
    org.idp.enable(FRED.sub);
    // every one of those is in the log, with a session prefix and the client, never the token
    const log = org.log();
    expect(log).toMatch(/auth: session refused status=401 code=session_revoked route=GET \/api\/auth\/session via=cookie client=node session=[\w-]{8}/);
    expect(log).toMatch(/auth: session refused status=401 code=session_unknown/);
    expect(log).toMatch(/code=idp_session_ended/);
    for (const auth of [fred, fredPhone]) expect(log).not.toContain(auth.cookie.split("=")[1]!);
  }, 60_000);

  it("action sensible -> confirmation ponctuelle sans déconnexion", async () => {
    // a sign-in made 20 minutes ago: valid, but not recent
    const alice = await org.signIn(ALICE, { authTimeAgoSeconds: 20 * 60 });
    const refused = await org.api("POST", "/api/security-keys/register", alice, { name: "Clé", via: "desktop-window" });
    expect(refused.status, JSON.stringify(refused.body)).toBe(403);
    expect(refused.body.code).toBe("reauth_required");
    expect(refused.headers.get("set-cookie") ?? "").not.toMatch(/Max-Age=0/);
    // still signed in
    expect((await session(alice)).status).toBe(200);
    // the one-off confirmation: "Sign in again" (fresh=1) in the same browser
    const again = await org.signIn(ALICE, { fresh: true, previous: alice });
    expect(org.idp.lastAuthorize?.prompt).toBe("login");
    const allowed = await org.api("POST", "/api/security-keys/register", again, { name: "Clé", via: "desktop-window" });
    expect(allowed.status, JSON.stringify(allowed.body)).toBe(200);
    // the earlier session was never ended by it
    expect((await session(alice)).status).toBe(200);
    expect((await session(again)).status).toBe(200);
  }, 60_000);
});
