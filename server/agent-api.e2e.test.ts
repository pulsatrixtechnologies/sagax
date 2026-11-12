// The agent-to-agent API end to end against the real harness server: bot A
// sends a prompt to bot B with send_prompt (async), waits with await_turn,
// reads B's latest page, and the guarantees around it hold (hidden thread,
// isolation, one hop, audit without text).
//
// Reach (owner decision of 2026-11-09, #3264): a bot reaches every visible
// bot of its own person, whatever the section, and never a bot of another
// person. The first block runs on a solo server (one person: a bot in another
// section is reached); the second on an organization server with two
// people, whose bots never reach each other (#3538).
import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { removeTempDir, waitForExit } from "./testing/cleanup.ts";
import { startFakeOidcProvider, type FakeOidcProvider, type FakeOidcUser } from "./testing/fake-oidc-provider.ts";
import { hostTimeout } from "./testing/host-timeout.ts";
import { freePortBlock } from "./testing/ports.ts";
import { waitForServerReady } from "./testing/server-ready.ts";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(SERVER_DIR, "..");
const FAKE_CLAUDE = join(SERVER_DIR, "testing", "fake-claude-cli.ts");
const TEST_CAPABILITY_KEY = "agent-api-fixture-capability-key-0001";
const SERVER_START_MS = 180_000;

let child: ChildProcess;
let home = "";
let data = "";
let base = "";
let stderr = "";

const api = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; body: any }> => {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { ...(body ? { "content-type": "application/json" } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: await response.json() };
};

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), "omb-agent-api-"));
  data = join(home, ".sagax");
  const staticDir = join(home, "static");
  mkdirSync(data, { recursive: true });
  mkdirSync(staticDir, { recursive: true });
  writeFileSync(join(staticDir, "index.html"), "<!doctype html><title>agent API test</title>");
  writeFileSync(join(data, "config.json"), JSON.stringify({
    instances: {
      plain: { driver: "claudeAgent", displayName: "Plain fixture", environment: { FAKE_CLAUDE_MODE: "happy", FAKE_CLAUDE_DUMP: join(home, "turn-dump.json") }, config: { cli: FAKE_CLAUDE } },
    },
  }));
  const port = await freePortBlock([0, 1]);
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, [join(SERVER_DIR, "index.ts")], {
    cwd: ROOT,
    env: {
      ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
      HOME: home,
      USERPROFILE: home,
      SAGAX_PORT: String(port),
      SAGAX_WEBHOOK_PORT: String(port + 1),
      SAGAX_STATIC_DIR: staticDir,
      SAGAX_TEST_INTERNAL_CAPABILITY_KEY: TEST_CAPABILITY_KEY,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stderr!.on("data", (chunk) => (stderr += chunk));
  // The shared readiness wait returns as soon as the server answers. Its
  // margin holds a cold start on a saturated machine: 20 seconds here failed
  // a tag push three times (#3684).
  await waitForServerReady(child, base, () => stderr, undefined, SERVER_START_MS);
}, hostTimeout(SERVER_START_MS + 30_000));

afterAll(async () => {
  if (child) await waitForExit(child, { signal: "SIGTERM" });
  if (home) await removeTempDir(home);
});

const createBot = async (name: string, description: string) =>
  (await api("POST", "/api/bots", { name, description, modelSelection: { instanceId: "plain", model: "claude-sonnet-5" }, requireAvailableModel: true })).body.bot;

const botState = async (botId: string) => (await api("GET", "/api/bots")).body.bots.find((bot: { id: string }) => bot.id === botId);

const mint = async (botId: string, threadId: string, depth = 0): Promise<string> => {
  const minted = await api("POST", "/api/testing/internal-capability", { botId, threadId, kind: "agents", depth }, { "x-openmausbot-test-capability": TEST_CAPABILITY_KEY });
  expect(minted.status).toBe(201);
  return String(minted.body.token);
};

const tool = (token: string, name: string, args: unknown) =>
  api("POST", `/api/internal/agent-api/${name}`, args, { authorization: `Bearer ${token}` });

describe("agent-to-agent API (real server)", () => {
  it("A sends async to B, awaits the turn, reads B's latest page; B's thread is hidden", async () => {
    const seeded = (await api("GET", "/api/bots?messages=0")).body.bots[0];
    await api("PATCH", `/api/bots/${seeded.id}`, { hidden: true });
    const alpha = await createBot("Alpha", "Coordinates the team");
    const beta = await createBot("Beta Dispatch", "Schedules technicians");
    // a bot of the same person in another section: reached like any other
    const outsider = await createBot("Outsider", "Another team");
    expect((await api("PATCH", `/api/bots/${outsider.id}`, { section: "Elsewhere" })).status).toBe(200);
    expect((await api("POST", `/api/bots/${alpha.id}/messages`, { text: "Warm up" })).status).toBe(202);
    await expect.poll(async () => (await botState(alpha.id))?.busy, { timeout: 15_000 }).toBe(false);
    // the real harness mounts the tools in an ordinary direct chat (production
    // 2026-10-12: the room-coordination flag had kept them off everywhere)
    const dump = JSON.parse(readFileSync(join(home, "turn-dump.json"), "utf8"));
    expect(dump.mcpConfig?.mcpServers?.agents?.env?.SAGAX_AGENT_API).toBe("1");
    const token = await mint(alpha.id, alpha.threadId);

    const listed = await tool(token, "list_agents", {});
    expect(listed.status).toBe(200);
    const ids = listed.body.agents.map((agent: { id: string }) => agent.id);
    expect(ids).toContain(beta.id);
    expect(ids).not.toContain(alpha.id);
    expect(ids).toContain(outsider.id);
    expect(listed.body.agents.find((agent: { id: string }) => agent.id === beta.id)).toMatchObject({ name: "Beta Dispatch", status: "idle" });

    const found = await tool(token, "find_agents", { query: "dispatch", status: "idle" });
    expect(found.body.agents.map((agent: { id: string }) => agent.id)).toEqual([beta.id]);

    const sent = await tool(token, "send_prompt", { agent_id: beta.id, prompt: "Please confirm the Monday schedule", mode: "async" });
    expect(sent.status).toBe(200);
    expect(sent.body).toMatchObject({ accepted: true, mode: "async", agent_id: beta.id });
    const handle = String(sent.body.handle);
    const threadId = String(sent.body.thread_id);

    const awaited = await tool(token, "await_turn", { agent_id: beta.id, handle, timeout_ms: 30_000 });
    expect(awaited.status).toBe(200);
    expect(awaited.body.finished).toBe(true);
    expect(typeof awaited.body.reply).toBe("string");

    // async notifies at turn end: B's reply is posted in A's conversation and
    // A is woken (a new turn there ends the old capability), so mint again.
    await expect.poll(async () => JSON.stringify((await botState(alpha.id))?.messages ?? []), { timeout: 15_000 }).toContain("send_prompt");
    await expect.poll(async () => (await botState(alpha.id))?.busy, { timeout: 15_000 }).toBe(false);
    const fresh = await mint(alpha.id, alpha.threadId);
    const latest = await tool(fresh, "read_latest_page", { agent_id: beta.id, limit: 10 });
    expect(latest.status).toBe(200);
    const texts = latest.body.entries.map((entry: { role: string; text: string }) => `${entry.role}:${entry.text}`);
    // 2026-10-26 (#1207): send_prompt lands in the bot's single conversation,
    // so the bot's own greeting can precede the prompt.
    expect(texts).toContain("user:Please confirm the Monday schedule");
    expect(latest.body.entries.every((entry: { thread_id: string }) => entry.thread_id === threadId)).toBe(true);
    if (awaited.body.reply) expect(texts).toContain(`agent:${awaited.body.reply}`);

    const withThreads = await tool(fresh, "read_latest_page_with_threads", { agent_id: beta.id, limit: 1 });
    expect(withThreads.body.threads).toEqual(expect.arrayContaining([expect.objectContaining({ thread_id: threadId, hidden: false, status: "idle" })]));
    const cold = await tool(fresh, "read_transcript_cold", { agent_id: beta.id });
    expect(cold.body.entries.length).toBe(latest.body.entries.length);

    // 2026-10-26 (#1207): no hidden thread; the prompt is in B's one chat
    // (its main thread), where the person can see and close it.
    const betaNow = await botState(beta.id);
    expect(JSON.stringify(betaNow.messages ?? [])).toContain("Monday schedule");
    expect(betaNow.threadId).toBe(threadId);

    // a non-Primary bot holds no create scope
    const create = await tool(fresh, "create_agent", { name: "Gamma" });
    expect(create.status).toBe(403);

    // the same person's bot in another section can be sent a prompt
    const crossSection = await tool(fresh, "send_prompt", { agent_id: outsider.id, prompt: "Please read the other queue", mode: "async" });
    expect(crossSection.status).toBe(200);
    expect(crossSection.body).toMatchObject({ accepted: true, mode: "async", agent_id: outsider.id });

    // one hop: a turn another agent started cannot prompt further (minting
    // a new capability for the thread retires the previous one)
    const deepToken = await mint(alpha.id, alpha.threadId, 1);
    const deep = await tool(deepToken, "send_prompt", { agent_id: beta.id, prompt: "pass it on" });
    expect(deep.status).toBe(409);
    expect(deep.body.code).toBe("too_deep");

    // every call audited, never the prompt text (the log is appended
    // asynchronously, so read it until the last calls landed). The rows
    // are sealed on disk (#1263), so they are read back the way the
    // Activity view reads them: through the admin-activity route.
    const readRows = async (): Promise<any[]> => {
      const activity = await api("GET", "/api/admin-activity?what=all&limit=5000");
      if (activity.status !== 200) return [];
      return (activity.body.entries as any[]).filter((row) => String(row.action).startsWith("agents."));
    };
    const expected = ["agents.list_agents", "agents.find_agents", "agents.send_prompt", "agents.await_turn", "agents.read_latest_page", "agents.read_transcript_cold", "agents.create_agent"];
    await expect.poll(async () => (await readRows()).map((row) => row.action), { timeout: 15_000 }).toEqual(expect.arrayContaining(expected));
    const agentRows = await readRows();
    // (newest first: the send to the bot in another section is listed too)
    expect(agentRows.filter((row) => row.action === "agents.send_prompt" && row.after.outcome === "ok").map((row) => row.after))
      .toEqual(expect.arrayContaining([expect.objectContaining({ mode: "async", callerBotId: alpha.id, threadId })]));
    expect(JSON.stringify(agentRows)).not.toContain("Monday schedule");
    // nor on disk, sealed or not
    const dir = join(data, "admin-activity");
    for (const file of readdirSync(dir)) expect(readFileSync(join(dir, file), "utf8")).not.toContain("Monday schedule");
  }, 90_000);
});

// An organization server with two people (fake sign-in provider): each
// person's bots reach each other across sections, and never the other
// person's bot, whatever the call.
const ORG_CAPABILITY_KEY = "agent-api-org-fixture-capability-0001";
const ALEX: FakeOidcUser = { sub: "01J9AGAPIALEX0000000000AX", name: "Alex", preferred_username: "alex", role: "employee", teams: [] };
const BLAIR: FakeOidcUser = { sub: "01J9AGAPIBLAIR000000000BL", name: "Blair", preferred_username: "blair", role: "employee", teams: [] };

describe.skipIf(process.platform === "win32")("agent-to-agent API between people (organization server)", () => {
  let org: ChildProcess;
  let orgHome = "";
  let orgBase = "";
  let orgLog = "";
  let idp: FakeOidcProvider;

  const orgApi = async (method: string, path: string, cookie?: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; body: any }> => {
    const response = await fetch(`${orgBase}${path}`, {
      method,
      headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let parsed: any = {};
    try { parsed = JSON.parse(text); } catch { /* not JSON */ }
    return { status: response.status, body: parsed };
  };
  const signIn = async (user: FakeOidcUser): Promise<string> => {
    idp.user = { ...user };
    const pair = (setCookie: string) => setCookie.split(";")[0]!;
    const start = await fetch(`${orgBase}/auth/oidc/start`, { redirect: "manual" });
    const binding = pair(start.headers.getSetCookie().find((c) => c.includes("_oidc="))!);
    const authorize = await fetch(start.headers.get("location")!, { redirect: "manual" });
    const callback = await fetch(authorize.headers.get("location")!, { redirect: "manual", headers: { cookie: binding } });
    const session = callback.headers.getSetCookie().find((c) => c.startsWith("omb_session_") && !c.includes("_oidc="));
    expect(callback.headers.get("location"), orgLog.slice(-2000)).toBe("/");
    return pair(session!);
  };
  const createAs = async (cookie: string, name: string, description: string) => {
    let created = await orgApi("POST", "/api/bots", cookie, { name, description });
    // the directory read that grants the engine may land just after boot
    for (let tries = 0; created.status !== 201 && tries < 100; tries += 1) {
      await new Promise((resolve) => setTimeout(resolve, 150));
      created = await orgApi("POST", "/api/bots", cookie, { name, description });
    }
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    return created.body.bot as { id: string; threadId: string };
  };
  const orgTool = (token: string, name: string, args: unknown) =>
    orgApi("POST", `/api/internal/agent-api/${name}`, undefined, args, { authorization: `Bearer ${token}` });

  beforeAll(async () => {
    chmodSync(FAKE_CLAUDE, 0o755);
    idp = await startFakeOidcProvider({ user: ALEX });
    idp.directoryPeople = [ALEX, BLAIR].map((user) => ({ ...idp.personOf(user), sagax_server_engines: ["claude"] }));
    const port = await freePortBlock([0, 1]);
    orgBase = `http://127.0.0.1:${port}`;
    orgHome = mkdtempSync(join(tmpdir(), "omb-agent-api-org-"));
    const orgData = join(orgHome, ".sagax");
    mkdirSync(orgData, { recursive: true });
    mkdirSync(join(orgHome, "link"), { recursive: true, mode: 0o750 });
    writeFileSync(join(orgHome, "link", "pulsabot.json"), JSON.stringify({
      version: 1, issuer: idp.issuer, client_id: "pulsa-bot", server_id: idp.serverId, origin: orgBase, link_token: idp.linkToken,
    }), { mode: 0o640 });
    writeFileSync(join(orgData, "config.json"), JSON.stringify({
      instances: { claude: { driver: "claudeAgent", environment: { FAKE_CLAUDE_MODE: "happy" }, config: { cli: FAKE_CLAUDE, fullAuto: true } } },
    }));
    org = spawn(process.execPath, [join(SERVER_DIR, "index.ts")], {
      cwd: ROOT,
      env: {
        PATH: process.env.PATH ?? "",
        HOME: orgHome, USERPROFILE: orgHome, SAGAX_PORT: String(port), SAGAX_WEBHOOK_PORT: String(port + 1),
        SAGAX_IDENTITY: "perspicax",
        SAGAX_PERSPICAX_ISSUER: idp.issuer,
        SAGAX_PUBLIC_URL: orgBase,
        SAGAX_PERSPICAX_LINK_FILE: join(orgHome, "link", "pulsabot.json"),
        SAGAX_PERSPICAX_DIRECTORY_SECONDS: "3600",
        SAGAX_ANTHROPIC_API_KEY: "sk-ant-test-org-key-000000",
        SAGAX_ORG_NAME: "Acme",
        SAGAX_TEST_INTERNAL_CAPABILITY_KEY: ORG_CAPABILITY_KEY,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    org.stdout!.on("data", (chunk) => (orgLog += chunk));
    org.stderr!.on("data", (chunk) => (orgLog += chunk));
    await waitForServerReady(org, orgBase, () => orgLog, undefined, SERVER_START_MS);
  }, hostTimeout(SERVER_START_MS + 30_000));

  afterAll(async () => {
    if (org) await waitForExit(org, { signal: "SIGTERM" });
    await idp?.close();
    if (orgHome) await removeTempDir(orgHome);
  });

  it("lists, finds and reaches the person's own bots in every section, never another person's", async () => {
    const alex = await signIn(ALEX);
    const caller = await createAs(alex, "Alex Lead", "Coordinates the work");
    const own = await createAs(alex, "Alex Dispatch", "Schedules technicians");
    expect((await orgApi("PATCH", `/api/bots/${own.id}`, alex, { section: "Elsewhere" })).status).toBe(200);
    const blair = await signIn(BLAIR);
    const foreign = await createAs(blair, "Blair Dispatch", "Schedules technicians");

    const minted = await orgApi("POST", "/api/testing/internal-capability", undefined, { botId: caller.id, threadId: caller.threadId, kind: "agents", depth: 0 },
      { "x-openmausbot-test-capability": ORG_CAPABILITY_KEY });
    expect(minted.status, JSON.stringify(minted.body)).toBe(201);
    const token = String(minted.body.token);

    const listed = await orgTool(token, "list_agents", {});
    expect(listed.status, JSON.stringify(listed.body)).toBe(200);
    const ids = listed.body.agents.map((agent: { id: string }) => agent.id);
    expect(ids).toContain(own.id);
    expect(ids).not.toContain(foreign.id);

    const found = await orgTool(token, "find_agents", { query: "dispatch" });
    expect(found.status).toBe(200);
    expect(found.body.agents.map((agent: { id: string }) => agent.id)).toEqual([own.id]);

    for (const [name, args] of [
      ["send_prompt", { agent_id: foreign.id, prompt: "Please share the schedule", mode: "async" }],
      ["await_turn", { agent_id: foreign.id, timeout_ms: 1_000 }],
      ["read_latest_page", { agent_id: foreign.id, limit: 10 }],
    ] as const) {
      const refused = await orgTool(token, name, args);
      expect(refused.status, `${name}: ${JSON.stringify(refused.body)}`).toBe(404);
      expect(refused.body.code).toBe("unknown_agent");
    }

    const sent = await orgTool(token, "send_prompt", { agent_id: own.id, prompt: "Please read the queue", mode: "async" });
    expect(sent.status, JSON.stringify(sent.body)).toBe(200);
    expect(sent.body).toMatchObject({ accepted: true, agent_id: own.id });
  }, 60_000);
});
