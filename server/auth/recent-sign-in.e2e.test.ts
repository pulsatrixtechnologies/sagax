// 2026-10-18 (follow-up of #744): a bot that can create a pairing code
// (manage_pairing, act on POST /api/auth/pairing) redeems it into a brand
// new session. That session must not pass "a sign-in younger than 15
// minutes": not for the vault export in clear, not for the first security
// key. Real isolated servers, fake values only.
import { randomBytes } from "node:crypto";
import { expect, it } from "vitest";

import { launchVerificationServer } from "../../scripts/control-omb.ts";

type Call = (method: string, path: string, body?: unknown, auth?: { owner?: string; bearer?: string }) => Promise<{ status: number; text: string; body: any }>;
function caller(url: string): Call {
  return async (method, path, body, auth = {}) => {
    const response = await fetch(url + path, {
      method,
      headers: {
        "content-type": "application/json", origin: url,
        ...(auth.owner ? { "x-openmausbot-desktop-owner": auth.owner } : {}),
        ...(auth.bearer ? { authorization: `Bearer ${auth.bearer}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(10_000),
    });
    const text = await response.text();
    return { status: response.status, text, body: text ? JSON.parse(text) : null };
  };
}

it("a session redeemed from a pairing code is not a recent sign-in (desktop: export and first key refused)", async () => {
  const owner = randomBytes(32).toString("base64url");
  const fixture = await launchVerificationServer({ ...process.env, SAGAX_TEST_DESKTOP_OWNER_TOKEN: owner, SAGAX_MCP_OAUTH_KEY: randomBytes(32).toString("hex") });
  const call = caller(fixture.info.url);
  try {
    const created = await call("POST", "/api/me/credentials", { kind: "login", name: "Portail démo", username: "alex@example.com", password: "fake-pass-recent-1", domains: ["portal.example.com"] }, { owner });
    expect(created.status, created.text).toBe(201);

    // what a bot's manage_pairing does (act carries the desktop's capability)
    const pairing = await call("POST", "/api/auth/pairing", {}, { owner });
    expect(pairing.status, pairing.text).toBe(200);
    const paired = await call("POST", "/api/auth/pair", { code: pairing.body.code, label: "bot" });
    expect(paired.status, paired.text).toBe(200);
    const bearer = paired.body.token as string;

    // the new session is seconds old, yet not a recent sign-in
    const keys = await call("GET", "/api/security-keys", undefined, { bearer });
    expect(keys.status, keys.text).toBe(200);
    expect(keys.body.needsSignIn).toBe(true);
    const exported = await call("POST", "/api/me/credentials/export", { format: "bitwarden-json", acknowledge: "plaintext" }, { bearer });
    expect(exported.status, exported.text).toBe(403);
    expect(exported.body).toMatchObject({ code: "reauth_required" });
    expect(exported.text).not.toContain("fake-pass-recent-1");
    const enrolled = await call("POST", "/api/security-keys/register", { name: "Bot key", via: "desktop-window" }, { bearer });
    expect(enrolled.status, enrolled.text).toBe(403);
    expect(enrolled.body).toMatchObject({ code: "reauth_required" });

    // the desktop's own person still exports
    const mine = await call("POST", "/api/me/credentials/export", { format: "bitwarden-json", acknowledge: "plaintext" }, { owner });
    expect(mine.status, mine.text).toBe(200);
  } finally {
    await fixture.close();
  }
}, 120_000);

it("a headless server's loopback (a bot's shell there) cannot enroll a first key", async () => {
  const fixture = await launchVerificationServer({ ...process.env, SAGAX_MCP_OAUTH_KEY: randomBytes(32).toString("hex") });
  const call = caller(fixture.info.url);
  try {
    const keys = await call("GET", "/api/security-keys");
    expect(keys.status, keys.text).toBe(200);
    expect(keys.body.needsSignIn).toBe(true);
    const enrolled = await call("POST", "/api/security-keys/register", { name: "Shell key", via: "desktop-window" });
    expect(enrolled.status, enrolled.text).toBe(403);
    expect(enrolled.body).toMatchObject({ code: "reauth_required" });
    // and a code it makes gives no recent sign-in either
    const pairing = await call("POST", "/api/auth/pairing", {});
    expect(pairing.status, pairing.text).toBe(200);
    const paired = await call("POST", "/api/auth/pair", { code: pairing.body.code, label: "bot" });
    const bearer = paired.body.token as string;
    const viaCode = await call("POST", "/api/security-keys/register", { name: "Bot key", via: "desktop-window" }, { bearer });
    expect(viaCode.status, viaCode.text).toBe(403);
  } finally {
    await fixture.close();
  }
}, 120_000);
