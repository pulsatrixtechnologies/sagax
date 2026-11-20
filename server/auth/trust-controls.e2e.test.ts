// Actual authenticated HTTP and local connector relay, all under the shared
// disposable launcher. Synthetic sessions, local stub, fake engine only.
import { spawn, type ChildProcess } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, expect, it } from "vitest";
import { launchVerificationServer, verificationServerEnvironment, type VerificationServer } from "../../scripts/control-omb.ts";
import { SessionRegistry } from "./sessions.ts";
import { waitForExit } from "../testing/cleanup.ts";

const key = "isolated-trust-capability";
let fixture: VerificationServer;
let child: ChildProcess;
let broker: Server;
let admin: string;
let member: string;
let fullBot: any;
let brokerOrigin = "";
const relayed: unknown[] = [];
const evidence: unknown[] = [];
let blockRelay: (() => void) | undefined;
let blockSession: (() => void) | undefined;
const api = async (method: string, path: string, body?: unknown, token = admin) => {
  const response = await fetch(fixture.info.url + path, {
    method, headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20_000),
  });
  const result = { status: response.status, body: await response.json() as any };
  evidence.push({ method, path, result });
  return result;
};
const bot = async (name: string) => {
  const created = await api("POST", "/api/bots", { name });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  return created.body.bot;
};
const mint = async (botId: string, threadId: string, kind = "connectors") => {
  const response = await fetch(fixture.info.url + "/api/testing/internal-capability", {
    method: "POST", headers: { "content-type": "application/json", "x-openmausbot-test-capability": key },
    body: JSON.stringify({ botId, threadId, kind }),
  });
  expect(response.status).toBe(201);
  return (await response.json() as any).token as string;
};
const relay = (token: string, name: string, args: unknown = {}) => api("POST", "/api/internal/connectors/mcp",
  { jsonrpc: "2.0", id: Math.random(), method: "tools/call", params: { name, arguments: args } }, token);
const cards = async (thread: string) => (await api("GET", `/api/threads/${thread}/messages?limit=100`)).body.messages as any[];
beforeAll(async () => {
  broker = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : {};
    res.setHeader("content-type", "application/json");
    if (req.url === "/v1/connectors/connected") return res.end(JSON.stringify({ services: { gmail: { connected: true }, slack: { connected: true } } }));
    if (req.url === "/api/tool_router/session/fixture-session") {
      if (blockSession) {
        await new Promise<void>(resolve => { blockSession = resolve; });
      }
      return res.end(JSON.stringify({ session_id: "fixture-session", mcp: { type: "http", url: brokerOrigin + "/mcp" },
        config: { user_id: "fixture-user", multi_account: { enable: true, max_accounts_per_toolkit: 5, require_explicit_selection: true } } }));
    }
    if (req.url === "/mcp") {
      relayed.push(body);
      if (blockRelay) {
        await new Promise<void>(resolve => { blockRelay = resolve; });
      }
      return res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { content: [{ type: "text", text: "relay-ok" }] } }));
    }
    return res.end(JSON.stringify({ items: [{ slug: "gmail", connected_account: { id: "fixture-account", status: "ACTIVE" } }] }));
  });
  await new Promise<void>(resolve => broker.listen(0, "127.0.0.1", resolve));
  const address = broker.address() as { port: number };
  brokerOrigin = `http://127.0.0.1:${address.port}`;
  fixture = await launchVerificationServer();
  // Seed an already-granted Full task in this fixture only. The public API
  // correctly refuses to create operator grants outside the desktop channel.
  const created = await fetch(fixture.info.url + "/api/bots", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Existing Full grant" }) });
  expect(created.status).toBe(201);
  fullBot = (await created.json() as any).bot;
  await waitForExit(fixture.child, { signal: "SIGTERM" });
  const botsFile = join(fixture.info.dataDir, "bots.json");
  const bots = JSON.parse(readFileSync(botsFile, "utf8"));
  const saved = bots.find((row: any) => row.id === fullBot.id);
  saved.approvalMode = "full";
  saved.autoApprove = false;
  for (const task of saved.tasks) { task.approvalMode = "full"; task.autoApprove = false; }
  writeFileSync(botsFile, JSON.stringify(bots));
  const configFile = join(fixture.info.dataDir, "config.json");
  const config = JSON.parse(readFileSync(configFile, "utf8"));
  config.signIn = { admins: ["admin@fixture.test"], members: ["member@fixture.test"] };
  config.composio = { apiKey: "ak_isolated_fixture", userId: "fixture-user", sessionId: "fixture-session" };
  config.instances.activityFixture = { ...config.instances.claude, displayName: "Exact task activity fixture",
    environment: { FAKE_CLAUDE_MODE: "hang", FAKE_CLAUDE_RELEASE: join(fixture.info.dataDir, "activity-release") } };
  writeFileSync(configFile, JSON.stringify(config));
  const sessions = new SessionRegistry({ file: join(fixture.info.dataDir, "sessions.json"),
    emailScopes: email => email === "admin@fixture.test" ? ["admin", "client"] : ["client"] });
  admin = sessions.issue({ label: "isolated admin", email: "admin@fixture.test", scopes: ["admin", "client"] }).token;
  member = sessions.issue({ label: "isolated member", email: "member@fixture.test", scopes: ["client"] }).token;
  sessions.close();
  const log = openSync(fixture.info.logPath, "a", 0o600);
  child = spawn(process.execPath, ["--experimental-strip-types", fileURLToPath(new URL("../index.ts", import.meta.url))], {
    cwd: fileURLToPath(new URL("../..", import.meta.url)),
    env: { ...verificationServerEnvironment({}, fixture.info.dataDir, Number(new URL(fixture.info.url).port)),
      SAGAX_TEST_INTERNAL_CAPABILITY_KEY: key, SAGAX_COMPOSIO_API: brokerOrigin + "/api", SAGAX_COMPOSIO_TOOLKITS_API: brokerOrigin + "/api" },
    stdio: ["ignore", log, log],
  });
  closeSync(log);
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try { if ((await fetch(fixture.info.url + "/api/health")).ok) return; } catch { /* starting */ }
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error("isolated trust server did not start");
}, 40_000);

afterAll(async () => {
  blockRelay?.();
  blockSession?.();
  const evidencePath = fixture.info.logPath + ".trust-controls.json";
  writeFileSync(evidencePath, JSON.stringify({ fixture: fixture.info, evidence, relayed }, null, 2));
  await waitForExit(child, { signal: "SIGTERM" });
  await fixture.close();
  await new Promise<void>(resolve => broker.close(() => resolve()));
  console.info(JSON.stringify({ logPath: fixture.info.logPath, evidencePath, fixtureRemoved: !existsSync(fixture.info.dataDir) }));
});

// Sagax: a bot a member cannot see answers 404 (its existence is not named); 403 and 404 both refuse.
it("keeps activity and policy changes admin-only; a member's team memory is their own", async () => {
  const b = await bot("Trust authority");
  expect((await api("GET", `/api/bots/${b.id}/activity`)).status).toBe(200);
  expect((await api("GET", `/api/bots/${b.id}/activity`, undefined, member)).status).toBeOneOf([403, 404]);
  // #4460: on a workspace several people use, a member's team memory is
  // their own: they manage it without an admin, and it never reaches anyone else's
  expect((await api("GET", "/api/team-memory?section=", undefined, member)).status).toBe(200);
  expect((await api("POST", "/api/team-memory?section=", { kind: "term", name: "Own entry", detail: "the member's own" }, member)).status).toBe(201);
  expect(JSON.stringify((await api("GET", "/api/team-memory?section=")).body)).not.toContain("Own entry");
  expect((await api("PATCH", "/api/team-memory/fixture?section=", { detail: "not admin" }, member)).status).toBeOneOf([403, 404]);
  expect((await api("DELETE", "/api/team-memory/fixture?section=", undefined, member)).status).toBeOneOf([403, 404]);
  for (const patch of [{ outbound: { policy: "allow", dailyCap: 100 } }, { connectorScopes: null }, { fallback: [] }]) {
    expect((await api("PATCH", `/api/bots/${b.id}`, patch, member)).status).toBeOneOf([403, 404]);
  }
  expect((await api("PATCH", `/api/bots/${b.id}`, { fallback: [{ instanceId: "claude", model: " " }] })).status).toBe(400);
});

// omb #2894: Full access sends without a card. Skipped here because Sagax
// keeps a bot private to its owner on a shared workspace: the seeded bot
// (created over loopback, owned by this computer's person) is not in the
// email admin's fleet, so this upstream scenario does not apply as written.
// Behavior is covered by autoVerdict("full", … outbound) → full-access.
it.skip("sends in Full without a card, and still refuses an app outside the bot's scope", async () => {
  const b = fullBot;
  const fleet = await api("GET", "/api/bots");
  expect(fleet.body.bots.find((row: any) => row.id === b.id).approvalMode).toBe("full");
  const token = await mint(b.id, b.threadId);
  const before = relayed.length;
  expect((await relay(token, "GMAIL_SEND_EMAIL", { to: "first@fixture.test" })).body.result.isError).not.toBe(true);
  expect((await relay(token, "COMPOSIO_REMOTE_WORKBENCH", { code_to_execute: "print(1)" })).body.result.isError).not.toBe(true);
  expect(relayed).toHaveLength(before + 2);
  expect((await cards(b.threadId)).some((row: any) => row.card?.outboundRequest)).toBe(false);
  await api("PATCH", `/api/bots/${b.id}`, { connectorScopes: { apps: { gmail: "read" } } });
  expect((await relay(token, "GMAIL_SEND_EMAIL")).body.result.isError).toBe(true);
  expect(relayed).toHaveLength(before + 2);
});

// #4439: a bot saves team memory itself, at once, and raises no card
it("saves a bot's entry at once, replacing the older one, and still refuses restricted memory", async () => {
  const b = await bot("Team facts");
  const token = await mint(b.id, b.threadId, "agents");
  const save = (detail: string) => api("POST", "/api/internal/team-memory",
    { fromBotId: b.id, fromThreadId: b.threadId, kind: "person", name: "Alex", detail }, token);
  const first = await save("original");
  expect(first.status, JSON.stringify(first.body)).toBe(201);
  expect(first.body.status).toBe("saved");
  const replacement = await save("replacement");
  expect(replacement.body).toMatchObject({ status: "saved", replaced: true });
  const entries = (await api("GET", "/api/team-memory?section=")).body.entries.filter((entry: any) => entry.name === "Alex");
  expect(entries.map((entry: any) => [entry.status, entry.detail])).toEqual([["accepted", "replacement"]]);
  // no card for a member nor the owner
  const thread = (await api("GET", `/api/threads/${b.threadId}/messages`)).body.messages as any[];
  expect(thread.some((m) => m.card?.teamMemoryRequest)).toBe(false);
  // a bot seen by some people only cannot write memory every bot of the person reads
  await api("PATCH", `/api/bots/${b.id}`, { visibility: "admins" });
  expect((await save("private")).status).toBe(403);
  const publicBot = await bot("Public room participant");
  await api("PATCH", `/api/bots/${b.id}`, { visibility: null });
  const room = await api("POST", "/api/groups", { name: "Restricted room", memberIds: [publicBot.id, b.id] });
  expect(room.status, JSON.stringify(room.body)).toBe(201);
  const roomThread = room.body.group.threadId;
  await api("PATCH", `/api/bots/${b.id}`, { visibility: "admins" });
  const roomToken = await mint(publicBot.id, roomThread, "agents");
  expect((await api("POST", "/api/internal/team-memory", { fromBotId: publicBot.id, fromThreadId: roomThread,
    kind: "term", name: "Private room term", detail: "cannot share with sibling bots" }, roomToken)).status).toBe(403);
  // a person's own entry
  expect((await api("POST", "/api/team-memory?section=", { kind: "term", name: "Human", detail: "added by the person" })).status).toBe(201);
});

it("keeps an account's credential directory while a fallback chain names it, and its removal takes it out of the chain", async () => {
  const account = await api("POST", "/api/instances/claude-accounts", { displayName: "Fallback fixture account" });
  expect(account.status, JSON.stringify(account.body)).toBe(201);
  const instanceId = account.body.instanceId;
  const b = await bot("Referenced fallback");
  expect((await api("PATCH", `/api/bots/${b.id}`, { fallback: [{ instanceId, model: "claude-sonnet-5" }] })).status).toBe(200);
  const before = (await api("GET", "/api/bots")).body.bots.find((entry: any) => entry.id === b.id);
  expect(before.fallback).toEqual([{ instanceId, model: "claude-sonnet-5" }]);
  // the folder of credentials never changes under a bot that may fall back on it
  expect((await api("PATCH", `/api/instances/${instanceId}`, { configDir: join(fixture.info.dataDir, "synthetic-account-directory") })).status).toBe(409);
  // #4918 (2026-11-18): Remove moves the account's bots instead of refusing;
  // the chain loses the removed account, it never points at it afterwards
  expect((await api("DELETE", `/api/instances/${instanceId}`)).status).toBe(200);
  const after = (await api("GET", "/api/bots")).body.bots.find((entry: any) => entry.id === b.id);
  expect(after.fallback ?? []).not.toContainEqual(expect.objectContaining({ instanceId }));
  expect(after.modelSelection).toEqual(before.modelSelection);
});
