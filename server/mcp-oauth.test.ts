import { createCipheriv, randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { RemoteMcpSpec } from "./contracts.ts";
import { requiredScope } from "./request-auth.ts";
import {
  authorizationServerMetadataUrls,
  callbackPage,
  canonicalResource,
  DEFAULT_MCP_ACCOUNT,
  MAX_MCP_ACCOUNTS,
  McpOAuthManager,
  McpOAuthVault,
  parseBearerChallenge,
  parseMcpAccountChoices,
  PENDING_FLOW_TTL_MS,
  phoneOAuthReturns,
  phoneReturnLocation,
  protectedResourceMetadataUrls,
  REFRESH_MARGIN_MS,
  resolveVaultKey,
  type VaultKeySource,
} from "./mcp-oauth.ts";
import { startFakeOAuthMcp, type FakeOAuthMcp } from "./testing/fake-oauth-mcp-server.ts";

const REDIRECT = "http://127.0.0.1:65000/api/mcp-oauth/callback";
const FIXED_KEY: VaultKeySource = { kind: "key", key: Buffer.alloc(32, 7) };

let dir: string;
let fake: FakeOAuthMcp | undefined;
let clock: number;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mcp-oauth-"));
  clock = 1_000_000;
});
afterEach(async () => {
  await fake?.close();
  fake = undefined;
  rmSync(dir, { recursive: true, force: true });
});

function manager(
  key: () => VaultKeySource = () => FIXED_KEY,
  extra: { sleep?: (ms: number, signal?: AbortSignal) => Promise<void>; timeoutMs?: number } = {},
): McpOAuthManager {
  return new McpOAuthManager({
    vault: new McpOAuthVault(dir, key),
    now: () => clock,
    timeoutMs: extra.timeoutMs ?? 5_000,
    ...(extra.sleep ? { sleep: extra.sleep } : {}),
  });
}

function remote(url: string, headers: Record<string, string> = {}): RemoteMcpSpec {
  return { type: "http", url, headers };
}

/** Probe, start, consent at the fake, and come back through the callback. */
async function signIn(oauth: McpOAuthManager, name: string, server: RemoteMcpSpec, extra: { clientId?: string } = {}) {
  await oauth.probe(name, server);
  const { authorizationUrl } = await oauth.start(name, server, { redirectUri: REDIRECT, ...extra });
  const back = await fake!.authorize(authorizationUrl);
  return oauth.callback(back.searchParams);
}

describe("discovery helpers", () => {
  it("reads a Bearer challenge with quoted and bare parameters", () => {
    expect(parseBearerChallenge('Bearer error="invalid_token", resource_metadata="https://a.example/.well-known/oauth-protected-resource", scope="a b"'))
      .toEqual({ error: "invalid_token", resource_metadata: "https://a.example/.well-known/oauth-protected-resource", scope: "a b" });
    expect(parseBearerChallenge('Basic realm="x", Bearer realm=api')).toEqual({ realm: "api" });
    expect(parseBearerChallenge("Basic realm=x")).toBeNull();
    expect(parseBearerChallenge(null)).toBeNull();
  });

  it("builds the well-known URLs in the order the spec lists them", () => {
    expect(protectedResourceMetadataUrls("https://mcp.example.com/public/mcp")).toEqual([
      "https://mcp.example.com/.well-known/oauth-protected-resource/public/mcp",
      "https://mcp.example.com/.well-known/oauth-protected-resource",
    ]);
    expect(authorizationServerMetadataUrls("https://auth.example.com/tenant1")).toEqual([
      "https://auth.example.com/.well-known/oauth-authorization-server/tenant1",
      "https://auth.example.com/.well-known/openid-configuration/tenant1",
      "https://auth.example.com/tenant1/.well-known/openid-configuration",
    ]);
    expect(authorizationServerMetadataUrls("https://auth.example.com")).toEqual([
      "https://auth.example.com/.well-known/oauth-authorization-server",
      "https://auth.example.com/.well-known/openid-configuration",
    ]);
    expect(canonicalResource("HTTPS://MCP.Example.com/")).toBe("https://mcp.example.com");
    expect(canonicalResource("https://mcp.example.com/mcp#x")).toBe("https://mcp.example.com/mcp");
  });
});

describe("probe and discovery", () => {
  it("follows resource_metadata from the 401 to the authorization server", async () => {
    fake = await startFakeOAuthMcp();
    const oauth = manager();
    const status = await oauth.probe("notes", remote(fake.mcpUrl));
    expect(status).toMatchObject({ auth: "required", authClient: "dynamic" });
    const record = oauth.vault.get("notes")!;
    expect(record).toMatchObject({
      resource: fake.mcpUrl,
      issuer: fake.issuer,
      authorizationEndpoint: `${fake.issuer}/authorize`,
      tokenEndpoint: `${fake.issuer}/token`,
      registrationEndpoint: `${fake.issuer}/register`,
      revocationEndpoint: `${fake.issuer}/revoke`,
      scope: "notes:read",
    });
  });

  it("falls back to the well-known resource metadata and OpenID discovery", async () => {
    fake = await startFakeOAuthMcp({ metadataHint: "wellknown", asMetadata: "oidc" });
    const oauth = manager();
    expect((await oauth.probe("notes", remote(fake.mcpUrl))).auth).toBe("required");
    expect(oauth.vault.get("notes")!.tokenEndpoint).toBe(`${fake.issuer}/token`);
  });

  it("refuses metadata that names another origin, or lacks S256", async () => {
    fake = await startFakeOAuthMcp({ foreignResource: true });
    expect((await manager().probe("notes", remote(fake.mcpUrl))).auth).toBe("error");
    await fake.close();
    fake = await startFakeOAuthMcp({ noS256: true });
    const oauth = manager();
    expect(await oauth.probe("other", remote(fake.mcpUrl))).toMatchObject({ auth: "error", authError: expect.stringMatching(/does not offer OAuth/) });
  });

  it("reports none for a server that answers without a sign-in", async () => {
    fake = await startFakeOAuthMcp();
    fake.validAccess.add("static-fake-token");
    const oauth = manager();
    expect(await oauth.probe("notes", remote(fake.mcpUrl, { Authorization: "Bearer static-fake-token" }))).toEqual({ auth: "none" });
    expect(oauth.vault.get("notes")).toBeUndefined();
    expect(oauth.status("notes", remote(fake.mcpUrl, { Authorization: "Bearer static-fake-token" }))).toEqual({ auth: "none" });
  });
});

describe("client registration", () => {
  it("registers dynamically as a public client with the loopback redirect", async () => {
    fake = await startFakeOAuthMcp();
    const oauth = manager();
    await oauth.probe("notes", remote(fake.mcpUrl));
    await oauth.start("notes", remote(fake.mcpUrl), { redirectUri: REDIRECT });
    expect(fake.registrations).toEqual([expect.objectContaining({
      redirect_uris: [REDIRECT],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    })]);
    // a second start reuses the client
    await oauth.start("notes", remote(fake.mcpUrl), { redirectUri: REDIRECT });
    expect(fake.registrations).toHaveLength(1);
  });

  it("asks for a client id when the server offers no registration, then uses it", async () => {
    fake = await startFakeOAuthMcp({ registration: false });
    const oauth = manager();
    expect(await oauth.probe("notes", remote(fake.mcpUrl))).toMatchObject({ auth: "required", authClient: "needed" });
    await expect(oauth.start("notes", remote(fake.mcpUrl), { redirectUri: REDIRECT })).rejects.toMatchObject({ code: "client_required" });
    const result = await signIn(oauth, "notes", remote(fake.mcpUrl), { clientId: "user-registered-client" });
    expect(result).toEqual({ ok: true, name: "notes" });
    expect(fake.tokenRequests[0]).toMatchObject({ client_id: "user-registered-client", grant_type: "authorization_code" });
    expect(oauth.status("notes", remote(fake.mcpUrl))).toMatchObject({ auth: "connected", authClient: "manual" });
  });
});

describe("authorization code with PKCE and state", () => {
  it("sends S256, resource and state, and redeems the code once", async () => {
    fake = await startFakeOAuthMcp();
    const oauth = manager();
    await oauth.probe("notes", remote(fake.mcpUrl));
    const { authorizationUrl } = await oauth.start("notes", remote(fake.mcpUrl), { redirectUri: REDIRECT });
    const params = new URL(authorizationUrl).searchParams;
    expect(params.get("code_challenge_method")).toBe("S256");
    expect(params.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(params.get("resource")).toBe(fake.mcpUrl);
    expect(params.get("scope")).toBe("notes:read");
    expect(params.get("redirect_uri")).toBe(REDIRECT);
    expect(params.get("state")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(oauth.pendingFor("notes")).toBe(true);

    const back = await fake.authorize(authorizationUrl);
    expect(await oauth.callback(back.searchParams)).toEqual({ ok: true, name: "notes" });
    expect(fake.tokenRequests[0]).toMatchObject({ grant_type: "authorization_code", resource: fake.mcpUrl, redirect_uri: REDIRECT });
    expect(oauth.pendingFor("notes")).toBe(false);
    // replaying the same redirect is refused: the state was single use
    expect(await oauth.callback(back.searchParams)).toMatchObject({ ok: false, error: expect.stringMatching(/expired or was already used/) });
  });

  it("rejects an unknown state and an expired one", async () => {
    fake = await startFakeOAuthMcp();
    const oauth = manager();
    expect(await oauth.callback(new URLSearchParams({ code: "x", state: "forged" }))).toMatchObject({ ok: false });
    await oauth.probe("notes", remote(fake.mcpUrl));
    const { authorizationUrl } = await oauth.start("notes", remote(fake.mcpUrl), { redirectUri: REDIRECT });
    const back = await fake.authorize(authorizationUrl);
    clock += PENDING_FLOW_TTL_MS + 1;
    expect(await oauth.callback(back.searchParams)).toMatchObject({ ok: false, error: expect.stringMatching(/expired/) });
    expect(fake.tokenRequests).toHaveLength(0);
    expect(oauth.status("notes", remote(fake.mcpUrl))?.auth).toBe("required");
  });

  it("records a refusal at the authorization server without tokens", async () => {
    fake = await startFakeOAuthMcp();
    const oauth = manager();
    await oauth.probe("notes", remote(fake.mcpUrl));
    const { authorizationUrl } = await oauth.start("notes", remote(fake.mcpUrl), { redirectUri: REDIRECT });
    const state = new URL(authorizationUrl).searchParams.get("state")!;
    expect(await oauth.callback(new URLSearchParams({ error: "access_denied", state }))).toEqual({ ok: false, name: "notes", error: "The sign-in was cancelled." });
    expect(oauth.status("notes", remote(fake.mcpUrl))).toMatchObject({ auth: "required", authError: "The sign-in was cancelled." });
  });

  it("refuses a callback from another issuer (RFC 9207)", async () => {
    fake = await startFakeOAuthMcp();
    const oauth = manager();
    await oauth.probe("notes", remote(fake.mcpUrl));
    const { authorizationUrl } = await oauth.start("notes", remote(fake.mcpUrl), { redirectUri: REDIRECT });
    const back = await fake.authorize(authorizationUrl);
    back.searchParams.set("iss", "https://attacker.example");
    expect(await oauth.callback(back.searchParams)).toMatchObject({ ok: false, error: expect.stringMatching(/unexpected authorization server/) });
    expect(fake.tokenRequests).toHaveLength(0);
  });
});

describe("tokens for engines", () => {
  it("injects the bearer, replacing a typed Authorization header only for that server", async () => {
    fake = await startFakeOAuthMcp();
    const oauth = manager();
    const server = remote(fake.mcpUrl, { authorization: "Bearer stale", "X-Org": "acme" });
    await signIn(oauth, "notes", server);
    const access = [...fake.validAccess][0]!;
    const mounted = oauth.withAuthHeaders({
      notes: server,
      other: remote("https://other.example/mcp", { Authorization: "Bearer keep" }),
      local: { command: "npx", args: [], env: {} },
    });
    expect(mounted.notes).toEqual({ type: "http", url: fake.mcpUrl, headers: { "X-Org": "acme", Authorization: `Bearer ${access}` } });
    expect(mounted.other).toEqual(remote("https://other.example/mcp", { Authorization: "Bearer keep" }));
    expect(mounted.local).toEqual({ command: "npx", args: [], env: {} });
    // a server whose address changed never receives the old token
    expect(oauth.withAuthHeaders({ notes: remote(`${fake.base}/moved`) }).notes.headers).toEqual({});
    // an expired access token is not sent
    clock += 3_600_000;
    expect(oauth.withAuthHeaders({ notes: server }).notes.headers).toEqual({ authorization: "Bearer stale", "X-Org": "acme" });
  });

  it("refreshes before expiry and after the server refuses the token", async () => {
    // Access lives long enough that a fresh token is outside the turn margin.
    fake = await startFakeOAuthMcp({ accessTtl: Math.ceil(REFRESH_MARGIN_MS / 1000) + 600 });
    const oauth = manager();
    const server = remote(fake.mcpUrl);
    await signIn(oauth, "notes", server);
    const first = oauth.vault.get("notes")!.tokens!.access;
    await oauth.refreshDue({ notes: server });
    expect(oauth.vault.get("notes")!.tokens!.access).toBe(first); // not due yet
    // Enter the turn-length margin: refresh so a long engine turn keeps a live header.
    clock += 601_000;
    await oauth.refreshDue({ notes: server });
    const second = oauth.vault.get("notes")!.tokens!.access;
    expect(second).not.toBe(first);
    expect(fake.tokenRequests.at(-1)).toMatchObject({ grant_type: "refresh_token", resource: fake.mcpUrl });

    // the server drops the token: the probe refreshes once and stays connected
    fake.validAccess.delete(second!);
    expect((await oauth.probe("notes", server)).auth).toBe("connected");
    expect(oauth.vault.get("notes")!.tokens!.access).not.toBe(second);
  });

  it("marks the server expired when the refresh token is refused", async () => {
    fake = await startFakeOAuthMcp({ accessTtl: 30, refuseRefresh: true });
    const oauth = manager();
    const server = remote(fake.mcpUrl);
    await signIn(oauth, "notes", server);
    expect(await oauth.refresh("notes", server, true)).toBe(false);
    expect(oauth.status("notes", server)).toMatchObject({ auth: "expired" });
    expect(oauth.vault.get("notes")!.tokens).toBeUndefined();
    expect(oauth.withAuthHeaders({ notes: server }).notes.headers).toEqual({});
  });

  it("keeps tokens and retries on 5xx, 429 and 408; clears only on invalid_grant or invalid_client", async () => {
    const sleeps: number[] = [];
    fake = await startFakeOAuthMcp({
      accessTtl: 3_600,
      refreshAnswers: [
        { status: 503, body: { error: "temporarily_unavailable" } },
        { status: 429, body: { error: "slow_down" } },
        { status: 408, body: { error: "request_timeout" } },
        "ok",
      ],
    });
    const oauth = manager(() => FIXED_KEY, {
      sleep: async (ms) => { sleeps.push(ms); },
    });
    const server = remote(fake.mcpUrl);
    await signIn(oauth, "notes", server);
    const before = oauth.vault.get("notes")!.tokens!;
    expect(await oauth.refresh("notes", server, true)).toBe(true);
    expect(sleeps.length).toBeGreaterThanOrEqual(3);
    expect(oauth.vault.get("notes")!.tokens!.refresh).toBeTruthy();
    expect(oauth.vault.get("notes")!.tokens!.access).not.toBe(before.access);
    expect(oauth.status("notes", server)?.auth).toBe("connected");

    // A lasting grant refusal still clears the sign-in.
    fake.queueRefresh({ status: 400, body: { error: "invalid_grant", error_description: "revoked" } });
    expect(await oauth.refresh("notes", server, true)).toBe(false);
    expect(oauth.vault.get("notes")!.tokens).toBeUndefined();
    expect(oauth.status("notes", server)).toMatchObject({ auth: "expired" });

    // invalid_client also clears (bad registration), after a fresh sign-in.
    await signIn(oauth, "notes", server);
    fake.queueRefresh({ status: 401, body: { error: "invalid_client" } });
    expect(await oauth.refresh("notes", server, true)).toBe(false);
    expect(oauth.vault.get("notes")!.tokens).toBeUndefined();

    // A non-grant 400 keeps the tokens (do not wipe on a deploy-shaped glitch).
    await signIn(oauth, "notes", server);
    const kept = oauth.vault.get("notes")!.tokens!;
    fake.queueRefresh({ status: 400, body: { error: "invalid_request" } });
    expect(await oauth.refresh("notes", server, true)).toBe(false);
    expect(oauth.vault.get("notes")!.tokens?.refresh).toBe(kept.refresh);
    expect(oauth.vault.get("notes")!.expired).not.toBe(true);
  });

  it("serializes refresh across managers that share a vault file", async () => {
    fake = await startFakeOAuthMcp({
      accessTtl: Math.ceil(REFRESH_MARGIN_MS / 1000) + 600,
      refreshAnswers: [{ ok: true, delayMs: 80 }],
    });
    const a = manager();
    const server = remote(fake.mcpUrl);
    await signIn(a, "notes", server);
    const before = a.vault.get("notes")!.tokens!;
    clock += 601_000; // inside the turn margin for both
    // A second manager on the same directory (desktop + server, or two workers).
    const b = new McpOAuthManager({ vault: new McpOAuthVault(dir, () => FIXED_KEY), now: () => clock, timeoutMs: 5_000 });
    const [ra, rb] = await Promise.all([
      a.refresh("notes", server, false),
      b.refresh("notes", server, false),
    ]);
    expect(ra).toBe(true);
    expect(rb).toBe(true);
    const refreshCalls = fake.tokenRequests.filter((row) => row.grant_type === "refresh_token");
    expect(refreshCalls).toHaveLength(1);
    a.vault.invalidate();
    b.vault.invalidate();
    const afterA = a.vault.get("notes")!.tokens!;
    const afterB = b.vault.get("notes")!.tokens!;
    expect(afterA.access).toBe(afterB.access);
    expect(afterA.access).not.toBe(before.access);
    expect(afterA.refresh).toBe(afterB.refresh);
  });

  it("disconnect revokes both tokens and keeps the client", async () => {
    fake = await startFakeOAuthMcp();
    const oauth = manager();
    const server = remote(fake.mcpUrl);
    await signIn(oauth, "notes", server);
    const tokens = oauth.vault.get("notes")!.tokens!;
    await oauth.disconnect("notes", server);
    expect(fake.revoked).toEqual([tokens.refresh, tokens.access]);
    expect(oauth.status("notes", server)).toMatchObject({ auth: "required" });
    expect(oauth.vault.get("notes")!.client?.id).toBe("client-1");
    await oauth.forget("notes");
    expect(oauth.vault.get("notes")).toBeUndefined();
  });
});

describe("several accounts on one server", () => {
  async function addAccount(oauth: McpOAuthManager, server: RemoteMcpSpec, account: string, label?: string) {
    const { authorizationUrl } = await oauth.start("notes", server, { redirectUri: REDIRECT, account, ...(label ? { label } : {}) });
    const back = await fake!.authorize(authorizationUrl);
    return oauth.callback(back.searchParams);
  }

  it("keeps each account's tokens apart and mounts the one a bot picks", async () => {
    fake = await startFakeOAuthMcp();
    const oauth = manager();
    const server = remote(fake.mcpUrl);
    expect(await signIn(oauth, "notes", server)).toEqual({ ok: true, name: "notes" });
    expect(await addAccount(oauth, server, "acct-work01", "Work")).toEqual({ ok: true, name: "notes", account: "acct-work01" });
    const first = oauth.vault.get("notes")!;
    const work = oauth.vault.get("notes", "acct-work01")!;
    expect(work).toMatchObject({ label: "Work", issuer: first.issuer, client: { id: first.client!.id } });
    expect(work.tokens!.access).not.toBe(first.tokens!.access);
    expect(oauth.accounts("notes", server)).toEqual([
      expect.objectContaining({ id: "default", auth: "connected" }),
      expect.objectContaining({ id: "acct-work01", label: "Work", auth: "connected" }),
    ]);

    const header = (choice?: string) => oauth.withAuthHeaders({ notes: server }, () => choice).notes.headers.Authorization;
    expect(header()).toBe(`Bearer ${first.tokens!.access}`);
    expect(header("acct-work01")).toBe(`Bearer ${work.tokens!.access}`);
    // an account that is gone sends nothing, never the default one's token
    expect(header("acct-gone00")).toBeUndefined();

    await oauth.disconnect("notes", server, undefined, "acct-work01");
    expect(oauth.vault.accounts("notes")).toEqual(["default"]);
    expect(oauth.status("notes", server)).toMatchObject({ auth: "connected" });
    await oauth.forget("notes");
    expect(oauth.vault.names()).toEqual([]);
  });

  it("refreshes the account a turn uses, and only that one", async () => {
    fake = await startFakeOAuthMcp({ accessTtl: Math.ceil(REFRESH_MARGIN_MS / 1000) + 600 });
    const oauth = manager();
    const server = remote(fake.mcpUrl);
    await signIn(oauth, "notes", server);
    await addAccount(oauth, server, "acct-work01");
    const before = { first: oauth.vault.get("notes")!.tokens!.access, work: oauth.vault.get("notes", "acct-work01")!.tokens!.access };
    clock += 601_000;
    await oauth.refreshDue({ notes: server }, undefined, () => "acct-work01");
    expect(oauth.vault.get("notes")!.tokens!.access).toBe(before.first);
    expect(oauth.vault.get("notes", "acct-work01")!.tokens!.access).not.toBe(before.work);
  });

  it("caps the accounts of a server", async () => {
    fake = await startFakeOAuthMcp();
    const oauth = manager();
    const server = remote(fake.mcpUrl);
    await oauth.probe("notes", server);
    // the default account counts
    for (let index = 0; index < MAX_MCP_ACCOUNTS - 1; index++) {
      await oauth.start("notes", server, { redirectUri: REDIRECT, account: `acct-extra${index}` });
    }
    await expect(oauth.start("notes", server, { redirectUri: REDIRECT, account: "acct-onemore" })).rejects.toMatchObject({ code: "too_many_accounts" });
    expect(oauth.pendingFor("notes", "acct-extra3")).toBe(true);
    expect(oauth.pendingFor("notes", "acct-onemore")).toBe(false);
  });

  it("reads a bot's account choices: null clears, default is left out, junk is refused", () => {
    expect(parseMcpAccountChoices(null)).toEqual({ ok: true, choices: undefined });
    expect(parseMcpAccountChoices({ notes: "acct-work01", linear: "default" })).toEqual({ ok: true, choices: { notes: "acct-work01" } });
    expect(parseMcpAccountChoices({ linear: "default" })).toEqual({ ok: true, choices: undefined });
    for (const bad of [[], "acct-work01", { notes: "work" }, { Notes: "acct-work01" }, { notes: 3 }]) {
      expect(parseMcpAccountChoices(bad).ok, JSON.stringify(bad)).toBe(false);
    }
  });

  it("reads a vault from before accounts as each server's default account", () => {
    const record = { serverUrl: "https://mcp.example.com/mcp", resource: "https://mcp.example.com/mcp", issuer: "https://auth.example.com", authorizationEndpoint: "https://auth.example.com/authorize", tokenEndpoint: "https://auth.example.com/token", tokens: { access: "fake-access" } };
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", FIXED_KEY.kind === "key" ? FIXED_KEY.key : Buffer.alloc(32), iv);
    cipher.setAAD(Buffer.from("pulsa-bot mcp-oauth v1"));
    const data = Buffer.concat([cipher.update(JSON.stringify({ version: 1, records: { notes: record } }), "utf8"), cipher.final()]);
    writeFileSync(join(dir, "mcp-oauth.enc"), JSON.stringify({ v: 1, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64") }));

    const vault = new McpOAuthVault(dir, () => FIXED_KEY);
    expect(vault.get("notes")).toEqual(record);
    expect(vault.get("notes", DEFAULT_MCP_ACCOUNT)).toEqual(record);
    expect(vault.accounts("notes")).toEqual(["default"]);
    // written back in the new shape, still readable by a fresh vault
    const again = new McpOAuthVault(dir, () => FIXED_KEY);
    expect(again.get("notes")).toEqual(record);
    const oauth = new McpOAuthManager({ vault: again, now: () => clock });
    expect(oauth.withAuthHeaders({ notes: remote(record.serverUrl) }).notes.headers).toEqual({ Authorization: "Bearer fake-access" });
  });
});

describe("vault", () => {
  it("keeps tokens encrypted at rest, 0600, and unreadable with another key", async () => {
    fake = await startFakeOAuthMcp();
    const oauth = manager();
    await signIn(oauth, "notes", remote(fake.mcpUrl));
    const tokens = oauth.vault.get("notes")!.tokens!;
    const file = join(dir, "mcp-oauth.enc");
    const onDisk = readFileSync(file, "utf8");
    for (const secret of [tokens.access!, tokens.refresh!, "client-1", fake.issuer]) expect(onDisk).not.toContain(secret);
    if (process.platform !== "win32") expect(statSync(file).mode & 0o777).toBe(0o600);

    const other = new McpOAuthVault(dir, () => ({ kind: "key", key: Buffer.alloc(32, 9) }));
    expect(other.get("notes")).toBeUndefined();
    expect(other.unavailableReason()).toMatch(/could not be decrypted/);
    // a wrong key never overwrites what is saved
    expect(() => other.set("x", undefined)).toThrow();
    expect(readFileSync(file, "utf8")).toBe(onDisk);
  });

  it("uses the desktop key, refuses to invent one under the desktop, and makes a 0600 key file otherwise", () => {
    const hex = "ab".repeat(32);
    expect(resolveVaultKey(dir, { SAGAX_MCP_OAUTH_KEY: hex })).toEqual({ kind: "key", key: Buffer.from(hex, "hex") });
    expect(resolveVaultKey(dir, { SAGAX_DESKTOP_PARENT: "1" })).toMatchObject({ kind: "unavailable" });
    const made = resolveVaultKey(dir, {});
    expect(made.kind).toBe("key");
    expect(resolveVaultKey(dir, {})).toEqual(made);
    if (process.platform !== "win32") expect(statSync(join(dir, "mcp-oauth.key")).mode & 0o777).toBe(0o600);
  });

  it("reports an unavailable store as an error and injects nothing", () => {
    const oauth = manager(() => ({ kind: "unavailable", reason: "The encrypted credential store could not be read on this launch." }));
    expect(oauth.status("notes", remote("https://mcp.example.com/mcp"))).toMatchObject({ auth: "error" });
    const servers = { notes: remote("https://mcp.example.com/mcp") };
    expect(oauth.withAuthHeaders(servers)).toBe(servers);
  });
});

describe("a phone's sign-in sheet", () => {
  it("ends on the app address the sign-in started with, with the outcome and never the code", async () => {
    fake = await startFakeOAuthMcp();
    const oauth = manager();
    await oauth.probe("notes", remote(fake.mcpUrl));
    const { authorizationUrl } = await oauth.start("notes", remote(fake.mcpUrl), { redirectUri: REDIRECT, returnTo: "sagax://oauth-done" });
    const back = await fake.authorize(authorizationUrl);
    const result = await oauth.callback(back.searchParams);
    expect(result).toEqual({ ok: true, name: "notes", returnTo: "sagax://oauth-done" });
    const location = phoneReturnLocation(result)!;
    expect(location).toBe("sagax://oauth-done?status=ok&server=notes");
    expect(location).not.toContain(back.searchParams.get("code")!);
    expect(phoneReturnLocation({ ok: false, name: "notes", error: "The sign-in was cancelled.", returnTo: "sagax://oauth-done" }))
      .toBe("sagax://oauth-done?status=error&server=notes&error=The+sign-in+was+cancelled.");
    // a desktop sign-in keeps its page
    expect(phoneReturnLocation({ ok: true, name: "notes" })).toBeNull();
  });

  it("returns only to listed app addresses", () => {
    expect(phoneOAuthReturns({})).toEqual(["sagax://oauth-done"]);
    expect(phoneOAuthReturns({ SAGAX_PHONE_OAUTH_RETURNS: "https://app.example.test/oauth-done, javascript:alert(1), VBScript:msgbox(1), blob:https://evil.test/x, data:text/html,x, http://evil.test/x, sagaxbeta://done" }))
      .toEqual(["sagax://oauth-done", "https://app.example.test/oauth-done", "sagaxbeta://done"]);
  });
});

describe("routes", () => {
  it("keeps every sign-in route owner/admin only", () => {
    for (const action of ["start", "disconnect", "probe"]) expect(requiredScope("POST", `/api/mcp/servers/notes/oauth/${action}`)).toBe("admin");
    expect(requiredScope("GET", "/api/mcp/servers/notes/oauth/status")).toBe("admin");
  });
});

describe("callback page", () => {
  it("escapes the message and carries no secret", () => {
    const page = callbackPage({ ok: false, name: "notes", error: "<script>alert(1)</script>" }, "en-US");
    expect(page.html).not.toContain("<script>alert(1)</script>");
    expect(page.html).toContain("&lt;script&gt;");
    expect(page.html).toContain(`nonce="${page.nonce}"`);
    const done = callbackPage({ ok: true, name: "notes" }, "fr-CA,fr;q=0.9");
    expect(done.html).toContain("Connexion terminée, vous pouvez fermer cet onglet.");
    expect(done.html).toContain("window.close()");
    expect(callbackPage({ ok: true, name: "notes" }, "en").html).toContain("Sign-in complete. You can close this tab.");
  });
});
