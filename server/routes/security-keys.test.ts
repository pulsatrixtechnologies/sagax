import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { json, readBody } from "../harness/http.ts";
import { requiredScope, type RequestAuth } from "../auth/request-auth.ts";
import { SecurityKeyStore, SecurityKeys } from "../auth/security-keys.ts";
import { fakeAuthenticator, type FakeAuthenticator } from "../testing/fake-authenticator.ts";
import { ceremonyPage, createSecurityKeyRoutes, relyingParty, securityKeyCeremonyRoutes, settingsGrant } from "./security-keys.ts";
import { dispatchRoutes } from "./table.ts";

const servers: Server[] = [];
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))));
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function serve(person: string | null = "pr_alice", options: { recent?: boolean; label?: string } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "sagax-security-keys-"));
  dirs.push(dir);
  const keys = new SecurityKeys({ store: new SecurityKeyStore(join(dir, "security-keys.json")) });
  const audits: string[] = [];
  const routes = [createSecurityKeyRoutes({
    keys,
    person: () => person,
    userName: () => "alice@example.com",
    approvalGrants: () => options.label ? { grants: ["g"], label: options.label, summary: "rm /tmp/report.txt" } : { status: 404, error: "none" },
    authorizeApprovalMode: () => ({ status: 200, body: { ok: true } }),
    recentSignIn: () => options.recent ?? true,
    audit: (row) => audits.push(row.action),
    env: {},
  })];
  const ceremonies = securityKeyCeremonyRoutes({ keys });
  const auth: RequestAuth = { kind: "loopback", scopes: ["admin", "client"] } as RequestAuth;
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (await ceremonies(req, res, url)) return;
    if (!await dispatchRoutes(routes, { req, res, url, path: url.pathname, method: req.method ?? "GET", auth, json, readBody })) json(res, 404, {});
  });
  servers.push(server);
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  const port = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;
  const origin = `http://localhost:${port}`;
  const call = async (path: string, method = "GET", body?: unknown, headers: Record<string, string> = {}) => {
    const response = await fetch(`${base}${path}`, { method, headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const text = await response.text();
    let parsed: any = text;
    try { parsed = JSON.parse(text); } catch { /* the page */ }
    return { status: response.status, body: parsed, headers: response.headers };
  };
  /** The page's part: fetch the options, ask the key, post its answer. */
  const ceremony = async (start: { ceremonyId: string; kind: string }, key: FakeAuthenticator) => {
    const options = await call(`/api/security-keys/ceremony/${start.ceremonyId}`);
    expect(options.status).toBe(200);
    const response = start.kind === "register" ? key.register(options.body.options, origin, "localhost") : key.assert(options.body.options, origin, "localhost");
    return call(`/api/security-keys/ceremony/${start.ceremonyId}`, "POST", { response });
  };
  return { call, ceremony, keys, audits, origin };
}

describe("security key routes", () => {
  it("bounds the ceremony page's own fetches so a stalled server cannot hang the key prompt", () => {
    const { html } = ceremonyPage({ id: "c_test", kind: "register", phone: false });
    expect(html).toContain("AbortSignal.timeout(30_000)");
    expect(html.match(/AbortSignal\.timeout\(30_000\)/g)?.length).toBe(2);
  });

  it("are a client session's own routes, and never a bot's or a service's", async () => {
    expect(requiredScope("GET", "/api/security-keys")).toBe("client");
    expect(requiredScope("PUT", "/api/security-keys/classes")).toBe("client");
    expect(requiredScope("POST", "/api/security-keys/begin")).toBe("client");
    expect(requiredScope("POST", "/api/security-keys/register")).toBe("client");
    expect(requiredScope("DELETE", "/api/security-keys/abc_DEF-1")).toBe("client");
    expect(requiredScope("PATCH", "/api/security-keys/abc_DEF-1")).toBe("client");
    const bot = await serve(null);
    expect((await bot.call("/api/security-keys")).status).toBe(403);
    expect((await bot.call("/api/security-keys/register", "POST", { via: "desktop-window" })).status).toBe(403);
  });

  it("adds a key, then loosening anything needs that key", async () => {
    const { call, ceremony, keys } = await serve();
    const key = fakeAuthenticator();
    // no key yet: no class can be chosen
    expect((await call("/api/security-keys/classes", "PUT", { classes: ["destructive"] })).status).toBe(409);

    const start = await call("/api/security-keys/register", "POST", { name: "My key", via: "desktop-window" });
    expect(start.status).toBe(200);
    expect(start.body).toMatchObject({ kind: "register", rpId: "localhost" });
    expect((await ceremony(start.body, key)).status).toBe(200);
    expect((await call("/api/security-keys")).body.keys).toEqual([expect.objectContaining({ name: "My key", rpId: "localhost" })]);

    // adding a class tightens: no key needed
    expect((await call("/api/security-keys/classes", "PUT", { classes: ["destructive", "money"] })).body.classes).toEqual(["destructive", "money"]);

    // taking one away needs the key, signed for exactly that change
    const refused = await call("/api/security-keys/classes", "PUT", { classes: ["money"] });
    expect(refused.status).toBe(403);
    expect(refused.body).toMatchObject({ code: "step_up_required", target: { kind: "settings", action: "security-keys.classes" } });
    const wrong = await call("/api/security-keys/begin", "POST", { target: { kind: "settings", action: "security-keys.classes", detail: { classes: [] } }, via: "desktop-window" });
    expect((await ceremony(wrong.body, key)).status).toBe(200);
    expect((await call("/api/security-keys/classes", "PUT", { classes: ["money"], stepUp: wrong.body.ceremonyId })).body).toMatchObject({ code: "step_up_failed", reason: "wrong-target" });
    const begin = await call("/api/security-keys/begin", "POST", { target: refused.body.target, via: "desktop-window" });
    expect((await ceremony(begin.body, key)).status).toBe(200);
    const done = await call("/api/security-keys/classes", "PUT", { classes: ["money"], stepUp: begin.body.ceremonyId });
    expect(done.status).toBe(200);
    expect(done.body.classes).toEqual(["money"]);
    // the step-up was used: not twice
    expect((await call("/api/security-keys/classes", "PUT", { classes: [], stepUp: begin.body.ceremonyId })).status).toBe(403);

    // a second key needs the first
    expect((await call("/api/security-keys/register", "POST", { name: "Second", via: "desktop-window" })).body).toMatchObject({ code: "step_up_required" });

    // #1545: renaming is a name only, no key asked
    const id = keys.keys("pr_alice")[0]!.id;
    const renamed = await call(`/api/security-keys/${id}`, "PATCH", { name: "Blue key" });
    expect(renamed.status).toBe(200);
    expect(keys.keys("pr_alice")[0]!.name).toBe("Blue key");
    expect((await call(`/api/security-keys/${id}`, "PATCH", { name: " " })).status).toBe(400);

    // removing one needs it too
    const removeRefused = await call(`/api/security-keys/${id}`, "DELETE", {});
    expect(removeRefused.body).toMatchObject({ code: "step_up_required", target: { kind: "settings", action: "security-keys.remove", detail: { id } } });
    const removeBegin = await call("/api/security-keys/begin", "POST", { target: removeRefused.body.target, via: "desktop-window" });
    expect((await ceremony(removeBegin.body, key)).status).toBe(200);
    const removed = await call(`/api/security-keys/${id}`, "DELETE", { stepUp: removeBegin.body.ceremonyId });
    expect(removed.status).toBe(200);
    expect(removed.body).toMatchObject({ keys: [], classes: [] });
  });

  it("refuses a step-up begin with no key for this address", async () => {
    const { call } = await serve();
    const begin = await call("/api/security-keys/begin", "POST", { target: { kind: "settings", action: "custom-rules.allow", detail: {} }, via: "desktop-window" });
    expect(begin.status).toBe(409);
    expect(begin.body.code).toBe("no_key");
  });

  it("serves the ceremony page with a nonce, and takes JSON answers only", async () => {
    const { call } = await serve();
    const start = await call("/api/security-keys/register", "POST", { name: "Key", via: "desktop-window" });
    const page = await call(`/api/security-keys/ceremony/${start.body.ceremonyId}/page`);
    expect(page.status).toBe(200);
    const csp = page.headers.get("content-security-policy") ?? "";
    expect(csp).toMatch(/script-src 'nonce-[^']+'/);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(String(page.body)).toContain(start.body.ceremonyId);
    const plain = await call(`/api/security-keys/ceremony/${start.body.ceremonyId}`, "POST", undefined, { "content-type": "text/plain" });
    expect(plain.status).toBe(415);
    expect((await call("/api/security-keys/ceremony/short")).status).toBe(404);
    expect((await call(`/api/security-keys/ceremony/${"a".repeat(43)}`)).status).toBe(404);
  });
});

describe("relying party", () => {
  const req = (host: string, headers: Record<string, string> = {}) => ({ headers: { host, ...headers }, socket: { remoteAddress: "127.0.0.1", remoteFamily: "IPv4" } }) as never;

  it("is the https host behind the proxy, never an IP address", () => {
    expect(relyingParty(req("sagax.example.com", { "x-forwarded-proto": "https", "x-forwarded-for": "203.0.113.9" }), undefined, {}))
      .toEqual({ rpId: "sagax.example.com", origins: ["https://sagax.example.com"] });
    expect(relyingParty(req("192.168.1.20:8799", { "x-forwarded-for": "192.168.1.9" }), undefined, {})).toBeNull();
    expect(relyingParty(req("sagax.example.com", { "x-forwarded-proto": "http", "x-forwarded-for": "203.0.113.9" }), undefined, {})).toBeNull();
  });

  it("is localhost for the desktop window on this computer only", () => {
    expect(relyingParty(req("127.0.0.1:8799"), "desktop-window", {})).toEqual({ rpId: "localhost", origins: ["http://localhost:8799"] });
    expect(relyingParty(req("127.0.0.1:8799", { "x-forwarded-for": "203.0.113.9" }), "desktop-window", {})).toBeNull();
  });

  it("follows a pinned RP ID", () => {
    expect(relyingParty(req("anything"), undefined, { SAGAX_WEBAUTHN_RP_ID: "sagax.example.com" }))
      .toEqual({ rpId: "sagax.example.com", origins: ["https://sagax.example.com"] });
  });

  it("names a settings grant by its action and exact detail", () => {
    expect(settingsGrant("approval-mode", { botId: "b", mode: "auto" })).toBe(settingsGrant("approval-mode", { mode: "auto", botId: "b" }));
    expect(settingsGrant("approval-mode", { botId: "b", mode: "auto" })).not.toBe(settingsGrant("approval-mode", { botId: "b", mode: "full" }));
  });
});

describe("security key routes, hardening", () => {
  it("the first key needs a recent sign-in, and its start is audited", async () => {
    const stale = await serve("pr_alice", { recent: false });
    expect((await stale.call("/api/security-keys/register", "POST", { name: "Key", via: "desktop-window" })).body).toMatchObject({ code: "reauth_required" });
    const fresh = await serve();
    expect((await fresh.call("/api/security-keys/register", "POST", { name: "Key", via: "desktop-window" })).status).toBe(200);
    expect(fresh.audits).toContain("security_keys.add-started");
  });

  it("says before the first key that this sign-in is too old (2026-10-18)", async () => {
    const stale = await serve("pr_alice", { recent: false });
    expect((await stale.call("/api/security-keys")).body).toMatchObject({ keys: [], needsSignIn: true });
    const fresh = await serve();
    expect((await fresh.call("/api/security-keys")).body.needsSignIn).toBeUndefined();
  });

  it("answers a ceremony's status by its id only: waiting, done, failed, expired (2026-10-18)", async () => {
    const { call, ceremony } = await serve();
    const key = fakeAuthenticator();
    expect((await call(`/api/security-keys/ceremony/${"a".repeat(43)}/status`)).body).toEqual({ status: "expired" });
    expect((await call("/api/security-keys/ceremony/short/status")).status).toBe(404);
    const start = (await call("/api/security-keys/register", "POST", { name: "Mac", via: "desktop-window" })).body;
    const status = () => call(`/api/security-keys/ceremony/${start.ceremonyId}/status`);
    expect((await status()).body).toEqual({ status: "waiting" });
    expect((await call(`/api/security-keys/ceremony/${start.ceremonyId}/status`, "POST", {})).status).toBe(405);
    expect((await ceremony(start, key)).status).toBe(200);
    expect((await status()).body).toEqual({ status: "done" });
    expect((await status()).headers.get("cache-control")).toBe("no-store");
    // a bad answer spends the ceremony: failed
    const second = await call("/api/security-keys/register", "POST", { name: "Other", via: "desktop-window" });
    expect(second.body.code).toBe("step_up_required");
    const begin = (await call("/api/security-keys/begin", "POST", { target: second.body.target, via: "desktop-window" })).body;
    expect((await call(`/api/security-keys/ceremony/${begin.ceremonyId}`, "POST", { response: { id: "nope" } })).status).toBe(400);
    expect((await call(`/api/security-keys/ceremony/${begin.ceremonyId}/status`)).body).toEqual({ status: "failed" });
  });

  it("a second key's step-up is bound to that key's name", async () => {
    const { call, ceremony } = await serve();
    const key = fakeAuthenticator();
    expect((await ceremony((await call("/api/security-keys/register", "POST", { name: "First", via: "desktop-window" })).body, key)).status).toBe(200);
    const refused = await call("/api/security-keys/register", "POST", { name: "Second", via: "desktop-window" });
    expect(refused.body.target).toMatchObject({ action: "security-keys.add", detail: { name: "Second", rpId: "localhost" } });
    const other = await call("/api/security-keys/begin", "POST", { target: { kind: "settings", action: "security-keys.add", detail: { name: "Other", rpId: "localhost" } }, via: "desktop-window" });
    expect((await ceremony(other.body, key)).status).toBe(200);
    expect((await call("/api/security-keys/register", "POST", { name: "Second", via: "desktop-window", stepUp: other.body.ceremonyId })).body).toMatchObject({ code: "step_up_failed" });
  });

  it("the ceremony page shows what the key signs", async () => {
    const { call, ceremony } = await serve("pr_alice", { label: "Allow Alpha to delete a file?" });
    expect((await ceremony((await call("/api/security-keys/register", "POST", { name: "K", via: "desktop-window" })).body, fakeAuthenticator())).status).toBe(200);
    const begin = await call("/api/security-keys/begin", "POST", { target: { kind: "approval", threadId: "t", requestId: "r" }, via: "desktop-window" });
    const page = String((await call(`/api/security-keys/ceremony/${begin.body.ceremonyId}/page`)).body);
    expect(page).toContain("Allow Alpha to delete a file?");
    expect(page).toContain("rm /tmp/report.txt");
    expect(page).toMatch(/id="digest"/);
  });
});
