// The OpenID Connect relying party against a local fake provider: a real
// ES256 key from node:crypto, real discovery, JWKS and token endpoints over
// HTTP. Every refusal the spec lists (T10) is proven by bending one thing.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { BOT_MAIL_ASSERTION_ACTORS } from "./bot-inbound-mail.ts";
import { ORG_MEMBER_ASSERTION_ACTORS } from "./org-member-routes.ts";
import { ACCOUNT_PURGED_EVENT, CONSOLE_ASSERTION_ACTORS, accessExpiresIn, avatarVersionFromPicture, OIDC_MAX_PENDING_FLOWS, ROUTINE_DELEGATION_SCOPES, OIDC_PENDING_FLOW_TTL_MS, OidcRelyingParty, parseRetryAfter, parseTeamsClaim, validIssuer } from "./oidc-rp.ts";
import { startFakeOidcProvider, type FakeOidcProvider } from "./testing/fake-oidc-provider.ts";

const REDIRECT = "http://127.0.0.1:9/auth/oidc/callback";
let idp: FakeOidcProvider;

beforeAll(async () => {
  idp = await startFakeOidcProvider();
});
afterAll(async () => {
  await idp.close();
});
afterEach(() => {
  idp.tamper = {};
  idp.user = { sub: "01J0000000000000000000ADMN", email: "ada@example.test", name: "Ada Admin", preferred_username: "ada", role: "admin" };
});

function rp(now?: () => number) {
  return new OidcRelyingParty({ issuer: idp.issuer, clientId: "pulsa-bot", redirectUri: REDIRECT, resource: "http://127.0.0.1:9", ...(now ? { now } : {}) });
}

/** Start, follow the authorize redirect the way a browser would, and return
 * the callback query plus the binding cookie. */
async function authorize(party: OidcRelyingParty) {
  const started = await party.start();
  const res = await fetch(started.authorizationUrl, { redirect: "manual" });
  const location = res.headers.get("location");
  if (!location) throw new Error(`authorize answered ${res.status}`);
  const back = new URL(location);
  return { started, params: back.searchParams, back };
}

describe("OIDC relying party", () => {
  it("signs a person in: PKCE S256, state, nonce and resource go out; an ES256 id_token comes back verified", async () => {
    const party = rp();
    const { started, params, back } = await authorize(party);
    expect(`${back.origin}${back.pathname}`).toBe(REDIRECT);
    const sent = idp.lastAuthorize!;
    expect(sent).toMatchObject({ client_id: "pulsa-bot", redirect_uri: REDIRECT, response_type: "code", code_challenge_method: "S256", resource: "http://127.0.0.1:9" });
    expect(sent.scope.split(" ")).toContain("openid");
    expect(sent.state).toBe(started.state);
    expect(sent.nonce).toMatch(/^[\w-]{43}$/);
    const outcome = await party.callback(params, started.binding);
    expect(outcome).toEqual({
      ok: true,
      client: "web",
      purpose: "signin",
      grantedScope: "openid profile email offline_access",
      // slice 5: the access token rides along, for memory only (idp-session.ts)
      grant: { refreshToken: expect.stringMatching(/^pxlr1\./), accessToken: expect.stringMatching(/^pxlo1\./), accessExpiresAt: expect.any(Number) },
      identity: expect.objectContaining({ iss: idp.issuer, sub: "01J0000000000000000000ADMN", email: "ada@example.test", name: "Ada Admin", preferredUsername: "ada", role: "admin" }),
    });
    expect(sent.scope.split(" ")).toEqual(["openid", "profile", "email", "offline_access"]);
    // the verifier went to the token endpoint, never the browser
    expect(idp.lastTokenRequest?.code_verifier).toMatch(/^[\w-]{43}$/);
    expect(started.authorizationUrl).not.toContain(idp.lastTokenRequest!.code_verifier);
    expect(idp.lastTokenRequest).toMatchObject({ grant_type: "authorization_code", client_id: "pulsa-bot", redirect_uri: REDIRECT, resource: "http://127.0.0.1:9" });
    expect(party.pendingCount()).toBe(0);
    // slice 2 keeps the grant: nothing is revoked after a good sign-in
    const revokedBefore = idp.revoked.length;
    await new Promise((r) => setTimeout(r, 100));
    expect(idp.revoked.length).toBe(revokedBefore);
  });

  it("refuses a state it did not issue, and a state used twice", async () => {
    const party = rp();
    const { started, params } = await authorize(party);
    const forged = new URLSearchParams(params);
    forged.set("state", "not-a-state");
    expect(await party.callback(forged, started.binding)).toMatchObject({ ok: false, code: "state" });
    expect((await party.callback(params, started.binding)).ok).toBe(true);
    expect(await party.callback(params, started.binding)).toMatchObject({ ok: false, code: "state" });
  });

  it("refuses a callback from another browser (no or wrong binding) and burns the flow", async () => {
    const party = rp();
    const { params } = await authorize(party);
    expect(await party.callback(params, "someone-elses-cookie")).toMatchObject({ ok: false, code: "binding" });
    const again = await authorize(party);
    expect(await party.callback(again.params, undefined)).toMatchObject({ ok: false, code: "binding" });
  });

  it("proves PKCE: a code redeemed with the wrong verifier is refused by the provider", async () => {
    const party = rp();
    const { started, params } = await authorize(party);
    // Swap the pending flow's verifier for another: the provider's S256 check fails.
    const pending = (party as unknown as { pending: Map<string, { verifier: string }> }).pending;
    pending.get(started.state)!.verifier = "x".repeat(43);
    expect(await party.callback(params, started.binding)).toMatchObject({ ok: false, code: "token" });
    expect(idp.lastTokenRequest?.code_verifier).toBe("x".repeat(43));
  });

  it("refuses a bad signature, a key the JWKS does not publish, and alg none", async () => {
    const party = rp();
    idp.tamper = { strayKey: true };
    let flow = await authorize(party);
    expect(await party.callback(flow.params, flow.started.binding)).toMatchObject({ ok: false, code: "id_token_signature" });

    // A token signed by the real key whose payload is changed afterwards.
    idp.tamper = { afterSigning: (c) => ({ ...c, role: "admin", sub: "01J00000000000000000MALLORY" }) };
    flow = await authorize(party);
    expect(await party.callback(flow.params, flow.started.binding)).toMatchObject({ ok: false, code: "id_token_signature" });

    idp.tamper = { header: (h) => ({ ...h, kid: "unknown-kid" }) };
    flow = await authorize(party);
    expect(await party.callback(flow.params, flow.started.binding)).toMatchObject({ ok: false, code: "id_token_kid" });

    idp.tamper = { header: (h) => ({ ...h, alg: "none" }) };
    flow = await authorize(party);
    expect(await party.callback(flow.params, flow.started.binding)).toMatchObject({ ok: false, code: "id_token_alg" });

    idp.tamper = { header: (h) => ({ ...h, alg: "HS256" }) };
    flow = await authorize(party);
    expect(await party.callback(flow.params, flow.started.binding)).toMatchObject({ ok: false, code: "id_token_alg" });
  });

  it("refuses a wrong audience, a wrong issuer, an extra audience without azp", async () => {
    const party = rp();
    idp.tamper = { claims: (c) => ({ ...c, aud: "another-client" }) };
    let flow = await authorize(party);
    expect(await party.callback(flow.params, flow.started.binding)).toMatchObject({ ok: false, code: "id_token_aud" });

    idp.tamper = { claims: (c) => { const { azp: _azp, ...rest } = c; return { ...rest, aud: ["pulsa-bot", "other"] }; } };
    flow = await authorize(party);
    expect(await party.callback(flow.params, flow.started.binding)).toMatchObject({ ok: false, code: "id_token_aud" });

    idp.tamper = { claims: (c) => ({ ...c, azp: "other" }) };
    flow = await authorize(party);
    expect(await party.callback(flow.params, flow.started.binding)).toMatchObject({ ok: false, code: "id_token_aud" });

    idp.tamper = { claims: (c) => ({ ...c, iss: "https://evil.example" }) };
    flow = await authorize(party);
    expect(await party.callback(flow.params, flow.started.binding)).toMatchObject({ ok: false, code: "id_token_iss" });
  });

  it("refuses an authorization response from another issuer (RFC 9207), or without iss when the provider promises it", async () => {
    const party = rp();
    idp.tamper = { issParam: "https://evil.example" };
    let flow = await authorize(party);
    expect(await party.callback(flow.params, flow.started.binding)).toMatchObject({ ok: false, code: "iss" });
    idp.tamper = { dropIssParam: true };
    flow = await authorize(party);
    expect(await party.callback(flow.params, flow.started.binding)).toMatchObject({ ok: false, code: "iss" });
  });

  it("refuses an expired id_token and one issued in the future, within 60 s of tolerance", async () => {
    const party = rp();
    const now = Math.floor(Date.now() / 1000);
    idp.tamper = { claims: (c) => ({ ...c, exp: now - 120 }) };
    let flow = await authorize(party);
    expect(await party.callback(flow.params, flow.started.binding)).toMatchObject({ ok: false, code: "id_token_exp" });

    idp.tamper = { claims: (c) => ({ ...c, exp: now - 30 }) }; // inside the tolerance
    flow = await authorize(party);
    expect((await party.callback(flow.params, flow.started.binding)).ok).toBe(true);

    idp.tamper = { claims: (c) => ({ ...c, iat: now + 600 }) };
    flow = await authorize(party);
    expect(await party.callback(flow.params, flow.started.binding)).toMatchObject({ ok: false, code: "id_token_iat" });
  });

  it("refuses a nonce that is not this sign-in's", async () => {
    const party = rp();
    idp.tamper = { claims: (c) => ({ ...c, nonce: "replayed-nonce" }) };
    let flow = await authorize(party);
    expect(await party.callback(flow.params, flow.started.binding)).toMatchObject({ ok: false, code: "id_token_nonce" });
    idp.tamper = { claims: (c) => { const { nonce: _nonce, ...rest } = c; return rest; } };
    flow = await authorize(party);
    expect(await party.callback(flow.params, flow.started.binding)).toMatchObject({ ok: false, code: "id_token_nonce" });
  });

  it("refuses a token response without an id_token, and an authorize error", async () => {
    const party = rp();
    idp.tamper = { noIdToken: true };
    let flow = await authorize(party);
    expect(await party.callback(flow.params, flow.started.binding)).toMatchObject({ ok: false, code: "id_token_missing" });
    idp.tamper = { authorizeError: "access_denied" };
    flow = await authorize(party);
    expect(await party.callback(flow.params, flow.started.binding)).toMatchObject({ ok: false, code: "provider" });
  });

  it("caches the JWKS and refetches once on an unknown kid (key rotation)", async () => {
    const party = rp();
    const before = idp.jwksFetches;
    let flow = await authorize(party);
    expect((await party.callback(flow.params, flow.started.binding)).ok).toBe(true);
    flow = await authorize(party);
    expect((await party.callback(flow.params, flow.started.binding)).ok).toBe(true);
    expect(idp.jwksFetches - before).toBe(1);
    idp.rotateKey();
    flow = await authorize(party);
    expect((await party.callback(flow.params, flow.started.binding)).ok).toBe(true);
    expect(idp.jwksFetches - before).toBe(2);
  });

  it("forgets flows after ten minutes and keeps at most twenty", async () => {
    let clock = Date.now();
    const party = rp(() => clock);
    const { started, params } = await authorize(party);
    clock += OIDC_PENDING_FLOW_TTL_MS;
    expect(await party.callback(params, started.binding)).toMatchObject({ ok: false, code: "state" });
    for (let i = 0; i < OIDC_MAX_PENDING_FLOWS + 5; i++) await party.start();
    expect(party.pendingCount()).toBe(OIDC_MAX_PENDING_FLOWS);
  });

  it("refuses discovery that names another issuer, and insecure configuration", async () => {
    const party = new OidcRelyingParty({ issuer: `${idp.issuer}/`, clientId: "pulsa-bot", redirectUri: REDIRECT });
    // a lone trailing slash is the same issuer
    expect(party.issuer).toBe(idp.issuer);
    expect(validIssuer("http://px.example.com")).toBeNull();
    expect(validIssuer("https://px.example.com/")).toBe("https://px.example.com");
    expect(() => new OidcRelyingParty({ issuer: "http://px.example.com", clientId: "pulsa-bot", redirectUri: REDIRECT })).toThrow(/https/);
    const other = await startFakeOidcProvider();
    try {
      const lying = new OidcRelyingParty({ issuer: other.issuer, clientId: "pulsa-bot", redirectUri: REDIRECT, fetch: (input, init) => {
        const url = String(input).replace(other.issuer, idp.issuer);
        return fetch(url, init);
      } });
      await expect(lying.start()).rejects.toThrow(/another issuer/);
    } finally {
      await other.close();
    }
  });
});

/** A full sign-in, returning the refresh token the provider issued. */
async function signedInGrant(party: OidcRelyingParty): Promise<string> {
  const { started, params } = await authorize(party);
  const outcome = await party.callback(params, started.binding);
  if (!outcome.ok || !outcome.grant.refreshToken) throw new Error(`sign-in failed: ${JSON.stringify(outcome)}`);
  return outcome.grant.refreshToken;
}

describe("OIDC relying party: refresh (slice 2)", () => {
  it("keeps the client kind of the flow it started", async () => {
    const party = rp();
    const started = await party.start({ client: "desktop" });
    const res = await fetch(started.authorizationUrl, { redirect: "manual" });
    const outcome = await party.callback(new URL(res.headers.get("location")!).searchParams, started.binding);
    expect(outcome).toMatchObject({ ok: true, client: "desktop" });
    const other = await party.start({ client: "phone" });
    const back = await fetch(other.authorizationUrl, { redirect: "manual" });
    expect(await party.callback(new URL(back.headers.get("location")!).searchParams, "wrong")).toMatchObject({ ok: false, code: "binding", client: "phone" });
  });

  it("rotates the refresh token, sends the resource, and verifies the refreshed id_token without a nonce", async () => {
    const party = rp();
    const first = await signedInGrant(party);
    const refreshed = await party.refresh(first, { sub: idp.user.sub });
    expect(refreshed).toMatchObject({ ok: true, refreshToken: expect.stringMatching(/^pxlr1\./), identity: expect.objectContaining({ sub: idp.user.sub, role: "admin" }) });
    // slice 5: the new access token and its life (expires_in, default 3600, cap 86400)
    expect(refreshed).toMatchObject({ accessToken: expect.stringMatching(/^pxlo1\./), expiresIn: 3600 });
    expect(idp.lastTokenRequest).toMatchObject({ grant_type: "refresh_token", client_id: "pulsa-bot", resource: "http://127.0.0.1:9" });
    if (!refreshed.ok) throw new Error("unreachable");
    expect(refreshed.refreshToken).not.toBe(first);
    // the old token is dead after rotation
    expect(await party.refresh(first, { sub: idp.user.sub })).toMatchObject({ ok: false, kind: "rejected" });
    // and the new one works, carrying the current role
    idp.setRole(idp.user.sub, "employee");
    const again = await party.refresh(refreshed.refreshToken, { sub: idp.user.sub });
    expect(again).toMatchObject({ ok: true, identity: expect.objectContaining({ role: "employee" }) });
    idp.setRole(idp.user.sub, "admin");
  });

  it("accepts a refresh without an id_token", async () => {
    const party = rp();
    const token = await signedInGrant(party);
    idp.tamper = { noIdToken: true };
    const refreshed = await party.refresh(token, { sub: idp.user.sub });
    expect(refreshed.ok).toBe(true);
    expect(refreshed.ok && refreshed.identity).toBeUndefined();
  });

  it("rejects a refreshed id_token for another subject and a disabled person; keeps the rotation but not the claims of an id_token that does not verify", async () => {
    const party = rp();
    let token = await signedInGrant(party);
    expect(await party.refresh(token, { sub: "someone-else" })).toMatchObject({ ok: false, kind: "rejected" });
    token = await signedInGrant(party);
    idp.tamper = { claims: (c) => ({ ...c, nonce: "n" }) };
    // 2026-10-20: a signing key rotated mid-deploy, a stray claim: the
    // session keeps its rotated token, the claims are not applied
    const unverified = await party.refresh(token, { sub: idp.user.sub });
    expect(unverified).toMatchObject({ ok: true, note: expect.stringMatching(/nonce/) });
    expect(unverified.ok && unverified.identity).toBeFalsy();
    idp.tamper = {};
    token = await signedInGrant(party);
    idp.disable(idp.user.sub);
    try {
      expect(await party.refresh(token, { sub: idp.user.sub })).toMatchObject({ ok: false, kind: "rejected", error: expect.stringMatching(/invalid_grant/) });
    } finally {
      idp.enable(idp.user.sub);
    }
  });

  it("treats 5xx, 429 and an unreachable provider as transient", async () => {
    let skew = 0;
    const party = rp(() => Date.now() + skew);
    const token = await signedInGrant(party);
    idp.failNextToken(503);
    expect(await party.refresh(token, { sub: idp.user.sub })).toMatchObject({ ok: false, kind: "transient" });
    idp.failNextToken(429);
    expect(await party.refresh(token, { sub: idp.user.sub })).toMatchObject({ ok: false, kind: "transient", rateLimited: true });
    // fix 2: the 429 pauses refreshes for its Retry-After (60 s by default)
    skew = 61_000;
    // the token survived both
    expect((await party.refresh(token, { sub: idp.user.sub })).ok).toBe(true);
    const offline = new OidcRelyingParty({ issuer: idp.issuer, clientId: "pulsa-bot", redirectUri: REDIRECT, fetch: () => Promise.reject(new Error("ECONNREFUSED")) });
    expect(await offline.refresh("pxlr1.x", { sub: "s" })).toMatchObject({ ok: false, kind: "transient" });
    // a page that is not a token answer, and errors about this client rather
    // than the grant (a provider being redeployed): transient
    for (const answer of [{ status: 200, body: "<html>maintenance</html>" }, { status: 400, body: JSON.stringify({ error: "invalid_client" }) }, { status: 401, body: JSON.stringify({ error: "unauthorized_client" }) }]) {
      const party2 = new OidcRelyingParty({ issuer: idp.issuer, clientId: "pulsa-bot", redirectUri: REDIRECT, fetch: async (input, init) => {
        const url = String(input instanceof Request ? input.url : input);
        if (url.endsWith("/token")) return new Response(answer.body, { status: answer.status, headers: { "content-type": answer.body.startsWith("{") ? "application/json" : "text/html" } });
        return fetch(input, init);
      } });
      expect(await party2.refresh("pxlr1.x", { sub: "s" })).toMatchObject({ ok: false, kind: "transient" });
    }
  });

  it("revokes a token at the provider and never throws", async () => {
    const party = rp();
    const token = await signedInGrant(party);
    expect(await party.revokeToken(token)).toBe(true);
    expect(idp.revoked.at(-1)).toEqual({ token, token_type_hint: "refresh_token", client_id: "pulsa-bot" });
    expect(await party.refresh(token, { sub: idp.user.sub })).toMatchObject({ ok: false, kind: "rejected" });
    const offline = new OidcRelyingParty({ issuer: idp.issuer, clientId: "pulsa-bot", redirectUri: REDIRECT, fetch: () => Promise.reject(new Error("down")) });
    expect(await offline.revokeToken("x")).toBe(false);
  });
});

describe("OIDC relying party: back-channel logout tokens", () => {
  const sub = "01J0000000000000000000ADMN";

  it("verifies a good logout token (typ logout+jwt, JWT or absent)", async () => {
    const party = rp();
    const claims = await party.verifyLogoutToken(idp.logoutToken({ sub }));
    expect(claims).toMatchObject({ iss: idp.issuer, sub, jti: expect.stringMatching(/^[0-9a-f]{32}$/) });
    expect(claims.exp).toBeGreaterThan(Date.now() / 1000);
    await expect(party.verifyLogoutToken(idp.logoutToken({ sub, header: (h) => ({ ...h, typ: "JWT" }) }))).resolves.toMatchObject({ sub });
    await expect(party.verifyLogoutToken(idp.logoutToken({ sub, header: (h) => { const { typ: _typ, ...rest } = h; return rest; } }))).resolves.toMatchObject({ sub });
  });

  it.each([
    ["another key", { strayKey: true }, "logout_token_signature"],
    ["alg none", { header: (h: Record<string, unknown>) => ({ ...h, alg: "none" }) }, "logout_token_alg"],
    ["an unknown kid", { header: (h: Record<string, unknown>) => ({ ...h, kid: "nope" }) }, "logout_token_kid"],
    ["another typ", { header: (h: Record<string, unknown>) => ({ ...h, typ: "at+jwt" }) }, "logout_token_typ"],
    ["another audience", { claims: (c: Record<string, unknown>) => ({ ...c, aud: "other" }) }, "logout_token_aud"],
    ["another issuer", { claims: (c: Record<string, unknown>) => ({ ...c, iss: "https://evil.example" }) }, "logout_token_iss"],
    ["no expiry", { claims: (c: Record<string, unknown>) => { const { exp: _exp, ...rest } = c; return rest; } }, "logout_token_exp"],
    ["an expired token", { claims: (c: Record<string, unknown>) => ({ ...c, exp: Math.floor(Date.now() / 1000) - 120 }) }, "logout_token_exp"],
    ["an issue time in the future", { claims: (c: Record<string, unknown>) => ({ ...c, iat: Math.floor(Date.now() / 1000) + 600 }) }, "logout_token_iat"],
    ["no events", { claims: (c: Record<string, unknown>) => { const { events: _events, ...rest } = c; return rest; } }, "logout_token_events"],
    ["the wrong event", { claims: (c: Record<string, unknown>) => ({ ...c, events: { "http://example/other": {} } }) }, "logout_token_events"],
    ["an event that is not an object", { claims: (c: Record<string, unknown>) => ({ ...c, events: { "http://schemas.openid.net/event/backchannel-logout": true } }) }, "logout_token_events"],
    ["a nonce", { claims: (c: Record<string, unknown>) => ({ ...c, nonce: "n" }) }, "logout_token_nonce"],
    ["no jti", { claims: (c: Record<string, unknown>) => { const { jti: _jti, ...rest } = c; return rest; } }, "logout_token_jti"],
    ["a sid only", { claims: (c: Record<string, unknown>) => { const { sub: _sub, ...rest } = c; return { ...rest, sid: "s1" }; } }, "logout_token_sub"],
  ])("refuses %s", async (_what, tamper, code) => {
    const party = rp();
    await expect(party.verifyLogoutToken(idp.logoutToken({ sub, ...tamper }))).rejects.toMatchObject({ code });
  });

  describe("the account purged event", () => {
    const LOGOUT = "http://schemas.openid.net/event/backchannel-logout";
    const purged = (subject?: unknown) => (c: Record<string, unknown>) => ({
      ...c, events: { [LOGOUT]: {}, [ACCOUNT_PURGED_EVENT]: subject === undefined ? {} : { subject } },
    });

    it("is the RISC account purged event type", () => {
      expect(ACCOUNT_PURGED_EVENT).toBe("https://schemas.openid.net/secevent/risc/event-type/account-purged");
    });

    it("says purged when the token carries it next to the logout event, never otherwise", async () => {
      const party = rp();
      expect(await party.verifyLogoutToken(idp.logoutToken({ sub, claims: purged({ format: "iss_sub", iss: idp.issuer, sub }) }))).toMatchObject({ sub, purged: true });
      expect(await party.verifyLogoutToken(idp.logoutToken({ sub, claims: purged() }))).toMatchObject({ sub, purged: true });
      expect((await party.verifyLogoutToken(idp.logoutToken({ sub }))).purged).toBeUndefined();
    });

    it.each([
      ["another subject", purged({ format: "iss_sub", iss: "ISSUER", sub: "01J0000000000000000000OTHR" })],
      ["another issuer", purged({ format: "iss_sub", iss: "https://evil.example", sub })],
      ["a subject that is not an object", purged("someone")],
      ["an event that is not an object", (c: Record<string, unknown>) => ({ ...c, events: { [LOGOUT]: {}, [ACCOUNT_PURGED_EVENT]: true } })],
      ["the purge alone, without the logout event", (c: Record<string, unknown>) => ({ ...c, events: { [ACCOUNT_PURGED_EVENT]: {} } })],
    ])("refuses %s", async (_what, claims) => {
      const party = rp();
      const fixed = (c: Record<string, unknown>) => {
        const out = claims(c);
        const event = (out.events as Record<string, { subject?: { iss?: string } }>)[ACCOUNT_PURGED_EVENT];
        if (event?.subject?.iss === "ISSUER") event.subject.iss = idp.issuer;
        return out;
      };
      await expect(party.verifyLogoutToken(idp.logoutToken({ sub, claims: fixed }))).rejects.toMatchObject({ code: "logout_token_events" });
    });
  });

  it("never takes an id_token for a logout token, nor a logout token for an id_token", async () => {
    const party = rp();
    // an id_token carries a nonce and no events
    let captured = "";
    const spy = new OidcRelyingParty({ issuer: idp.issuer, clientId: "pulsa-bot", redirectUri: REDIRECT, resource: "http://127.0.0.1:9", fetch: async (input, init) => {
      const res = await fetch(input, init);
      if (String(input).endsWith("/oauth/token")) {
        const body = await res.clone().json() as { id_token?: string };
        captured = body.id_token ?? "";
      }
      return res;
    } });
    await signedInGrant(spy);
    expect(captured).toMatch(/^eyJ/);
    await expect(party.verifyLogoutToken(captured)).rejects.toMatchObject({ code: expect.stringMatching(/^logout_token_(nonce|events)$/) });
    // a logout token presented as a refreshed id_token is refused
    const { verifyIdToken } = await import("./oidc-rp.ts");
    await party.discover();
    await expect(verifyIdToken({
      token: idp.logoutToken({ sub }), issuer: idp.issuer, audience: "pulsa-bot", nonce: null,
      keyFor: async () => (party as unknown as { keys: Map<string, import("node:crypto").KeyObject> }).keys.values().next().value ?? null,
      nowSeconds: Math.floor(Date.now() / 1000),
    })).rejects.toMatchObject({ code: "id_token_typ" });
  });
});

describe("OIDC relying party: console assertions (slice 7)", () => {
  const sub = "01J0000000000000000000ADMN";
  const ORIGIN = "http://127.0.0.1:19192";
  type Bend = Record<string, unknown>;
  const assertion = (extra: Partial<Parameters<FakeOidcProvider["consoleAssertion"]>[0]> = {}) => idp.consoleAssertion({ sub, aud: ORIGIN, role: "manager", teams: [{ id: "T1", name: "Support", manager: true }], ...extra });

  it("accepts an assertion within 5 s of its expiry tolerance (S7-2)", async () => {
    const now = Math.floor(Date.now() / 1000);
    await expect(rp().verifyConsoleAssertion(assertion({ claims: (c: Bend) => ({ ...c, iat: now - 62, exp: now - 2 }) }), ORIGIN)).resolves.toMatchObject({ sub });
  });

  it("verifies a good assertion: role, teams, jti, server id; one trailing slash on the origin is the same", async () => {
    const party = rp();
    const got = await party.verifyConsoleAssertion(assertion(), `${ORIGIN}/`, idp.serverId);
    expect(got).toMatchObject({ iss: idp.issuer, sub, role: "manager", serverId: idp.serverId, teams: [{ id: "T1", name: "Support", manager: true }], jti: expect.stringMatching(/^[0-9a-f]{32}$/) });
    expect(got.exp - got.iat).toBe(60);
    // no link loaded: the server id is not checked
    await expect(party.verifyConsoleAssertion(assertion({ serverId: "other" }), ORIGIN)).resolves.toMatchObject({ serverId: "other" });
    // teams absent = none
    await expect(party.verifyConsoleAssertion(assertion({ claims: (c: Bend) => { const { teams: _t, ...rest } = c; return rest; } }), ORIGIN)).resolves.toMatchObject({ teams: [] });
  });

  it("names its actor; an AI client's assertion (perspicax-mcp) passes only where the route accepts it", async () => {
    const party = rp();
    await expect(party.verifyConsoleAssertion(assertion(), ORIGIN)).resolves.toMatchObject({ actor: "console" });
    const mcp = (extra = {}) => assertion({ ...extra, claims: (c: Bend) => ({ ...c, act: { sub: "perspicax-mcp" } }) });
    // the admin API (no actors given): the console only
    await expect(party.verifyConsoleAssertion(mcp(), ORIGIN)).rejects.toMatchObject({ code: "console_assertion_act" });
    // the member API: both
    await expect(party.verifyConsoleAssertion(mcp(), ORIGIN, null, ["console", "perspicax-mcp"])).resolves.toMatchObject({ sub, actor: "perspicax-mcp" });
    await expect(party.verifyConsoleAssertion(assertion({ claims: (c: Bend) => ({ ...c, act: { sub: "someone" } }) }), ORIGIN, null, ["console", "perspicax-mcp"])).rejects.toMatchObject({ code: "console_assertion_act" });
  });

  it("perspicax-mail (bot inbound mail, 2026-10-21) passes only on the inbound mail route, never the admin or member API", async () => {
    const party = rp();
    const mail = () => assertion({ claims: (c: Bend) => ({ ...c, act: { sub: "perspicax-mail" } }) });
    expect(CONSOLE_ASSERTION_ACTORS).toContain("perspicax-mail");
    // the admin API (no actors given): refused
    await expect(party.verifyConsoleAssertion(mail(), ORIGIN)).rejects.toMatchObject({ code: "console_assertion_act" });
    // the member API's actors: refused
    expect(ORG_MEMBER_ASSERTION_ACTORS).not.toContain("perspicax-mail");
    await expect(party.verifyConsoleAssertion(mail(), ORIGIN, null, ORG_MEMBER_ASSERTION_ACTORS)).rejects.toMatchObject({ code: "console_assertion_act" });
    // the inbound mail route: this actor alone
    expect(BOT_MAIL_ASSERTION_ACTORS).toEqual(["perspicax-mail"]);
    await expect(party.verifyConsoleAssertion(mail(), ORIGIN, null, BOT_MAIL_ASSERTION_ACTORS)).resolves.toMatchObject({ sub, actor: "perspicax-mail" });
    await expect(party.verifyConsoleAssertion(assertion(), ORIGIN, null, BOT_MAIL_ASSERTION_ACTORS)).rejects.toMatchObject({ code: "console_assertion_act" });
    await expect(party.verifyConsoleAssertion(assertion({ claims: (c: Bend) => ({ ...c, act: { sub: "perspicax-mcp" } }) }), ORIGIN, null, BOT_MAIL_ASSERTION_ACTORS)).rejects.toMatchObject({ code: "console_assertion_act" });
  });

  it("carries the body digest the mail relay signs (v2, S1), and refuses one that is not a SHA-256", async () => {
    const party = rp();
    const digest = "a".repeat(64);
    const mail = (value: unknown) => assertion({ claims: (c: Bend) => ({ ...c, act: { sub: "perspicax-mail" }, body_sha256: value }) });
    await expect(party.verifyConsoleAssertion(mail(digest), ORIGIN, null, BOT_MAIL_ASSERTION_ACTORS)).resolves.toMatchObject({ bodySha256: digest });
    await expect(party.verifyConsoleAssertion(mail("A".repeat(64)), ORIGIN, null, BOT_MAIL_ASSERTION_ACTORS)).rejects.toMatchObject({ code: "console_assertion_body" });
    await expect(party.verifyConsoleAssertion(mail(7), ORIGIN, null, BOT_MAIL_ASSERTION_ACTORS)).rejects.toMatchObject({ code: "console_assertion_body" });
    const plain = await party.verifyConsoleAssertion(assertion(), ORIGIN);
    expect(plain.bodySha256).toBeUndefined();
  });

  it.each([
    ["another typ", { header: (h: Bend) => ({ ...h, typ: "JWT" }) }, "console_assertion_typ"],
    ["no typ", { header: (h: Bend) => { const { typ: _typ, ...rest } = h; return rest; } }, "console_assertion_typ"],
    ["no act", { claims: (c: Bend) => { const { act: _act, ...rest } = c; return rest; } }, "console_assertion_act"],
    ["an act that is not the console", { claims: (c: Bend) => ({ ...c, act: { sub: "someone" } }) }, "console_assertion_act"],
    ["an audience array", { claims: (c: Bend) => ({ ...c, aud: [ORIGIN] }) }, "console_assertion_aud"],
    ["another origin", { aud: "http://127.0.0.1:19999" }, "console_assertion_aud"],
    ["an azp", { claims: (c: Bend) => ({ ...c, azp: ORIGIN }) }, "console_assertion_aud"],
    ["a 300 s life", { claims: (c: Bend) => ({ ...c, exp: (c.iat as number) + 300 }) }, "console_assertion_exp"],
    ["an expired assertion", { claims: (c: Bend) => ({ ...c, iat: Math.floor(Date.now() / 1000) - 200, exp: Math.floor(Date.now() / 1000) - 140 }) }, "console_assertion_exp"],
    ["no expiry", { claims: (c: Bend) => { const { exp: _exp, ...rest } = c; return rest; } }, "console_assertion_exp"],
    // S7-2: a 60 s assertion is dead 70 s after iat (tolerance 5 s, not the id_token's 60 s).
    ["an assertion 70 s after iat", { claims: (c: Bend) => ({ ...c, iat: Math.floor(Date.now() / 1000) - 70, exp: Math.floor(Date.now() / 1000) - 10 }) }, "console_assertion_exp"],
    ["an issue time 30 s ahead", { claims: (c: Bend) => ({ ...c, iat: Math.floor(Date.now() / 1000) + 30, exp: Math.floor(Date.now() / 1000) + 90 }) }, "console_assertion_iat"],
    ["an issue time in the future", { claims: (c: Bend) => ({ ...c, iat: Math.floor(Date.now() / 1000) + 600, exp: Math.floor(Date.now() / 1000) + 660 }) }, "console_assertion_iat"],
    ["a nonce", { claims: (c: Bend) => ({ ...c, nonce: "n" }) }, "console_assertion_nonce"],
    ["events", { claims: (c: Bend) => ({ ...c, events: { "http://schemas.openid.net/event/backchannel-logout": {} } }) }, "console_assertion_events"],
    ["alg none", { header: (h: Bend) => ({ ...h, alg: "none" }) }, "console_assertion_alg"],
    ["another key", { strayKey: true }, "console_assertion_signature"],
    ["an unknown kid", { header: (h: Bend) => ({ ...h, kid: "nope" }) }, "console_assertion_kid"],
    ["another issuer", { claims: (c: Bend) => ({ ...c, iss: "https://evil.example" }) }, "console_assertion_iss"],
    ["no subject", { claims: (c: Bend) => ({ ...c, sub: "" }) }, "console_assertion_sub"],
    ["a subject over 256", { claims: (c: Bend) => ({ ...c, sub: "a".repeat(257) }) }, "console_assertion_sub"],
    ["a short jti", { claims: (c: Bend) => ({ ...c, jti: "abc" }) }, "console_assertion_jti"],
    ["a jti over 256", { claims: (c: Bend) => ({ ...c, jti: "a".repeat(257) }) }, "console_assertion_jti"],
    ["an unknown role", { role: "owner" }, "console_assertion_role"],
    ["teams that are not a list", { claims: (c: Bend) => ({ ...c, teams: "T1" }) }, "console_assertion_teams"],
    ["another linked server", { serverId: "01j9s3fake0000000000other" }, "console_assertion_server"],
  ])("refuses %s", async (_what, tamper, code) => {
    const party = rp();
    await expect(party.verifyConsoleAssertion(assertion(tamper as Partial<Parameters<FakeOidcProvider["consoleAssertion"]>[0]>), ORIGIN, idp.serverId)).rejects.toMatchObject({ code });
  });

  it("refetches the JWKS once on an unknown kid, then accepts the rotated key", async () => {
    const party = rp();
    await party.verifyConsoleAssertion(assertion(), ORIGIN);
    const before = idp.jwksFetches;
    idp.rotateKey();
    await expect(party.verifyConsoleAssertion(assertion(), ORIGIN)).resolves.toMatchObject({ sub });
    expect(idp.jwksFetches - before).toBe(1);
  });

  it("never takes an assertion for an id_token or a logout token, nor the reverse", async () => {
    const party = rp();
    // an assertion is not a logout token
    await expect(party.verifyLogoutToken(idp.consoleAssertion({ sub, aud: "pulsa-bot" }))).rejects.toMatchObject({ code: expect.stringMatching(/^logout_token_/) });
    // an assertion is not an id_token, even with this client as audience
    const { verifyIdToken } = await import("./oidc-rp.ts");
    await party.discover();
    await party.verifyConsoleAssertion(assertion(), ORIGIN);
    const keyFor = async () => (party as unknown as { keys: Map<string, import("node:crypto").KeyObject> }).keys.values().next().value ?? null;
    await expect(verifyIdToken({
      token: idp.consoleAssertion({ sub, aud: "pulsa-bot" }), issuer: idp.issuer, audience: "pulsa-bot", nonce: null, keyFor,
      nowSeconds: Math.floor(Date.now() / 1000),
    })).rejects.toMatchObject({ code: "id_token_typ" });
    // a logout token is not an assertion (typ), even aimed at this origin
    await expect(party.verifyConsoleAssertion(idp.logoutToken({ sub, claims: (c) => ({ ...c, aud: ORIGIN }) }), ORIGIN)).rejects.toMatchObject({ code: "console_assertion_typ" });
    // an id_token is not an assertion
    let captured = "";
    const spy = new OidcRelyingParty({ issuer: idp.issuer, clientId: "pulsa-bot", redirectUri: REDIRECT, resource: "http://127.0.0.1:9", fetch: async (input, init) => {
      const res = await fetch(input, init);
      if (String(input).endsWith("/oauth/token")) captured = ((await res.clone().json()) as { id_token?: string }).id_token ?? "";
      return res;
    } });
    await signedInGrant(spy);
    await expect(party.verifyConsoleAssertion(captured, "pulsa-bot")).rejects.toMatchObject({ code: expect.stringMatching(/^console_assertion_/) });
  });
});

describe("OIDC relying party: internal server-to-server base (slice 3, D17)", () => {
  const ISSUER = "https://px.example.test";
  const INTERNAL = "http://perspicax:8787";
  function stub(doc: Record<string, unknown>) {
    const seen: string[] = [];
    const fetcher = (async (input: string | URL | Request) => {
      const url = String(input);
      seen.push(url);
      if (url === `${INTERNAL}/.well-known/openid-configuration`) {
        return new Response(JSON.stringify(doc), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response("{}", { status: 404 });
    }) as typeof fetch;
    return { seen, fetcher };
  }
  const metadata = {
    issuer: ISSUER,
    authorization_endpoint: `${ISSUER}/oauth/authorize`,
    token_endpoint: `${ISSUER}/oauth/token`,
    jwks_uri: `${ISSUER}/oauth/jwks`,
    revocation_endpoint: `${ISSUER}/oauth/revoke`,
    id_token_signing_alg_values_supported: ["ES256"],
  };

  it("fetches discovery at the internal origin and moves every server endpoint there, never the authorize one", async () => {
    const { seen, fetcher } = stub(metadata);
    const party = new OidcRelyingParty({ issuer: ISSUER, clientId: "pulsa-bot", redirectUri: "https://bot.example.test/auth/oidc/callback", internalBase: INTERNAL, fetch: fetcher });
    const found = await party.discover();
    expect(seen[0]).toBe(`${INTERNAL}/.well-known/openid-configuration`);
    expect(found).toMatchObject({
      issuer: ISSUER,
      authorizationEndpoint: `${ISSUER}/oauth/authorize`,
      tokenEndpoint: `${INTERNAL}/oauth/token`,
      jwksUri: `${INTERNAL}/oauth/jwks`,
      revocationEndpoint: `${INTERNAL}/oauth/revoke`,
    });
    const started = await party.start();
    expect(started.authorizationUrl.startsWith(`${ISSUER}/oauth/authorize?`)).toBe(true);
    expect(party.serverOrigin()).toBe(INTERNAL);
  });

  it("still refuses metadata naming another issuer", async () => {
    const { fetcher } = stub({ ...metadata, issuer: "https://evil.example.test" });
    const party = new OidcRelyingParty({ issuer: ISSUER, clientId: "pulsa-bot", redirectUri: "https://bot.example.test/auth/oidc/callback", internalBase: INTERNAL, fetch: fetcher });
    await expect(party.discover()).rejects.toMatchObject({ code: "discovery" });
  });

  it("keeps an endpoint on another origin under the https rule, and refuses a bad internal base", async () => {
    const { fetcher } = stub({ ...metadata, token_endpoint: "http://elsewhere.example.test/token" });
    const party = new OidcRelyingParty({ issuer: ISSUER, clientId: "pulsa-bot", redirectUri: "https://bot.example.test/auth/oidc/callback", internalBase: INTERNAL, fetch: fetcher });
    await expect(party.discover()).rejects.toMatchObject({ code: "discovery" });
    expect(() => new OidcRelyingParty({ issuer: ISSUER, clientId: "pulsa-bot", redirectUri: "https://bot.example.test/auth/oidc/callback", internalBase: "http://perspicax:8787/path" })).toThrow();
    expect(new OidcRelyingParty({ issuer: ISSUER, clientId: "pulsa-bot", redirectUri: "https://bot.example.test/auth/oidc/callback" }).serverOrigin()).toBe(ISSUER);
  });
});

describe("OIDC relying party: the teams claim (slice 4)", () => {
  it("reads teams from the id_token and leaves identity.teams undefined when the claim is absent", async () => {
    idp.user = { ...idp.user, role: "employee", teams: [{ id: "01TEAMT", name: "T", manager: false }, { id: "01TEAMA", name: "A", manager: true }] };
    const party = rp();
    const { started, params } = await authorize(party);
    const outcome = await party.callback(params, started.binding);
    expect(outcome).toMatchObject({ ok: true, identity: { teams: [{ id: "01TEAMA", name: "A", manager: true }, { id: "01TEAMT", name: "T", manager: false }] } });
    idp.user = { ...idp.user, teams: undefined };
    const second = await authorize(party);
    const plain = await party.callback(second.params, second.started.binding);
    expect(plain.ok && plain.identity.teams).toBeUndefined();
    idp.user = { ...idp.user, teams: [] };
    const third = await authorize(party);
    const empty = await party.callback(third.params, third.started.binding);
    expect(empty.ok && empty.identity.teams).toEqual([]);
  });

  it("drops malformed entries, keeps one per id with manager winning, reads 1000 at most", () => {
    expect(parseTeamsClaim(undefined)).toBeUndefined();
    expect(parseTeamsClaim("T")).toBeUndefined();
    expect(parseTeamsClaim([
      { id: "B", name: "Bravo", manager: false },
      { id: "B", name: "Bravo", manager: true },
      { id: "bad id", name: "x", manager: false },
      { id: "C", name: "x".repeat(201), manager: false },
      { id: "D", name: "Delta", manager: "yes" },
      { id: "x".repeat(65), name: "long", manager: false },
      null,
      "E",
      { id: "A", name: "Alpha", manager: false },
    ])).toEqual([{ id: "A", name: "Alpha", manager: false }, { id: "B", name: "Bravo", manager: true }]);
    const many = Array.from({ length: 1200 }, (_, i) => ({ id: `T${i}`, name: `T${i}`, manager: false }));
    expect(parseTeamsClaim(many)).toHaveLength(1000);
  });
});

describe("the access token's life (slice 5)", () => {
  it("reads expires_in with a default of 3600 s and a cap of 86400 s", () => {
    expect(accessExpiresIn(900)).toBe(900);
    expect(accessExpiresIn(undefined)).toBe(3600);
    expect(accessExpiresIn(-5)).toBe(3600);
    expect(accessExpiresIn("60")).toBe(3600);
    expect(accessExpiresIn(10 ** 9)).toBe(86_400);
  });
});

describe("routine delegation flows (slice 6)", () => {
  const expectation = { principalId: "p-ada", subject: { iss: "", sub: "01J0000000000000000000ADMN" }, sessionId: "s-1" };

  it("asks the delegation scope and forces the web client whatever client was passed", async () => {
    const party = rp();
    const started = await party.start({ client: "phone", purpose: "routines", ...expectation, subject: { iss: idp.issuer, sub: expectation.subject.sub } });
    const res = await fetch(started.authorizationUrl, { redirect: "manual" });
    expect(idp.lastAuthorize!.scope).toBe("openid profile email offline_access pulsabot:routines");
    expect(ROUTINE_DELEGATION_SCOPES).toBe("openid profile email offline_access pulsabot:routines");
    const outcome = await party.callback(new URL(res.headers.get("location")!).searchParams, started.binding);
    expect(outcome).toMatchObject({
      ok: true,
      client: "web",
      purpose: "routines",
      grantedScope: "openid profile email offline_access pulsabot:routines",
      expect: { principalId: "p-ada", subject: { iss: idp.issuer, sub: expectation.subject.sub }, sessionId: "s-1" },
    });
  });

  it("refuses to start a delegation without its principal, subject or session", async () => {
    const party = rp();
    for (const missing of ["principalId", "subject", "sessionId"] as const) {
      const options: Record<string, unknown> = { purpose: "routines", ...expectation };
      delete options[missing];
      await expect(party.start(options as Parameters<OidcRelyingParty["start"]>[0])).rejects.toMatchObject({ code: "routines_session" });
    }
    expect(party.pendingCount()).toBe(0);
  });

  it("carries the purpose and the scope the provider granted, marker or not", async () => {
    const party = rp();
    idp.tamper = { omitRoutinesMarker: true };
    const started = await party.start({ purpose: "routines", ...expectation });
    const res = await fetch(started.authorizationUrl, { redirect: "manual" });
    const outcome = await party.callback(new URL(res.headers.get("location")!).searchParams, started.binding);
    expect(outcome).toMatchObject({ ok: true, purpose: "routines", grantedScope: "openid profile email offline_access" });
  });

  it("carries the purpose of a failed callback once the flow was found, not before", async () => {
    const party = rp();
    const started = await party.start({ purpose: "routines", ...expectation });
    const res = await fetch(started.authorizationUrl, { redirect: "manual" });
    const params = new URL(res.headers.get("location")!).searchParams;
    expect(await party.callback(params, "wrong")).toMatchObject({ ok: false, code: "binding", client: "web", purpose: "routines" });
    const unknown = await party.callback(new URLSearchParams({ state: "nope", code: "x" }), started.binding);
    expect(unknown).toMatchObject({ ok: false, code: "state" });
    expect(unknown).not.toHaveProperty("purpose");
  });
});

describe("rate limits at the provider (slice 6, fix 2)", () => {
  const ISSUER = "https://idp.test";
  /** A provider that answers discovery and hands the token and revocation
   * calls to `token` / `revoke`. */
  function fakeFetch(answer: { token?: () => Response; revoke?: () => Response }, calls: string[] = []): typeof fetch {
    return (async (input: string | URL | Request) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("openid-configuration") || url.includes("oauth-authorization-server")) {
        return new Response(JSON.stringify({
          issuer: ISSUER,
          authorization_endpoint: `${ISSUER}/oauth/authorize`,
          token_endpoint: `${ISSUER}/oauth/token`,
          jwks_uri: `${ISSUER}/oauth/jwks`,
          revocation_endpoint: `${ISSUER}/oauth/revoke`,
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.endsWith("/oauth/token")) return answer.token!();
      if (url.endsWith("/oauth/revoke")) return answer.revoke!();
      return new Response("{}", { status: 404 });
    }) as typeof fetch;
  }
  const limited = (headers: Record<string, string> = {}, status = 429) =>
    () => new Response(JSON.stringify({ error: "rate_limited", message: "too many requests; slow down" }), { status, headers: { "content-type": "application/json", ...headers } });

  it("reads Retry-After as seconds or an HTTP-date, clamped to 1 s to 10 min, 60 s by default", () => {
    const now = Date.UTC(2026, 8, 30, 12, 0, 0);
    expect(parseRetryAfter("60", now)).toBe(60_000);
    expect(parseRetryAfter("0", now)).toBe(1_000);
    expect(parseRetryAfter("99999", now)).toBe(600_000);
    expect(parseRetryAfter(null, now)).toBe(60_000);
    expect(parseRetryAfter("soon", now)).toBe(60_000);
    expect(parseRetryAfter(new Date(now + 90_000).toUTCString(), now)).toBe(90_000);
    expect(parseRetryAfter(new Date(now - 90_000).toUTCString(), now)).toBe(1_000);
  });

  it("defers a refresh on a 429 with its Retry-After, and without one at 60 s", async () => {
    const party = new OidcRelyingParty({ issuer: ISSUER, clientId: "pulsa-bot", redirectUri: `${ISSUER}/cb`, fetch: fakeFetch({ token: limited({ "retry-after": "42" }) }) });
    expect(await party.refresh("pxlr1.x", { sub: "s" })).toEqual({ ok: false, kind: "transient", rateLimited: true, retryAfterMs: 42_000, error: "Perspicax is rate limiting this server (retry in 42 s)" });
    const bare = new OidcRelyingParty({ issuer: ISSUER, clientId: "pulsa-bot", redirectUri: `${ISSUER}/cb`, fetch: fakeFetch({ token: limited() }) });
    expect(await bare.refresh("pxlr1.x", { sub: "s" })).toMatchObject({ ok: false, kind: "transient", rateLimited: true, retryAfterMs: 60_000 });
  });

  it("reads the HTTP-date form", async () => {
    let clock = Date.UTC(2026, 8, 30, 12, 0, 0);
    const party = new OidcRelyingParty({ issuer: ISSUER, clientId: "pulsa-bot", redirectUri: `${ISSUER}/cb`, now: () => clock, fetch: fakeFetch({ token: limited({ "retry-after": new Date(clock + 120_000).toUTCString() }) }) });
    expect(await party.refresh("pxlr1.x", { sub: "s" })).toMatchObject({ rateLimited: true, retryAfterMs: 120_000 });
    clock += 1;
  });

  it("never takes a 400 whose body says rate_limited for a rejected grant", async () => {
    const party = new OidcRelyingParty({ issuer: ISSUER, clientId: "pulsa-bot", redirectUri: `${ISSUER}/cb`, fetch: fakeFetch({ token: limited({}, 400) }) });
    const outcome = await party.refresh("pxlr1.x", { sub: "s" });
    expect(outcome).toMatchObject({ ok: false, kind: "transient", rateLimited: true });
  });

  it("pauses refreshes after a 429 without calling again, and fails a code exchange with rate_limited", async () => {
    const calls: string[] = [];
    let clock = 1_000_000;
    const party = new OidcRelyingParty({ issuer: ISSUER, clientId: "pulsa-bot", redirectUri: `${ISSUER}/cb`, now: () => clock, fetch: fakeFetch({ token: limited({ "retry-after": "60" }) }, calls) });
    await party.refresh("pxlr1.x", { sub: "s" });
    const tokenCalls = () => calls.filter((url) => url.endsWith("/oauth/token")).length;
    expect(tokenCalls()).toBe(1);
    const deferred = await party.refresh("pxlr1.x", { sub: "s" });
    expect(deferred).toMatchObject({ ok: false, kind: "transient", rateLimited: true });
    expect(tokenCalls()).toBe(1);
    // A code coming back always goes, pause or not.
    const started = await party.start();
    const params = new URLSearchParams({ state: started.state, code: "c", iss: ISSUER });
    expect(await party.callback(params, started.binding)).toMatchObject({ ok: false, code: "rate_limited", error: "Perspicax is rate limiting sign-ins from this server. Wait a minute and try again." });
    expect(tokenCalls()).toBe(2);
    clock += 61_000;
  });

  it("tells a revocation's outcomes apart: done, a definitive 400, a 429 and a failure", async () => {
    const answers: Array<() => Response> = [
      () => new Response(null, { status: 200 }),
      () => new Response(JSON.stringify({ error: "unsupported_token_type" }), { status: 400 }),
      limited({ "retry-after": "30" }),
      () => new Response("", { status: 503 }),
    ];
    const party = new OidcRelyingParty({ issuer: ISSUER, clientId: "pulsa-bot", redirectUri: `${ISSUER}/cb`, fetch: fakeFetch({ revoke: () => answers.shift()!() }) });
    expect(await party.revokeAttempt("t")).toEqual({ kind: "done" });
    expect(await party.revokeAttempt("t")).toMatchObject({ kind: "drop" });
    expect(await party.revokeAttempt("t")).toEqual({ kind: "rate_limited", retryAfterMs: 30_000 });
    expect(await party.revokeAttempt("t")).toMatchObject({ kind: "retry" });
    expect(party.pacer.pauseRemaining()).toBeGreaterThan(0);
  });
});

describe("the picture claim", () => {
  const ISS = "https://px.example.test";
  it("gives the avatar version of a URL on the issuer's own origin", () => {
    expect(avatarVersionFromPicture(`${ISS}/api/v1/pulsabot/people/S/avatar?v=0a1b2c3d4e5f6a7b`, ISS)).toBe("0a1b2c3d4e5f6a7b");
  });

  it("ignores another host, a missing or odd version, and anything not a URL", () => {
    expect(avatarVersionFromPicture("https://tracker.example.test/a.png?v=1", ISS)).toBeUndefined();
    expect(avatarVersionFromPicture(`${ISS}/api/v1/users/S/avatar`, ISS)).toBeUndefined();
    expect(avatarVersionFromPicture(`${ISS}/a?v=../x`, ISS)).toBeUndefined();
    expect(avatarVersionFromPicture(42, ISS)).toBeUndefined();
    expect(avatarVersionFromPicture("not a url", ISS)).toBeUndefined();
  });
});
