// vault_http_request: the server adds the key, the bot never sees it
// (server/vault/credential-http.ts, the internal route of
// server/routes/credential-vault-internal.ts, CredentialVault.resolveForRequest).
// A local HTTP server stands for the API; the resolver and the address
// classes are injected, so the address rules stay testable without DNS.
import { createServer, type IncomingMessage, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { vaultHandle } from "../../shared/credential-vault.ts";
import { secretVariants, sendWithInjectedKey, type CredentialHttpOptions, type InjectedSecret } from "./credential-http.ts";
import { CredentialVault, LOCAL_VAULT_PRINCIPAL } from "./credential-vault.ts";
import type { VaultKeySource } from "../mcp/mcp-oauth.ts";
import { createCredentialVaultInternalRoutes } from "../routes/credential-vault-internal.ts";
import { PASS } from "../routes/table.ts";

// Every value below is fake test data.
const FAKE_KEY = "fake-api-key-0123456789-for-tests";
const KEY: VaultKeySource = { kind: "key", key: Buffer.alloc(32, 7) };

interface Seen { url: string; headers: IncomingMessage["headers"]; body: string; port: number }
let api: Server;
let other: Server;
let apiPort = 0;
let otherPort = 0;
const seen: Seen[] = [];
let respond: (req: IncomingMessage, body: string, res: import("node:http").ServerResponse) => void = (_req, _body, res) => res.end("ok");

function listen(server: Server): Promise<number> {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port)));
}

beforeAll(async () => {
  const handler = (port: () => number) => (req: IncomingMessage, res: import("node:http").ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      seen.push({ url: req.url ?? "", headers: req.headers, body, port: port() });
      if (port() === otherPort) return res.end("other origin");
      respond(req, body, res);
    });
  };
  api = createServer(handler(() => apiPort));
  other = createServer(handler(() => otherPort));
  apiPort = await listen(api);
  otherPort = await listen(other);
});
afterAll(async () => {
  await new Promise((resolve) => api.close(resolve));
  await new Promise((resolve) => other.close(resolve));
});
afterEach(() => {
  seen.length = 0;
  respond = (_req, _body, res) => res.end("ok");
});

/** The API is "api.example.com" on the test server's port; "other.example.com" another origin. */
const options = (extra: Partial<CredentialHttpOptions> = {}): CredentialHttpOptions => ({
  plainHttpForTests: true,
  resolve: async () => [{ address: "127.0.0.1", family: 4 }],
  classify: () => "public",
  ...extra,
});
const secret = (injection: InjectedSecret["injection"], extra: Partial<InjectedSecret> = {}): InjectedSecret => ({
  value: FAKE_KEY,
  injection,
  domains: [`api.example.com:${apiPort}`],
  ...extra,
});
const at = (path: string) => `https://api.example.com:${apiPort}${path}`;

/** Nothing the bot reads may hold the key or any of its encodings. */
function expectClean(value: unknown, username?: string) {
  const text = JSON.stringify(value);
  for (const variant of secretVariants({ value: FAKE_KEY, injection: { mode: username ? "basic" : "bearer" }, ...(username ? { username } : {}) })) {
    if (variant.length >= 8) expect(text).not.toContain(variant);
  }
  expect(text).not.toContain(FAKE_KEY);
}

describe("sendWithInjectedKey: injection by mode", () => {
  it("adds Authorization: Bearer", async () => {
    const outcome = await sendWithInjectedKey(secret({ mode: "bearer" }), { url: at("/v1/items") }, options());
    expect(outcome).toMatchObject({ ok: true, status: 200, body: "ok" });
    expect(seen[0]!.headers.authorization).toBe(`Bearer ${FAKE_KEY}`);
    expectClean(outcome);
  });

  it("adds the header the person named", async () => {
    const outcome = await sendWithInjectedKey(secret({ mode: "header", header: "X-Api-Key" }), { url: at("/v1/items"), headers: { Accept: "application/json" } }, options());
    expect(outcome.ok).toBe(true);
    expect(seen[0]!.headers["x-api-key"]).toBe(FAKE_KEY);
    expect(seen[0]!.headers.authorization).toBeUndefined();
    expect(seen[0]!.headers.accept).toBe("application/json");
  });

  it("adds Basic with the item's user name", async () => {
    const outcome = await sendWithInjectedKey(secret({ mode: "basic" }, { username: "ada" }), { url: at("/v1/items") }, options());
    expect(outcome.ok).toBe(true);
    expect(seen[0]!.headers.authorization).toBe(`Basic ${Buffer.from(`ada:${FAKE_KEY}`).toString("base64")}`);
  });

  it("adds the query parameter and never shows it in the URL returned", async () => {
    const outcome = await sendWithInjectedKey(secret({ mode: "query", param: "api_key" }), { url: at("/v1/items?page=2") }, options());
    expect(outcome.ok).toBe(true);
    const sent = new URL(seen[0]!.url, "http://x");
    expect(sent.searchParams.get("api_key")).toBe(FAKE_KEY);
    expect(sent.searchParams.get("page")).toBe("2");
    if (outcome.ok) expect(outcome.url).toBe(at("/v1/items?page=2"));
    expectClean(outcome);
  });

  it("sends a JSON body for an object", async () => {
    respond = (_req, body, res) => res.end(`got ${body}`);
    const outcome = await sendWithInjectedKey(secret({ mode: "bearer" }), { method: "POST", url: at("/v1/items"), body: { name: "Example" } }, options());
    expect(outcome).toMatchObject({ ok: true, body: 'got {"name":"Example"}' });
    expect(seen[0]!.headers["content-type"]).toBe("application/json");
  });
});

describe("sendWithInjectedKey: where the key goes", () => {
  it("refuses a URL that is not on the key's sites, and sends nothing", async () => {
    const outcome = await sendWithInjectedKey(secret({ mode: "bearer" }), { url: `https://other.example.com:${apiPort}/` }, options());
    expect(outcome).toMatchObject({ ok: false, code: "wrong_origin" });
    expect(seen).toHaveLength(0);
  });

  it("refuses plain http and a URL with a user name", async () => {
    expect(await sendWithInjectedKey(secret({ mode: "bearer" }), { url: `http://api.example.com:${apiPort}/` }, options())).toMatchObject({ ok: false, code: "wrong_origin" });
    expect(await sendWithInjectedKey(secret({ mode: "bearer" }), { url: `https://ada@api.example.com:${apiPort}/` }, options())).toMatchObject({ ok: false });
    expect(seen).toHaveLength(0);
  });

  it("keeps to the base path", async () => {
    const based = secret({ mode: "bearer", basePath: "/v1" });
    expect(await sendWithInjectedKey(based, { url: at("/v10/items") }, options())).toMatchObject({ ok: false, code: "wrong_origin" });
    expect(await sendWithInjectedKey(based, { url: at("/v1/../admin") }, options())).toMatchObject({ ok: false, code: "wrong_origin" });
    expect(await sendWithInjectedKey(based, { url: at("/v1/items") }, options())).toMatchObject({ ok: true });
    expect(seen).toHaveLength(1);
  });

  it("refuses private, loopback, link-local and metadata addresses before connecting", async () => {
    for (const address of ["127.0.0.1", "10.0.0.5", "192.168.1.20", "169.254.169.254", "fd00:ec2::254", "::1", "0.0.0.0"]) {
      const outcome = await sendWithInjectedKey(secret({ mode: "bearer" }), { url: at("/") }, options({
        resolve: async () => [{ address, family: address.includes(":") ? 6 : 4 }],
        classify: undefined,
      }));
      expect(outcome, address).toMatchObject({ ok: false, code: "blocked_address" });
    }
    expect(seen).toHaveLength(0);
  });

  it("refuses a host when any one of its addresses is private", async () => {
    const outcome = await sendWithInjectedKey(secret({ mode: "bearer" }), { url: at("/") }, options({
      resolve: async () => [{ address: "93.184.215.14", family: 4 }, { address: "10.1.2.3", family: 4 }],
      classify: undefined,
    }));
    expect(outcome).toMatchObject({ ok: false, code: "blocked_address" });
    expect(seen).toHaveLength(0);
  });

  it("never follows a redirect to another origin, so the key never goes there", async () => {
    respond = (_req, _body, res) => { res.statusCode = 302; res.setHeader("location", `https://other.example.com:${otherPort}/steal`); res.end(); };
    const outcome = await sendWithInjectedKey(secret({ mode: "bearer" }, { domains: [`api.example.com:${apiPort}`, `other.example.com:${otherPort}`] }), { url: at("/v1/items") }, options());
    expect(outcome).toMatchObject({ ok: false, code: "redirect_refused" });
    expect(seen.map((row) => row.port)).toEqual([apiPort]);
  });

  it("follows a same-origin redirect and adds the key again", async () => {
    respond = (req, _body, res) => {
      if (req.url === "/v1/old") { res.statusCode = 301; res.setHeader("location", "/v1/new"); res.end(); return; }
      res.end("moved here");
    };
    const outcome = await sendWithInjectedKey(secret({ mode: "header", header: "X-Api-Key" }), { url: at("/v1/old") }, options());
    expect(outcome).toMatchObject({ ok: true, body: "moved here", redirects: 1 });
    expect(seen.map((row) => row.headers["x-api-key"])).toEqual([FAKE_KEY, FAKE_KEY]);
  });

  it("refuses the header the key rides in and credential headers", async () => {
    for (const headers of [{ Authorization: "Bearer mine" }, { "X-Api-Key": "mine" }, { Cookie: "a=b" }, { Host: "elsewhere.example" }]) {
      const outcome = await sendWithInjectedKey(secret({ mode: "header", header: "X-Api-Key" }), { url: at("/"), headers }, options());
      expect(outcome, JSON.stringify(headers)).toMatchObject({ ok: false, code: "refused_header" });
    }
    expect(seen).toHaveLength(0);
  });
});

describe("sendWithInjectedKey: the value never reaches the bot", () => {
  it("removes echoes of the key from the body and the headers, encoded or not", async () => {
    respond = (req, _body, res) => {
      res.setHeader("x-echo", String(req.headers.authorization));
      res.setHeader("x-echo-b64", Buffer.from(FAKE_KEY).toString("base64"));
      res.setHeader("set-cookie", `session=${FAKE_KEY}`);
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ raw: FAKE_KEY, url: encodeURIComponent(FAKE_KEY), b64: Buffer.from(FAKE_KEY).toString("base64url"), hex: Buffer.from(FAKE_KEY).toString("hex") }));
    };
    const outcome = await sendWithInjectedKey(secret({ mode: "bearer" }), { url: at("/echo") }, options());
    expect(outcome.ok).toBe(true);
    expectClean(outcome);
    if (outcome.ok) {
      expect(outcome.headers["set-cookie"]).toBeUndefined();
      expect(outcome.body).toContain("[redacted key]");
    }
  });

  it("removes the Basic pair echoed back", async () => {
    respond = (req, _body, res) => res.end(String(req.headers.authorization));
    const outcome = await sendWithInjectedKey(secret({ mode: "basic" }, { username: "ada" }), { url: at("/echo") }, options());
    expectClean(outcome, "ada");
  });

  it("keeps errors free of the key: a timeout, a refused redirect to a URL holding it", async () => {
    respond = () => { /* never answers */ };
    const slow = await sendWithInjectedKey(secret({ mode: "query", param: "api_key" }), { url: at("/slow") }, options({ timeoutMs: 200 }));
    expect(slow).toMatchObject({ ok: false, code: "timeout" });
    expectClean(slow);
    respond = (_req, _body, res) => { res.statusCode = 302; res.setHeader("location", `https://${FAKE_KEY}.other.example.com/`); res.end(); };
    const redirected = await sendWithInjectedKey(secret({ mode: "bearer" }), { url: at("/r") }, options());
    expect(redirected).toMatchObject({ ok: false, code: "redirect_refused" });
    expectClean(redirected);
  });

  it("cuts an answer past the size limit", async () => {
    respond = (_req, _body, res) => res.end("x".repeat(5000));
    const outcome = await sendWithInjectedKey(secret({ mode: "bearer" }), { url: at("/big") }, options({ maxResponseBytes: 1000 }));
    expect(outcome).toMatchObject({ ok: true, truncated: true, bytes: 1000 });
  });
});

describe("the internal route: grants, sites, audit", () => {
  const dirs: string[] = [];
  afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

  function setup() {
    const dir = mkdtempSync(join(tmpdir(), "sagax-vault-http-"));
    dirs.push(dir);
    const vault = new CredentialVault(dir, () => KEY);
    const item = vault.create(LOCAL_VAULT_PRINCIPAL, { kind: "apiKey", name: "Example API", apiKey: FAKE_KEY, domains: [`api.example.com:${apiPort}`], injection: { mode: "bearer" } });
    const audits: unknown[] = [];
    const route = createCredentialVaultInternalRoutes({
      vault,
      principalForThread: () => LOCAL_VAULT_PRINCIPAL,
      botName: () => "Helper",
      postCard: () => "m1",
      http: options(),
      audit: (detail) => audits.push(detail),
    });
    async function call(body: Record<string, unknown>, botId = "bot-a") {
      let answer: { status: number; body: unknown } | null = null;
      const out = await route({
        res: {} as never,
        path: "/api/internal/credentials/http",
        method: "POST",
        json: ((_res: unknown, status: number, payload: unknown) => { answer = { status, body: payload }; }) as never,
        capability: { botId, threadId: "t1", generation: "g1" },
        readBody: async () => body,
      });
      expect(out).not.toBe(PASS);
      return answer as unknown as { status: number; body: { text: string; isError?: boolean } };
    }
    return { vault, item, audits, call };
  }

  it("refuses a bot the person did not allow, and sends nothing", async () => {
    const { item, call } = setup();
    const answer = await call({ handle: vaultHandle(item.id), url: at("/v1/items") });
    expect(answer.body).toMatchObject({ isError: true });
    expect(answer.body.text).toMatch(/not allowed/);
    expect(seen).toHaveLength(0);
  });

  it("sends for an allowed bot, and neither the answer nor the audit holds the key", async () => {
    const { vault, item, audits, call } = setup();
    vault.grant(LOCAL_VAULT_PRINCIPAL, item.id, { botId: "bot-a", mode: "always" });
    respond = (req, _body, res) => res.end(`you sent ${req.headers.authorization}`);
    const answer = await call({ handle: vaultHandle(item.id), url: at("/v1/items") });
    expect(answer.body.isError).toBeUndefined();
    expect(answer.body.text).toContain("HTTP 200");
    expect(seen[0]!.headers.authorization).toBe(`Bearer ${FAKE_KEY}`);
    expectClean(answer);
    expectClean(audits);
    expect(audits).toEqual([{ botId: "bot-a", host: `api.example.com:${apiPort}`, method: "GET", status: 200 }]);
    expect(vault.item(LOCAL_VAULT_PRINCIPAL, item.id)).toMatchObject({ lastUsedBy: "bot-a" });
    // another bot is still refused
    expect((await call({ handle: vaultHandle(item.id), url: at("/v1/items") }, "bot-b")).body.isError).toBe(true);
  });

  it("refuses a URL off the key's sites, and an API key Sagax does not send", async () => {
    const { vault, item, call } = setup();
    vault.grant(LOCAL_VAULT_PRINCIPAL, item.id, { botId: "bot-a", mode: "always" });
    expect((await call({ handle: vaultHandle(item.id), url: `https://other.example.com:${otherPort}/` })).body.text).toMatch(/only sent to/);
    const plain = vault.create(LOCAL_VAULT_PRINCIPAL, { kind: "apiKey", name: "Fill only", apiKey: FAKE_KEY, domains: [`api.example.com:${apiPort}`] });
    vault.grant(LOCAL_VAULT_PRINCIPAL, plain.id, { botId: "bot-a", mode: "always" });
    expect((await call({ handle: vaultHandle(plain.id), url: at("/") })).body.text).toMatch(/not an API key Sagax sends/);
    expect(seen).toHaveLength(0);
  });
});
