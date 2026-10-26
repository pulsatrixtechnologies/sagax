import { createRequire } from "node:module";
// Configuration and role mapping of "Sign in with Pulsatrix" (the routes
// themselves are proven through the real server in oidc-login.e2e.test.ts).
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { AccountReauth } from "./account-reauth.ts";
import { IDP_SWEEP_SLACK_MS, IdpGrantVault, IdpSessionManager } from "./idp-session.ts";
import { BACKCHANNEL_MAX_BODY_BYTES, OIDC_NATIVE_BIND_GRACE_MS, OIDC_NATIVE_PAIRING_TTL_MS, createOidcLoginRoutes, type OidcGrantKeeper, desktopReturnLink, identityConfigFromEnv, identityDescriptor, isInterimSignInRoute, orgRoleForRole, phoneErrorLink, phoneReturnLink, profileManagement, sagaxReturnLink, scopesForRole, validLoopbackReturn, writesManagedProfile } from "./oidc-login.ts";
import { RoutineConsents } from "./org-routine-consent.ts";
import { ACCOUNT_PURGED_EVENT, OidcRelyingParty } from "./oidc-rp.ts";
import { PrincipalRegistry } from "./principals.ts";
import { recentInteractiveSignIn } from "./recent-sign-in.ts";
import { SessionRegistry } from "./sessions.ts";
import { startFakeOidcProvider, type FakeOidcProvider } from "./testing/fake-oidc-provider.ts";

/** Every regular expression metacharacter escaped, not only the dots. */
const escapeRegExp = (text: string) => text.replace(/[\\^$.*+?()[\]{}|/]/g, "\\$&");

describe("SAGAX_IDENTITY", () => {
  it("is solo unless set to perspicax", () => {
    expect(identityConfigFromEnv({})).toEqual({ kind: "solo" });
    expect(identityConfigFromEnv({ SAGAX_IDENTITY: "solo" })).toEqual({ kind: "solo" });
    expect(identityDescriptor({ kind: "solo" })).toBeUndefined();
    expect(() => identityConfigFromEnv({ SAGAX_IDENTITY: "okta" })).toThrow(/not supported/);
  });

  it("derives the redirect URI from the public origin and defaults the client id", () => {
    const config = identityConfigFromEnv({ SAGAX_IDENTITY: "perspicax", SAGAX_PERSPICAX_ISSUER: "https://px.example.test/", SAGAX_PUBLIC_URL: "https://bot.example.test/" });
    expect(config).toEqual({ kind: "perspicax", issuer: "https://px.example.test", clientId: "pulsa-bot", publicOrigin: "https://bot.example.test", redirectUri: "https://bot.example.test/auth/oidc/callback" });
    expect(identityDescriptor(config)).toEqual({ kind: "perspicax", protocol: "oidc", issuer: "https://px.example.test", loginPath: "/auth/oidc/start", nativeReturn: true, loopbackReturn: true, nativeReturnSchemes: ["sagax", "openmausbot"], phoneReturnSchemes: ["sagax", "openmausbot"] });
    expect(identityConfigFromEnv({ SAGAX_IDENTITY: "perspicax", SAGAX_PERSPICAX_ISSUER: "http://localhost:18787", SAGAX_PUBLIC_URL: "http://localhost:18788", SAGAX_OIDC_CLIENT_ID: "other" }))
      .toMatchObject({ clientId: "other", redirectUri: "http://localhost:18788/auth/oidc/callback" });
  });

  it("refuses to start half configured or over plain http off this machine", () => {
    expect(() => identityConfigFromEnv({ SAGAX_IDENTITY: "perspicax", SAGAX_PUBLIC_URL: "https://bot.example.test" })).toThrow(/SAGAX_PERSPICAX_ISSUER/);
    expect(() => identityConfigFromEnv({ SAGAX_IDENTITY: "perspicax", SAGAX_PERSPICAX_ISSUER: "http://px.example.test", SAGAX_PUBLIC_URL: "https://bot.example.test" })).toThrow(/SAGAX_PERSPICAX_ISSUER/);
    expect(() => identityConfigFromEnv({ SAGAX_IDENTITY: "perspicax", SAGAX_PERSPICAX_ISSUER: "https://px.example.test" })).toThrow(/SAGAX_PUBLIC_URL/);
    expect(() => identityConfigFromEnv({ SAGAX_IDENTITY: "perspicax", SAGAX_PERSPICAX_ISSUER: "https://px.example.test", SAGAX_PUBLIC_URL: "http://bot.example.test" })).toThrow(/SAGAX_PUBLIC_URL/);
    expect(() => identityConfigFromEnv({ SAGAX_IDENTITY: "perspicax", SAGAX_PERSPICAX_ISSUER: "https://px.example.test", SAGAX_PUBLIC_URL: "https://bot.example.test/app" })).toThrow(/SAGAX_PUBLIC_URL/);
  });

  it("takes an optional internal origin for server-to-server calls (http allowed, no path)", () => {
    const base = { SAGAX_IDENTITY: "perspicax", SAGAX_PERSPICAX_ISSUER: "https://px.example.test", SAGAX_PUBLIC_URL: "https://bot.example.test" };
    expect(identityConfigFromEnv({ ...base, SAGAX_PERSPICAX_INTERNAL_URL: "http://perspicax:8787/" })).toMatchObject({ internalBase: "http://perspicax:8787" });
    expect(identityConfigFromEnv(base)).not.toHaveProperty("internalBase");
    expect(() => identityConfigFromEnv({ ...base, SAGAX_PERSPICAX_INTERNAL_URL: "http://perspicax:8787/api" })).toThrow(/SAGAX_PERSPICAX_INTERNAL_URL/);
    expect(() => identityConfigFromEnv({ ...base, SAGAX_PERSPICAX_INTERNAL_URL: "ftp://perspicax" })).toThrow(/SAGAX_PERSPICAX_INTERNAL_URL/);
  });
});

describe("a desktop sign-in's loopback return (RFC 8252 7.3)", () => {
  const STATE = "AbCdEfGhIjKlMnOpQrStUvWxYz012345_-xy";
  it("accepts http on 127.0.0.1 or [::1] with an explicit port and the listener's state", () => {
    expect(validLoopbackReturn(`http://127.0.0.1:53123/${STATE}`)).toBe(`http://127.0.0.1:53123/${STATE}`);
    expect(validLoopbackReturn(`http://[::1]:1024/${STATE}`)).toBe(`http://[::1]:1024/${STATE}`);
    expect(validLoopbackReturn(`http://127.0.0.1:65535/${STATE}`)).not.toBeNull();
  });
  it("refuses host names, other hosts, https, no port, a privileged or out-of-range port, and anything around the state", () => {
    for (const bad of [
      `http://localhost:53123/${STATE}`,
      `http://127.0.0.2:53123/${STATE}`,
      `http://10.0.0.1:53123/${STATE}`,
      `http://evil.example:53123/${STATE}`,
      `http://127.0.0.1.evil.example:53123/${STATE}`,
      `http://[::2]:53123/${STATE}`,
      `https://127.0.0.1:53123/${STATE}`,
      `openmausbot://auth/${STATE}`,
      `http://127.0.0.1/${STATE}`,
      `http://127.0.0.1:80/${STATE}`,
      `http://127.0.0.1:0999/${STATE}`,
      `http://127.0.0.1:65536/${STATE}`,
      `http://127.0.0.1:99999/${STATE}`,
      `http://user:pw@127.0.0.1:53123/${STATE}`,
      `http://127.0.0.1:53123/${STATE}?x=1`,
      `http://127.0.0.1:53123/${STATE}#code=1`,
      `http://127.0.0.1:53123/a/${STATE}`,
      `http://127.0.0.1:53123/${STATE}/`,
      " http://127.0.0.1:53123/" + STATE,
      `HTTP://127.0.0.1:53123/${STATE}`,
      "",
      null,
      undefined,
    ]) expect(validLoopbackReturn(bad), String(bad)).toBeNull();
  });
  it("refuses a missing or too short state", () => {
    expect(validLoopbackReturn("http://127.0.0.1:53123/")).toBeNull();
    expect(validLoopbackReturn("http://127.0.0.1:53123")).toBeNull();
    expect(validLoopbackReturn("http://127.0.0.1:53123/short")).toBeNull();
    expect(validLoopbackReturn(`http://127.0.0.1:53123/${"a".repeat(129)}`)).toBeNull();
  });
  it("puts the credential or the error in the fragment of that return", () => {
    const back = `http://127.0.0.1:53123/${STATE}`;
    expect(desktopReturnLink("https://bot.example.test", { code: "omb_pair_x" }, back)).toBe(`${back}#code=omb_pair_x`);
    expect(desktopReturnLink("https://bot.example.test", { error: "role" }, back)).toBe(`${back}#error=role`);
    expect(desktopReturnLink("https://bot.example.test", { code: "omb_pair_x" })).toBe("openmausbot://auth?origin=https%3A%2F%2Fbot.example.test#code=omb_pair_x");
  });
});

describe("the role claim", () => {
  it("maps admin to admin scopes, manager and employee (or no claim) to client, anything else to nothing", () => {
    expect(scopesForRole("admin")).toEqual(["admin", "client"]);
    expect(orgRoleForRole("admin")).toBe("admin");
    for (const role of ["manager", "employee", undefined]) {
      expect(scopesForRole(role)).toEqual(["client"]);
      expect(orgRoleForRole(role)).toBe("member");
    }
    expect(scopesForRole("service")).toBeNull();
    expect(orgRoleForRole("owner")).toBeNull();
  });
});

describe("interim sign-in routes on an organization server", () => {
  it("covers email codes and every invitation path, nothing else", () => {
    expect(isInterimSignInRoute("POST", "/api/auth/email/start")).toBe(true);
    expect(isInterimSignInRoute("POST", "/api/auth/email/verify")).toBe(true);
    expect(isInterimSignInRoute("POST", "/api/org/invites")).toBe(true);
    expect(isInterimSignInRoute("GET", "/api/org/invites/abc/preview")).toBe(true);
    expect(isInterimSignInRoute("POST", "/api/org/invites/abc/join")).toBe(true);
    expect(isInterimSignInRoute("GET", "/api/org")).toBe(false);
    expect(isInterimSignInRoute("POST", "/api/auth/pair")).toBe(false);
    expect(isInterimSignInRoute("GET", "/api/org/invitesx")).toBe(false);
  });
});

describe("a person's profile on an organization server", () => {
  it("is managed by Perspicax, edited in the issuer console's /console/me", () => {
    const org = identityConfigFromEnv({ SAGAX_IDENTITY: "perspicax", SAGAX_PERSPICAX_ISSUER: "https://issuer.example.com", SAGAX_PUBLIC_URL: "https://sagax.example.com" });
    expect(profileManagement(org)).toEqual({ profileManagedBy: "perspicax", profileManageUrl: "https://issuer.example.com/console/me" });
  });

  it("is the server's own on a solo server", () => {
    expect(profileManagement({ kind: "solo" })).toBeNull();
  });

  it("refuses a name or an email, never the about-me or the photo", () => {
    expect(writesManagedProfile({ profile: { name: "JC" } })).toBe(true);
    expect(writesManagedProfile({ profile: { email: "jc@example.test" } })).toBe(true);
    expect(writesManagedProfile({ profile: { name: "", email: "" } })).toBe(true);
    expect(writesManagedProfile({ profile: { aboutMe: "Prefers French" } })).toBe(false);
    expect(writesManagedProfile({ profile: { avatarUrl: "" } })).toBe(false);
    expect(writesManagedProfile({ language: "fr" })).toBe(false);
    expect(writesManagedProfile(null)).toBe(false);
    expect(writesManagedProfile([])).toBe(false);
  });
});

// ── the routes in process (slice 2): native returns and back-channel logout ──

describe("the sign-in routes (in process)", () => {
  const USER = { sub: "01J9ROUTES0000000000000000", email: "ada@example.test", name: "Ada", preferred_username: "ada", role: "employee" };
  let provider: FakeOidcProvider;
  let server: Server;
  let base = "";
  let dir = "";
  let sessions: SessionRegistry;
  let principals: PrincipalRegistry;
  let manager: IdpSessionManager;
  let vaultOk = true;
  const createdGrants: Array<{ bindBy: number; at: number }> = [];
  const signedIn: Array<{ principalId: string; accessToken?: string }> = [];
  let rp: OidcRelyingParty;
  let consents: RoutineConsents;
  let grantKeeper: OidcGrantKeeper;
  const reauth = new AccountReauth();

  beforeAll(async () => {
    provider = await startFakeOidcProvider({ user: USER });
    dir = mkdtempSync(join(tmpdir(), "omb-oidc-routes-"));
    server = createServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const config = { kind: "perspicax" as const, issuer: provider.issuer, clientId: "pulsa-bot", publicOrigin: base, redirectUri: `${base}/auth/oidc/callback` };
    rp = new OidcRelyingParty({ issuer: config.issuer, clientId: config.clientId, redirectUri: config.redirectUri, resource: base });
    sessions = new SessionRegistry({ file: join(dir, "sessions.json") });
    principals = new PrincipalRegistry({ path: join(dir, "principals.json") });
    const vault = new IdpGrantVault(dir, () => vaultOk ? { kind: "key", key: Buffer.alloc(32, 7) } : { kind: "unavailable", reason: "no key" });
    manager = new IdpSessionManager({ vault, rp, sessions, principals, log: () => {} });
    consents = new RoutineConsents({ vault, rp, principals, log: () => {} });
    sessions.onExchanged((session) => { if (session.idp?.grantRef) manager.bindSession(session.idp.grantRef, session.id); });
    grantKeeper = {
        unavailableReason: () => vaultOk ? null : "no key",
        createGrant: (input) => { createdGrants.push({ bindBy: input.bindBy, at: Date.now() }); return manager.createGrant(input); },
        bindSession: (ref, id) => manager.bindSession(ref, id),
        discard: (ref) => manager.discard(ref),
        backchannelLogout: (input) => manager.backchannelLogout(input),
        createRoutineDelegation: (input) => consents.create(input),
        sessionPrincipal: (id) => sessions.byId(id)?.principalId ?? null,
        signedIn: (input) => signedIn.push({ principalId: input.principalId, ...(input.accessToken ? { accessToken: input.accessToken } : {}) }),
    };
    const routes = createOidcLoginRoutes({
      config, rp, sessionCookie: "omb_session_test",
      forSubject: (input) => principals.forSubject(input),
      issueSession: (input) => sessions.issue(input),
      grants: grantKeeper,
      openPairing: (input) => sessions.openPairing(input),
      serverName: () => "Acme & Co bots",
      log: () => {},
      reauth,
    });
    server.on("request", (req, res) => {
      void routes(req, res, new URL(req.url ?? "/", base)).then((handled) => {
        if (!handled) { res.writeHead(404); res.end(); }
      });
    });
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await provider.close();
    rmSync(dir, { recursive: true, force: true });
  });
  beforeEach(() => {
    vaultOk = true;
    provider.user = { ...USER };
  });

  async function walk(client?: string, options: { binding?: string; returnTo?: string; fresh?: boolean } = {}) {
    const query = new URLSearchParams();
    if (client) query.set("client", client);
    if (options.returnTo !== undefined) query.set("return", options.returnTo);
    if (options.fresh) query.set("fresh", "1");
    const start = await fetch(`${base}/auth/oidc/start${query.size ? `?${query}` : ""}`, { redirect: "manual" });
    const location = start.headers.get("location") ?? "";
    if (!location.startsWith(provider.issuer)) return { start, callback: null as Response | null, location };
    const bindingCookie = start.headers.getSetCookie().find((c) => c.includes("_oidc="))!.split(";")[0]!;
    const authorize = await fetch(location, { redirect: "manual" });
    const callback = await fetch(authorize.headers.get("location")!, { redirect: "manual", headers: { cookie: options.binding ?? bindingCookie } });
    return { start, callback, location: callback.headers.get("location") ?? "" };
  }

  it("hands every sign-in's access token to the routine delegation, web and desktop, with no consent (2026-10-08)", async () => {
    signedIn.length = 0;
    expect((await walk()).location).toBe("/");
    expect((await walk("desktop")).location).toMatch(/^openmausbot:\/\/auth/);
    const person = principals.bySubject(provider.issuer, USER.sub)!;
    expect(signedIn).toEqual([
      { principalId: person.id, accessToken: expect.stringMatching(/^pxlo1\./) },
      { principalId: person.id, accessToken: expect.stringMatching(/^pxlo1\./) },
    ]);
    // a refused sign-in hands nothing
    vaultOk = false;
    await walk();
    expect(signedIn).toHaveLength(2);
  });

  it("refuses an unknown client, and a start while grants cannot be kept", async () => {
    const bad = await walk("tablet");
    expect(bad.start.status).toBe(303);
    expect(bad.location).toBe("/pair#signin_error=client");
    vaultOk = false;
    expect((await walk()).location).toBe("/pair#signin_error=unavailable");
    expect((await walk("desktop")).location).toBe(`openmausbot://auth?origin=${encodeURIComponent(base)}#error=unavailable`);
  });

  it("ends a desktop sign-in on openmausbot://auth with a person-bound, single-use pairing credential", async () => {
    const { callback, location } = await walk("desktop");
    expect(callback!.status).toBe(303);
    expect(callback!.headers.get("cache-control")).toBe("no-store");
    expect(callback!.headers.get("referrer-policy")).toBe("no-referrer");
    expect(callback!.headers.getSetCookie().some((c) => c.startsWith("omb_session_test="))).toBe(false);
    const match = /^openmausbot:\/\/auth\?origin=([^#&]+)#code=(omb_pair_[A-Za-z0-9_-]{43})$/.exec(location);
    expect(match, location).not.toBeNull();
    expect(decodeURIComponent(match![1]!)).toBe(base);
    expect(location).toBe(desktopReturnLink(base, { code: match![2]! }));
    const exchanged = sessions.exchange({ code: match![2]!, label: "My Mac", source: "10.0.0.1" });
    expect(exchanged.ok).toBe(true);
    if (!exchanged.ok) return;
    const record = sessions.byId(exchanged.session.id)!;
    const person = principals.bySubject(provider.issuer, USER.sub)!;
    expect(record).toMatchObject({ principalId: person.id, scopes: ["client"], idp: { iss: provider.issuer, sub: USER.sub, role: "employee", grantRef: expect.any(String) } });
    expect(manager.mustRefuse(record)).toBeNull();
    // 2026-10-18: the desktop's session carries the provider sign-in as its
    // recent sign-in (server/recent-sign-in.ts), not the pairing's moment
    expect(recentInteractiveSignIn(record)).toBe(true);
    expect(sessions.exchange({ code: match![2]!, label: "again", source: "10.0.0.1" }).ok).toBe(false);
  });

  it("revokes an unredeemed native grant within three minutes of the flow start, after its credential has expired", async () => {
    expect(OIDC_NATIVE_PAIRING_TTL_MS + OIDC_NATIVE_BIND_GRACE_MS + IDP_SWEEP_SLACK_MS).toBeLessThanOrEqual(170_000);
    for (const client of ["desktop", "phone"]) {
      createdGrants.length = 0;
      const flowStart = Date.now();
      await walk(client);
      expect(createdGrants).toHaveLength(1);
      const { bindBy, at } = createdGrants[0]!;
      expect(bindBy).toBeGreaterThanOrEqual(at + OIDC_NATIVE_PAIRING_TTL_MS);
      expect(bindBy + IDP_SWEEP_SLACK_MS - flowStart).toBeLessThan(180_000);
    }
  });

  it("ends a desktop sign-in on its loopback listener, the credential in the fragment, errors too", async () => {
    const back = `http://127.0.0.1:53123/${"S".repeat(43)}`;
    const { callback, location } = await walk("desktop", { returnTo: back });
    expect(callback!.status).toBe(303);
    expect(callback!.headers.get("cache-control")).toBe("no-store");
    expect(callback!.headers.get("referrer-policy")).toBe("no-referrer");
    const match = new RegExp(`^${escapeRegExp(back)}#code=(omb_pair_[A-Za-z0-9_-]{43})$`).exec(location);
    expect(match, location).not.toBeNull();
    expect(sessions.exchange({ code: match![1]!, label: "My Mac", source: "10.0.0.1" }).ok).toBe(true);
    // an [::1] listener too
    const v6 = `http://[::1]:61000/${"T".repeat(40)}`;
    expect((await walk("desktop", { returnTo: v6 })).location).toMatch(new RegExp(`^http://\\[::1\\]:61000/T{40}#code=omb_pair_`));
    // a refusal at the callback and at the start both come back to the listener
    expect((await walk("desktop", { returnTo: back, binding: "omb_session_test_oidc=wrong" })).location).toBe(`${back}#error=binding`);
    vaultOk = false;
    expect((await walk("desktop", { returnTo: back })).location).toBe(`${back}#error=unavailable`);
  });

  it("names the sagax:// return exactly as the desktop app does", () => {
    const desktop = createRequire(import.meta.url)("../electron/oidc-system-sign-in.cjs") as { sagaxReturnLink(origin: string): string };
    expect(sagaxReturnLink("https://bot.example.test")).toBe(desktop.sagaxReturnLink("https://bot.example.test"));
  });

  it("ends a desktop sign-in on sagax://auth when the start names exactly that return", async () => {
    const back = sagaxReturnLink(base);
    const { location } = await walk("desktop", { returnTo: back });
    expect(location).toMatch(new RegExp(`^sagax://auth\\?origin=${escapeRegExp(encodeURIComponent(base))}#code=omb_pair_[A-Za-z0-9_-]{43}$`));
    for (const returnTo of [sagaxReturnLink("https://evil.example"), `${back}&x=1`, "sagax://auth", "openmausbot://auth"]) {
      expect((await walk("desktop", { returnTo })).location, returnTo).toBe("/pair#signin_error=return");
    }
    expect((await walk("phone", { returnTo: back })).location).toBe("/pair#signin_error=return");
  });

  it("refuses a return that is not a loopback listener, or on another client, without going there", async () => {
    for (const returnTo of ["http://localhost:53123/" + "S".repeat(43), "http://evil.example:53123/" + "S".repeat(43), "http://127.0.0.1:53123/", "https://127.0.0.1:53123/" + "S".repeat(43), ""]) {
      const { start, location } = await walk("desktop", { returnTo });
      expect(start.status).toBe(303);
      expect(location, returnTo).toBe("/pair#signin_error=return");
    }
    for (const client of ["phone", "web"]) {
      expect((await walk(client, { returnTo: `http://127.0.0.1:53123/${"S".repeat(43)}` })).location).toBe("/pair#signin_error=return");
    }
    expect(rp.pendingCount()).toBe(0);
  });

  it("ends a phone sign-in on the invite link both phone apps already parse", async () => {
    const { location } = await walk("phone");
    const url = new URL(location);
    expect(url.protocol).toBe("sagax:");
    expect(url.host).toBe("pair");
    expect(url.searchParams.get("address")).toBe(base);
    expect(url.searchParams.get("name")).toBe("Acme & Co bots");
    const token = url.searchParams.get("token")!;
    expect(token).toMatch(/^omb_pair_[A-Za-z0-9_-]{43}$/);
    expect(location).toBe(phoneReturnLink(base, token, "Acme & Co bots"));
  });

  it("ends a phone sign-in that names return=sagax on sagax://pair, and its refusals there too", async () => {
    const { location } = await walk("phone", { returnTo: "sagax" });
    const url = new URL(location);
    expect(url.protocol).toBe("sagax:");
    expect(url.host).toBe("pair");
    expect(url.searchParams.get("address")).toBe(base);
    const token = url.searchParams.get("token")!;
    expect(token).toMatch(/^omb_pair_[A-Za-z0-9_-]{43}$/);
    expect(location).toBe(phoneReturnLink(base, token, "Acme & Co bots", "sagax"));
    // a refusal comes back to the app, never to the web /pair page
    expect((await walk("phone", { returnTo: "sagax", binding: "omb_session_test_oidc=wrong" })).location).toBe(phoneErrorLink(base, "binding"));
    expect(phoneErrorLink(base, "binding")).toBe(`sagax://pair?address=${encodeURIComponent(base)}&error=binding`);
    // only that exact word, and only for a phone
    for (const returnTo of ["sagax://pair", "SAGAX", "openmausbot", ""]) {
      expect((await walk("phone", { returnTo })).location, returnTo).toBe("/pair#signin_error=return");
    }
    expect((await walk("desktop", { returnTo: "sagax" })).location).toBe("/pair#signin_error=return");
    expect((await walk("web", { returnTo: "sagax" })).location).toBe("/pair#signin_error=return");
  });

  it("sends desktop errors back to the app, phone and web errors to /pair", async () => {
    expect((await walk("desktop", { binding: "omb_session_test_oidc=wrong" })).location).toBe(`openmausbot://auth?origin=${encodeURIComponent(base)}#error=binding`);
    expect((await walk("phone", { binding: "omb_session_test_oidc=wrong" })).location).toBe("/pair#signin_error=binding");
    provider.user = { ...USER, sub: "01J9SERVICE", role: "service" };
    const revokedBefore = provider.revoked.length;
    expect((await walk("desktop")).location).toBe(`openmausbot://auth?origin=${encodeURIComponent(base)}#error=role`);
    await new Promise((r) => setTimeout(r, 100));
    expect(provider.revoked.length).toBe(revokedBefore + 1); // the refused sign-in's grant is revoked
  });

  /** Slice 6: sign in on the web, then walk a routine delegation flow the
   * way POST /api/org/routine-delegation starts it. */
  async function delegate(options: { as?: typeof USER; sessionGone?: boolean; binding?: string; failToken?: number } = {}) {
    const { callback } = await walk();
    const cookie = callback!.headers.getSetCookie().find((c) => c.startsWith("omb_session_test="))!;
    const record = sessions.authenticate(decodeURIComponent(cookie.split(";")[0]!.split("=")[1]!))!;
    const started = await rp.start({ purpose: "routines", principalId: record.principalId!, subject: { iss: provider.issuer, sub: record.idp!.sub }, sessionId: record.id });
    if (options.as) provider.user = { ...options.as };
    if (options.sessionGone) {
      sessions.revokeWhere((session) => session.id === record.id);
      manager.release(record.id, { revokeAtIdp: true });
    }
    const authorize = await fetch(started.authorizationUrl, { redirect: "manual" });
    if (options.failToken) provider.failNextToken(options.failToken);
    const back = await fetch(authorize.headers.get("location")!, { redirect: "manual", headers: { cookie: options.binding ?? `omb_session_test_oidc=${started.binding}` } });
    return { back, location: back.headers.get("location") ?? "", principalId: record.principalId! };
  }

  it("keeps a routine delegation and lands on #routine-delegation=ok (slice 6)", async () => {
    const { back, location, principalId } = await delegate();
    expect(back.status).toBe(303);
    expect(location).toBe("/#routine-delegation=ok");
    expect(back.headers.getSetCookie().some((c) => c.startsWith("omb_session_test_oidc=;") && c.includes("Max-Age=0"))).toBe(true);
    expect(back.headers.getSetCookie().some((c) => c.startsWith("omb_session_test="))).toBe(false);
    expect(consents.status(principalId).state).toBe("active");
    expect(provider.delegationOf(USER.sub)).not.toBeNull();
    // there is no revoke from Sagax any more (2026-10-08): forget it here
    expect(consents.endForSubject(provider.issuer, USER.sub)).toBe(1);
  });

  it("refuses another subject, a gone session, a missing marker and a wrong binding, and revokes (slice 6)", async () => {
    const other = { ...USER, sub: "01J9OTHER00000000000000000", email: "eve@example.test" };
    let revokedBefore = provider.revoked.length;
    const wrong = await delegate({ as: other });
    expect(wrong.location).toBe("/#routine-delegation-error=routines_subject");
    await new Promise((r) => setTimeout(r, 100));
    expect(provider.revoked.length).toBeGreaterThan(revokedBefore);
    // the family the other account got is dead at the provider
    expect(provider.delegationOf(other.sub)).toBeNull();
    expect(consents.status(wrong.principalId).state).toBe("none");
    provider.user = { ...USER };
    revokedBefore = provider.revoked.length;
    const gone = await delegate({ sessionGone: true });
    expect(gone.location).toBe("/#routine-delegation-error=routines_session");
    await new Promise((r) => setTimeout(r, 100));
    expect(provider.revoked.length).toBeGreaterThan(revokedBefore);
    expect(provider.delegationOf(USER.sub)).toBeNull();
    provider.tamper = { omitRoutinesMarker: true };
    try {
      expect((await delegate()).location).toBe("/#routine-delegation-error=routines_scope");
    } finally {
      provider.tamper = {};
    }
    expect((await delegate({ binding: "omb_session_test_oidc=wrong" })).location).toBe("/#routine-delegation-error=binding");
    expect(consents.principalsWithConsent()).toEqual([]);
  });

  it("names its person in login_hint, so another account signing in keeps its own delegation (slice 6, S6-12)", async () => {
    const bob = { ...USER, sub: "01J9BOB0000000000000000000", email: "bob@example.test" };
    provider.user = { ...bob };
    const own = await delegate();
    expect(own.location).toBe("/#routine-delegation=ok");
    expect(provider.lastAuthorize?.login_hint).toBe(bob.sub);
    const bobsDelegation = provider.delegationOf(bob.sub);
    expect(bobsDelegation).not.toBeNull();
    try {
      // Alice starts, Bob signs in at Perspicax
      provider.user = { ...USER };
      const revokedBefore = provider.revoked.length;
      const wrong = await delegate({ as: bob });
      expect(provider.lastAuthorize?.login_hint).toBe(USER.sub);
      // the subject is checked before the scope (the marker was dropped)
      expect(wrong.location).toBe("/#routine-delegation-error=routines_subject");
      await new Promise((r) => setTimeout(r, 100));
      expect(provider.revoked.length).toBeGreaterThan(revokedBefore);
      expect(provider.delegationOf(bob.sub)).toEqual(bobsDelegation);
      expect(consents.status(own.principalId).state).toBe("active");
      expect(consents.status(wrong.principalId).state).toBe("none");
    } finally {
      provider.user = { ...USER };
      consents.endForSubject(provider.issuer, bob.sub);
    }
  });

  describe("the sign-in again of an account deletion (2026-10-18)", () => {
    /** A web sign-in, then its session asks to sign in again (`as` signs in at Perspicax instead). */
    async function again(options: { as?: typeof USER; client?: "web" | "phone"; sessionGone?: boolean; noMarker?: boolean; noRefresh?: boolean; claims?: (c: Record<string, unknown>) => Record<string, unknown> } = {}) {
      const { callback } = await walk();
      const cookie = callback!.headers.getSetCookie().find((c) => c.startsWith("omb_session_test="))!;
      const record = sessions.authenticate(decodeURIComponent(cookie.split(";")[0]!.split("=")[1]!))!;
      const expect = { principalId: record.principalId!, subject: { iss: provider.issuer, sub: record.idp!.sub }, sessionId: record.id };
      const { ticket } = reauth.openTicket(expect, options.client ?? "web");
      if (options.as) provider.user = { ...options.as };
      if (options.sessionGone) {
        sessions.revokeWhere((session) => session.id === record.id);
        manager.release(record.id, { revokeAtIdp: true });
      }
      const start = await fetch(`${base}/auth/oidc/reauth?ticket=${ticket}`, { redirect: "manual" });
      const to = start.headers.get("location") ?? "";
      if (!to.startsWith(provider.issuer)) return { start, location: to, record, ticket, authorize: null as Record<string, string> | null };
      const binding = start.headers.getSetCookie().find((c) => c.includes("_oidc="))!.split(";")[0]!;
      if (options.claims) provider.tamper = { claims: options.claims };
      if (options.noMarker) provider.tamper = { ...provider.tamper, omitEraseMarker: true };
      if (options.noRefresh) provider.tamper = { ...provider.tamper, noRefreshToken: true };
      try {
        const authorize = await fetch(to, { redirect: "manual" });
        const back = await fetch(authorize.headers.get("location")!, { redirect: "manual", headers: { cookie: binding } });
        return { start, location: back.headers.get("location") ?? "", record, ticket, authorize: provider.lastAuthorize };
      } finally {
        provider.tamper = {};
        provider.user = { ...USER };
      }
    }

    /** The provider saw a revocation since `before` (the queue is async). */
    async function revokedSince(before: number) {
      for (let i = 0; i < 50 && provider.revoked.length <= before; i++) await new Promise((r) => setTimeout(r, 20));
      expect(provider.revoked.length).toBeGreaterThan(before);
    }

    it("asks Perspicax for a new sign-in (prompt=login, max_age=0, the person's login_hint) and keeps its access token for that session", async () => {
      const { location, record, authorize } = await again();
      expect(location).toBe("/#account-reauth=ok");
      expect(authorize).toMatchObject({ prompt: "login", max_age: "0", login_hint: USER.sub, scope: "openid pulsabot:erase" });
      const fresh = reauth.take(record.id, record.principalId!);
      expect(fresh?.sub).toBe(USER.sub);
      expect(fresh?.accessToken).toBeTruthy();
      // the session's own sign-in (and its refreshes) never sits here
      expect(reauth.take(record.id, record.principalId!)).toBeNull();
    });

    it("ends a phone's on sagax://account-reauth, and takes a ticket once", async () => {
      const { location, ticket } = await again({ client: "phone" });
      expect(location).toBe(`sagax://account-reauth?address=${encodeURIComponent(base)}&status=ok`);
      const replay = await fetch(`${base}/auth/oidc/reauth?ticket=${ticket}&client=phone`, { redirect: "manual" });
      expect(replay.headers.get("location")).toBe(`sagax://account-reauth?address=${encodeURIComponent(base)}&error=reauth_ticket`);
      const unknown = await fetch(`${base}/auth/oidc/reauth?ticket=nope`, { redirect: "manual" });
      expect(unknown.headers.get("location")).toBe("/#account-reauth-error=reauth_ticket");
    });

    it("refuses another account, a gone session and a sign-in that is not recent, keeps nothing and revokes", async () => {
      const other = { ...USER, sub: "01J9OTHER00000000000000000", email: "eve@example.test" };
      let revokedBefore = provider.revoked.length;
      const wrong = await again({ as: other });
      expect(wrong.location).toBe("/#account-reauth-error=reauth_subject");
      expect(reauth.has(wrong.record.id)).toBe(false);
      await revokedSince(revokedBefore);

      revokedBefore = provider.revoked.length;
      const gone = await again({ sessionGone: true });
      expect(gone.location).toBe("/#account-reauth-error=reauth_session");
      await revokedSince(revokedBefore);

      // Perspicax answered with an old sign-in (it ignored max_age): refused.
      revokedBefore = provider.revoked.length;
      const stale = await again({ claims: (c) => ({ ...c, auth_time: Math.floor(Date.now() / 1000) - 600 }) });
      expect(stale.location).toBe("/#account-reauth-error=reauth_stale");
      expect(reauth.has(stale.record.id)).toBe(false);
      await revokedSince(revokedBefore);

      const none = await again({ claims: (c) => { const { auth_time: _drop, ...rest } = c; return rest; } });
      expect(none.location).toBe("/#account-reauth-error=reauth_stale");

      // Perspicax did not keep the erasure marker (an older one): refused.
      revokedBefore = provider.revoked.length;
      const unmarked = await again({ noMarker: true });
      expect(unmarked.location).toBe("/#account-reauth-error=reauth_scope");
      expect(reauth.has(unmarked.record.id)).toBe(false);
      await revokedSince(revokedBefore);

      // Without a refresh token, the refused sign-in's access token itself goes.
      revokedBefore = provider.revoked.length;
      const bare = await again({ sessionGone: true, noRefresh: true });
      expect(bare.location).toBe("/#account-reauth-error=reauth_session");
      // (the gone session's own grant is revoked too: look for the access token)
      for (let i = 0; i < 50 && !provider.revoked.slice(revokedBefore).some((r) => r.token_type_hint === "access_token"); i++) await new Promise((r) => setTimeout(r, 20));
      expect(provider.revoked.slice(revokedBefore).some((r) => r.token_type_hint === "access_token")).toBe(true);
    }, 30_000);

    it("answers 405 to another method", async () => {
      expect((await fetch(`${base}/auth/oidc/reauth`, { method: "POST" })).status).toBe(405);
    });
  });

  it("binds a web sign-in's grant to its session at once", async () => {
    const { location, callback } = await walk();
    expect(location).toBe("/");
    const cookie = callback!.headers.getSetCookie().find((c) => c.startsWith("omb_session_test="))!;
    const token = decodeURIComponent(cookie.split(";")[0]!.split("=")[1]!);
    const record = sessions.authenticate(token)!;
    expect(record.idp?.grantRef).toBeTruthy();
    expect(manager.mustRefuse(record)).toBeNull();
    expect(manager.sweep()).toBe(0);
    // a web sign-in is an interactive sign-in (server/recent-sign-in.ts)
    expect(typeof record.authAt).toBe("number");
    expect(recentInteractiveSignIn(record)).toBe(true);
  });

  describe("a recent sign-in comes from the provider's auth_time (2026-10-19)", () => {
    const sessionOf = (callback: Response | null) => {
      const cookie = callback!.headers.getSetCookie().find((c) => c.startsWith("omb_session_test="))!;
      return sessions.authenticate(decodeURIComponent(cookie.split(";")[0]!.split("=")[1]!))!;
    };
    async function signInWith(authTime: number | null, options: { fresh?: boolean } = {}) {
      provider.tamper = { claims: (c) => {
        if (authTime !== null) return { ...c, auth_time: authTime };
        const { auth_time: _drop, ...rest } = c;
        return rest;
      } };
      try {
        const walked = await walk(undefined, options);
        return { ...walked, record: sessionOf(walked.callback) };
      } finally {
        provider.tamper = {};
      }
    }
    const seconds = () => Math.floor(Date.now() / 1000);

    it("stamps authAt with the provider's auth_time, not the moment of the callback", async () => {
      const at = seconds() - 120;
      const { location, record } = await signInWith(at);
      expect(location).toBe("/");
      expect(record.authAt).toBe(at * 1000);
      expect(recentInteractiveSignIn(record)).toBe(true);
    });

    it("a silent or old sign-in at Perspicax, no auth_time, or one from the future: a valid session that is not recent", async () => {
      for (const authTime of [seconds() - 16 * 60, null, seconds() + 3_600, 0]) {
        const { location, record } = await signInWith(authTime);
        expect(location, String(authTime)).toBe("/");
        expect(record.authAt, String(authTime)).toBeUndefined();
        expect(recentInteractiveSignIn(record), String(authTime)).toBe(false);
      }
    });

    it("a little clock skew is dated now, never later", async () => {
      const before = Date.now();
      const { record } = await signInWith(seconds() + 30);
      expect(record.authAt).toBeGreaterThanOrEqual(before);
      expect(record.authAt).toBeLessThanOrEqual(Date.now());
      expect(recentInteractiveSignIn(record)).toBe(true);
    });

    it("Sign in again (fresh=1) asks Perspicax for prompt=login and max_age=0, web and desktop; a plain sign-in does not", async () => {
      await walk();
      expect(provider.lastAuthorize?.prompt).toBeUndefined();
      expect(provider.lastAuthorize?.max_age).toBeUndefined();
      const { location, record } = await signInWith(seconds(), { fresh: true });
      expect(location).toBe("/");
      expect(provider.lastAuthorize).toMatchObject({ prompt: "login", max_age: "0", scope: "openid profile email offline_access" });
      expect(recentInteractiveSignIn(record)).toBe(true);
      expect((await walk("desktop", { fresh: true })).location).toMatch(/^openmausbot:\/\/auth/);
      expect(provider.lastAuthorize).toMatchObject({ prompt: "login", max_age: "0" });
      // anything else than 1 is a plain sign-in
      const start = await fetch(`${base}/auth/oidc/start?fresh=yes`, { redirect: "manual" });
      expect(new URL(start.headers.get("location")!).searchParams.get("prompt")).toBeNull();
    });

    it("a desktop sign-in hands the provider's auth_time through its pairing window, and an old one hands none", async () => {
      const at = seconds() - 60;
      provider.tamper = { claims: (c) => ({ ...c, auth_time: at }) };
      let walked;
      try {
        walked = await walk("desktop");
      } finally {
        provider.tamper = {};
      }
      const codeOf = (location: string) => /#code=(omb_pair_[A-Za-z0-9_-]{43})$/.exec(location)![1]!;
      const paired = sessions.exchange({ code: codeOf(walked.location), label: "desktop", source: "10.0.9.1" });
      expect(paired.ok && sessions.byId(paired.session.id)!.authAt).toBe(at * 1000);
      provider.tamper = { claims: (c) => ({ ...c, auth_time: seconds() - 3_600 }) };
      try {
        walked = await walk("desktop");
      } finally {
        provider.tamper = {};
      }
      const old = sessions.exchange({ code: codeOf(walked.location), label: "desktop", source: "10.0.9.2" });
      expect(old.ok && sessions.byId(old.session.id)!.authAt).toBeUndefined();
    });
  });

  it("passes a rate-limited code exchange back as rate_limited, for a sign-in and a delegation (fix 2)", async () => {
    const start = await fetch(`${base}/auth/oidc/start`, { redirect: "manual" });
    const bindingCookie = start.headers.getSetCookie().find((c) => c.includes("_oidc="))!.split(";")[0]!;
    const authorize = await fetch(start.headers.get("location")!, { redirect: "manual" });
    provider.failNextToken(429);
    const callback = await fetch(authorize.headers.get("location")!, { redirect: "manual", headers: { cookie: bindingCookie } });
    expect(callback.headers.get("location")).toBe("/pair#signin_error=rate_limited");
    const delegated = await delegate({ failToken: 429 });
    expect(delegated.location).toBe("/#routine-delegation-error=rate_limited");
    expect(consents.status(delegated.principalId).state).toBe("none");
  });

  describe("POST /api/auth/oidc/backchannel-logout", () => {
    const post = (body: string, type = "application/x-www-form-urlencoded") =>
      fetch(`${base}/api/auth/oidc/backchannel-logout`, { method: "POST", headers: { "content-type": type }, body });

    it("answers 405 to other methods, 400 to another content type or an oversized body", async () => {
      const get = await fetch(`${base}/api/auth/oidc/backchannel-logout`);
      expect(get.status).toBe(405);
      const token = provider.logoutToken({ sub: USER.sub });
      const json = await post(JSON.stringify({ logout_token: token }), "application/json");
      expect(json.status).toBe(400);
      expect(await json.json()).toEqual({ error: "invalid_request" });
      const big = await post(`logout_token=${token}&pad=${"x".repeat(BACKCHANNEL_MAX_BODY_BYTES)}`);
      expect(big.status).toBe(400);
      expect((await post("")).status).toBe(400);
    });

    it.each([
      ["another key", { strayKey: true }],
      ["alg none", { header: (h: Record<string, unknown>) => ({ ...h, alg: "none" }) }],
      ["another audience", { claims: (c: Record<string, unknown>) => ({ ...c, aud: "other" }) }],
      ["another issuer", { claims: (c: Record<string, unknown>) => ({ ...c, iss: "https://evil.example" }) }],
      ["an expired token", { claims: (c: Record<string, unknown>) => ({ ...c, exp: Math.floor(Date.now() / 1000) - 120 }) }],
      ["no events", { claims: (c: Record<string, unknown>) => { const { events: _e, ...rest } = c; return rest; } }],
      ["a nonce", { claims: (c: Record<string, unknown>) => ({ ...c, nonce: "n" }) }],
      ["no subject", { claims: (c: Record<string, unknown>) => { const { sub: _s, ...rest } = c; return rest; } }],
    ])("refuses %s with 400 and leaves the sessions alone", async (_what, tamper) => {
      const { callback } = await walk();
      const cookie = callback!.headers.getSetCookie().find((c) => c.startsWith("omb_session_test="))!;
      const token = decodeURIComponent(cookie.split(";")[0]!.split("=")[1]!);
      const res = await post(`logout_token=${provider.logoutToken({ sub: USER.sub, ...tamper })}`);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_request" });
      expect(sessions.authenticate(token)).not.toBeNull();
    });

    it("honours a valid token once: 200 {} no-store, the person's sessions end; a replay is 400", async () => {
      const { callback } = await walk();
      const cookie = callback!.headers.getSetCookie().find((c) => c.startsWith("omb_session_test="))!;
      const token = decodeURIComponent(cookie.split(";")[0]!.split("=")[1]!);
      const logout = provider.logoutToken({ sub: USER.sub });
      const res = await post(`logout_token=${encodeURIComponent(logout)}`, "application/x-www-form-urlencoded; charset=utf-8");
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(await res.json()).toEqual({});
      expect(sessions.authenticate(token)).toBeNull();
      expect(principals.bySubject(provider.issuer, USER.sub)?.disabledAt).toBeTypeOf("number");
      const replay = await post(`logout_token=${encodeURIComponent(logout)}`);
      expect(replay.status).toBe(400);
      // an unknown subject verifies and does nothing
      expect((await post(`logout_token=${provider.logoutToken({ sub: "nobody-here" })}`)).status).toBe(200);
    });

    describe("with the account purged event", () => {
      const LOGOUT = "http://schemas.openid.net/event/backchannel-logout";
      const purgedToken = (sub: string) => provider.logoutToken({
        sub,
        claims: (c) => ({ ...c, events: { [LOGOUT]: {}, [ACCOUNT_PURGED_EVENT]: { subject: { format: "iss_sub", iss: provider.issuer, sub } } } }),
      });
      afterEach(() => { delete grantKeeper.purgePerson; });

      it("logs the person out, erases their data and answers { purged: true, bots, threads }", async () => {
        const purges: Array<{ iss: string; sub: string; sessionsLeft: number }> = [];
        grantKeeper.purgePerson = async (input) => {
          const principal = principals.bySubject(input.iss, input.sub);
          purges.push({ ...input, sessionsLeft: sessions.list().filter((session) => session.principalId === principal?.id).length });
          return { bots: 1, threads: 4 };
        };
        const { callback } = await walk();
        const cookie = callback!.headers.getSetCookie().find((c) => c.startsWith("omb_session_test="))!;
        const token = decodeURIComponent(cookie.split(";")[0]!.split("=")[1]!);
        const res = await post(`logout_token=${encodeURIComponent(purgedToken(USER.sub))}`);
        expect(res.status).toBe(200);
        expect(res.headers.get("cache-control")).toBe("no-store");
        expect(await res.json()).toEqual({ purged: true, bots: 1, threads: 4 });
        // the logout ran first, as without the event
        expect(sessions.authenticate(token)).toBeNull();
        expect(purges).toEqual([{ iss: provider.issuer, sub: USER.sub, sessionsLeft: 0 }]);
        // a subject this server never knew is purged too (the keeper says zeros)
        grantKeeper.purgePerson = async () => ({ bots: 0, threads: 0 });
        const unknown = await post(`logout_token=${encodeURIComponent(purgedToken("nobody-here"))}`);
        expect(await unknown.json()).toEqual({ purged: true, bots: 0, threads: 0 });
      });

      it("answers 500 purge_failed when the erasure throws, and a fresh token is honoured again", async () => {
        grantKeeper.purgePerson = async () => { throw new Error("disk full"); };
        const res = await post(`logout_token=${encodeURIComponent(purgedToken(USER.sub))}`);
        expect(res.status).toBe(500);
        expect(await res.json()).toEqual({ error: "purge_failed" });
        grantKeeper.purgePerson = async () => ({ bots: 0, threads: 2 });
        const retry = await post(`logout_token=${encodeURIComponent(purgedToken(USER.sub))}`);
        expect(retry.status).toBe(200);
        expect(await retry.json()).toEqual({ purged: true, bots: 0, threads: 2 });
      });

      it("never says purged without a keeper that erases, nor for a plain logout token", async () => {
        const plain = await post(`logout_token=${encodeURIComponent(purgedToken(USER.sub))}`);
        expect(plain.status).toBe(200);
        expect(await plain.json()).toEqual({});
        let called = 0;
        grantKeeper.purgePerson = async () => { called++; return { bots: 0, threads: 0 }; };
        const logoutOnly = await post(`logout_token=${encodeURIComponent(provider.logoutToken({ sub: USER.sub }))}`);
        expect(await logoutOnly.json()).toEqual({});
        expect(called).toBe(0);
      });

      it("refuses a purge naming another subject with 400 and erases nothing", async () => {
        let called = 0;
        grantKeeper.purgePerson = async () => { called++; return { bots: 0, threads: 0 }; };
        const token = provider.logoutToken({
          sub: USER.sub,
          claims: (c) => ({ ...c, events: { [LOGOUT]: {}, [ACCOUNT_PURGED_EVENT]: { subject: { format: "iss_sub", iss: provider.issuer, sub: "someone-else" } } } }),
        });
        const res = await post(`logout_token=${encodeURIComponent(token)}`);
        expect(res.status).toBe(400);
        expect(called).toBe(0);
      });
    });
  });
});
