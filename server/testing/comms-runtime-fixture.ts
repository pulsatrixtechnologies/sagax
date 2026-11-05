// Real runtime and native MCP fixture for the comms migration from the retired
// delegation ledger (be8ceecc7, 543ea88e7, 6db1f4b60 and the runtime lot 3).
// The launcher owns the home; both providers below run only on loopback.
import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { createInterface } from "node:readline";
import { expect } from "vitest";
import { launchVerificationServer, verificationServerEnvironment } from "../../scripts/control-omb.ts";
import { waitForExit } from "./cleanup.ts";
import { checkInvariants } from "../runtime/invariants.ts";
import { openRuntimeStore } from "../runtime/store.ts";
import type { Assignment } from "../runtime/types.ts";

export type CommsBot = { id: string; threadId: string; activeTaskId: string; modelSelection: any };
const TEST_CAPABILITY = "comms-runtime-depth-fixture-0123456789abcdef";

// A thin ACP transport around the same scripted native-MCP engine used by
// runtime-delivery-convergence.e2e.test.ts. Antigravity still supplies its
// actual temporary session MCP mount, never a global Gemini configuration.
const acpFixture = `#!/usr/bin/env node
import { createInterface } from "node:readline";
import { runRoomHandoffAgent } from ${JSON.stringify(new URL("./room-handoff-agent.ts", import.meta.url).href)};
import { agentsEnvOf } from ${JSON.stringify(new URL("../drivers/spawn-contract.ts", import.meta.url).href)};
if (process.argv.includes("--version")) { console.log("grok 1.0.50"); process.exit(0); }
if (process.argv.includes("--help")) { console.log("Synthetic ACP fixture"); process.exit(0); }
let sessionId = "comms-session", servers = [], model = "fake-model", mode = "default", active;
let generation = 0, rejectedLoad = false, freshAfterRejectedLoad = false;
const send = value => process.stdout.write(JSON.stringify(value) + "\\n");
const result = (id, value = {}) => send({ jsonrpc: "2.0", id, result: value });
const options = () => [
  { id: "model", name: "Model", category: "model", type: "select", currentValue: model,
    options: ["fake-model", "gemini-3.8-flash-high"].map(value => ({ value, name: value })) },
  { id: "mode", name: "Mode", category: "mode", type: "select", currentValue: mode,
    options: ["default", "yolo", "auto_edit"].map(value => ({ value, name: value })) },
];
const input = createInterface({ input: process.stdin });
input.on("line", async line => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg.method === "initialize") return result(msg.id, { protocolVersion: 1,
    authMethods: [{ id: "oauth-personal", name: "Fixture" }, { id: "cached_token", name: "Fixture subscription" }],
    agentCapabilities: { loadSession: true, sessionCapabilities: { resume: true } },
    _meta: { modelState: { currentModelId: model } } });
  if (process.env.COMMS_NO_LOAD === "1" && (msg.method === "session/load" || msg.method === "session/resume")) { rejectedLoad = true; return result(msg.id, null); }
  if (msg.method === "session/new" || msg.method === "session/load" || msg.method === "session/resume") {
    if (msg.method === "session/new" && rejectedLoad) freshAfterRejectedLoad = true;
    if (Array.isArray(msg.params?.mcpServers)) servers = msg.params.mcpServers;
    sessionId = msg.params?.sessionId || sessionId;
    return result(msg.id, { sessionId, configOptions: options() });
  }
  if (msg.method === "session/set_config_option") {
    if (msg.params.configId === "model") model = msg.params.value;
    if (msg.params.configId === "mode") mode = msg.params.value;
    return result(msg.id, { configOptions: options() });
  }
  if (msg.method === "_x.ai/mcp/list") return result(msg.id, { result: { servers: [], sessionMcpResolved: true } });
  if (msg.method === "session/cancel") {
    generation++;
    if (active !== undefined) result(active, { stopReason: "cancelled" });
    active = undefined;
    return;
  }
  if (msg.method !== "session/prompt") { if (msg.id !== undefined) result(msg.id); return; }
  const ownGeneration = ++generation;
  active = msg.id;
  try {
    const server = servers.find(server => server.name === "agents");
    if (!server) throw new Error("Native agents MCP was not mounted");
    const nativeEnv = Array.isArray(server.env) ? Object.fromEntries(server.env.map(entry => [entry.name, entry.value])) : server.env;
    // Grok wraps agents in its real MCP tool gate. Read only the logical
    // fixture identity there; every tool still runs through that gate.
    const identity = agentsEnvOf({ agents: { env: nativeEnv } });
    const env = { ...nativeEnv, SAGAX_BOT_ID: identity.SAGAX_BOT_ID, SAGAX_THREAD_ID: identity.SAGAX_THREAD_ID };
    const text = (msg.params.prompt || []).map(part => part.text || "").join("\\n");
    const answer = await runRoomHandoffAgent([], process.env.COMMS_PLAN, { message: { content: text } }, {
      integration: { command: server.command, args: server.args, env }, system: text,
      evidence: { protocol: "acp", peerHop: identity.SAGAX_PEER_HOP, model, freshAfterRejectedLoad },
    });
    if (generation !== ownGeneration) return;
    send({ jsonrpc: "2.0", method: "session/update", params: { sessionId,
      update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: answer } } } });
    result(msg.id, { stopReason: "end_turn", _meta: { inputTokens: 12, outputTokens: 8 } });
    // Finish cleanly so the next turn really has to restore its cursor.
    if (process.env.COMMS_NO_LOAD === "1") { input.close(); process.stdin.destroy(); }
  } catch (error) {
    if (generation === ownGeneration) send({ jsonrpc: "2.0", id: msg.id,
      error: { code: -32603, message: error.message } });
  } finally { if (generation === ownGeneration) active = undefined; }
});
`;

export async function withCommsRuntime(test: (fixture: CommsRuntimeFixture) => Promise<void>): Promise<void> {
  const session = await launchVerificationServer({}, undefined, undefined, undefined, undefined, { scripted: true });
  const { url, dataDir, logPath } = session.info;
  const planFile = join(dataDir, "room-plan.json");
  const plan: Record<string, any> = {};
  const gates: string[] = [];
  let server: ChildProcess | undefined;
  const compat = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    compatPrompts.push(body);
    if (req.url === "/v1/models") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ data: [{ id: "fake-model" }] }));
      return;
    }
    if (compatMode === "hang") return;
    if (compatMode === "limit") {
      res.writeHead(429, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "Rate limit reached for fake-model: 30 requests per minute" } }));
      return;
    }
    const steps = compatMode === "steps";
    const delta = steps
      ? { content: "Still exporting.", tool_calls: [{ index: 0, id: `call_${randomUUID()}`, type: "function", function: { name: "missing_tool", arguments: "{}" } }] }
      : { content: "Compat result delivered" };
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.end(`data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: steps ? "tool_calls" : "stop" }] })}\n\ndata: [DONE]\n\n`);
  });
  const compatPrompts: string[] = [];
  let compatMode: "hang" | "reply" | "steps" | "limit" = "hang";
  await new Promise<void>(resolve => compat.listen(0, "127.0.0.1", resolve));
  const compatUrl = `http://127.0.0.1:${(compat.address() as AddressInfo).port}/v1`;
  const start = async () => {
    const log = openSync(logPath, "a", 0o600);
    server = spawn(process.execPath, [fileURLToPath(new URL("../index.ts", import.meta.url))], {
      cwd: fileURLToPath(new URL("../..", import.meta.url)),
      env: { ...verificationServerEnvironment({}, dataDir, Number(new URL(url).port)), SAGAX_LIMIT_FAILOVER: "0",
        SAGAX_TEST_INTERNAL_CAPABILITY_KEY: TEST_CAPABILITY },
      stdio: ["ignore", log, log],
    });
    closeSync(log);
    await expect.poll(async () => {
      if (server?.exitCode !== null) throw new Error(`Fixture exited: ${logPath}`);
      try { return (await fetch(url + "/api/health")).ok; } catch { return false; }
    }, { timeout: 30_000, interval: 100 }).toBe(true);
  };
  const api = async (method: string, path: string, body?: unknown, status = 200) => {
    const res = await fetch(url + path, { method, headers: { "content-type": "application/json", origin: url },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const value = await res.json() as any;
    expect(res.status, `${method} ${path}: ${JSON.stringify(value)}`).toBe(status);
    return value;
  };
  const evidence = () => existsSync(`${planFile}.evidence.jsonl`)
    ? readFileSync(`${planFile}.evidence.jsonl`, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line)) as any[] : [];
  const assignments = (): Assignment[] => {
    if (!existsSync(join(dataDir, "runtime.db"))) return [];
    const db = new DatabaseSync(join(dataDir, "runtime.db"), { readOnly: true });
    try { return (db.prepare("SELECT json FROM assignments ORDER BY created_at, rowid").all() as Array<{ json: string }>).map(row => JSON.parse(row.json)); }
    finally { db.close(); }
  };
  try {
    await waitForExit(session.child, { signal: "SIGTERM" });
    const cli = join(dataDir, "comms-acp.ts");
    writeFileSync(cli, acpFixture, { mode: 0o700 });
    const agy = join(dataDir, "fake-antigravity");
    mkdirSync(agy);
    writeFileSync(join(agy, "agy_acp_server.ts"), acpFixture, { mode: 0o700 });
    writeFileSync(join(agy, process.platform === "win32" ? "localharness_external.exe" : "localharness_external"), acpFixture, { mode: 0o700 });
    mkdirSync(join(dataDir, ".grok"), { recursive: true });
    writeFileSync(join(dataDir, ".grok", "auth.json"), "{}\n");
    const profile = join(dataDir, "providers", "antigravity", createHash("sha256").update("geminiAsker").digest("hex"), "antigravity-acp");
    mkdirSync(profile, { recursive: true });
    writeFileSync(join(profile, "acp_token.json"), "{}\n");
    const configPath = join(dataDir, "config.json");
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    const environment = { COMMS_PLAN: planFile };
    config.instances.acp = { driver: "grokAgent", environment, config: { cli, fullAuto: true } };
    config.instances.noLoad = { driver: "grokAgent", environment: { ...environment, COMMS_NO_LOAD: "1" }, config: { cli, fullAuto: true } };
    config.instances.geminiAsker = { driver: "antigravityAgent", environment, config: { cli: join(agy, "agy_acp_server.ts"), fullAuto: true } };
    config.instances.crash = { driver: "grokAgent", environment: { FAKE_ACP_MODE: "exit-early" },
      config: { cli: fileURLToPath(new URL("./fake-acp-cli.ts", import.meta.url)), fullAuto: true } };
    config.instances.image = { driver: "grokAgent", environment: { FAKE_ACP_MODE: "image" },
      config: { cli: fileURLToPath(new URL("./fake-acp-cli.ts", import.meta.url)), fullAuto: true } };
    config.instances.compat = { driver: "openai-compat", config: { model: "fake-model" } };
    config.openaiCompat = { key: "comms-fixture-key", url: compatUrl };
    config.automaticRecovery = { enabled: false };
    writeFileSync(configPath, JSON.stringify(config));
    await start();
    await test({
      url, dataDir, plan, api, assignments, evidence, compatPrompts, compatUrl,
      setCompat: mode => { compatMode = mode; },
      gate: name => { const path = join(dataDir, name); gates.push(path); return path; },
      save: () => writeFileSync(planFile, JSON.stringify(plan)),
      messages: async thread => (await api("GET", `/api/threads/${thread}/messages?limit=500`)).messages,
      bot: async (name, patch = {}) => {
        const { bot } = await api("POST", "/api/bots", { name }, 201);
        const updated = await api("PATCH", `/api/bots/${bot.id}`, { proactiveMode: "off", ...patch });
        return { ...updated.bot, threadId: bot.threadId, activeTaskId: bot.threadId };
      },
      settled: async () => {
        await expect.poll(async () => (await api("GET", "/api/bots?messages=0")).bots.every((bot: any) => !bot.busy && !bot.waitingForTeammates && bot.tasks.every((task: any) => !task.busy && !task.waitingForTeammates)),
          { timeout: 45_000, interval: 100 }).toBe(true);
      },
      invariants: () => {
        const store = openRuntimeStore(join(dataDir, "runtime.db"));
        try { return checkInvariants(store, { running: new Set(), parked: new Set() }); } finally { store.close(); }
      },
      catalogAtDepth: async (owner, peer, depth) => {
        const minted = await fetch(url + "/api/testing/internal-capability", {
          method: "POST", headers: { "content-type": "application/json", "x-openmausbot-test-capability": TEST_CAPABILITY },
          body: JSON.stringify({ botId: owner.id, threadId: owner.threadId, depth }),
        });
        expect(minted.status).toBe(201);
        const { token } = await minted.json() as { token: string };
        const proxy = spawn(process.execPath, [fileURLToPath(new URL("../drivers/agents-proxy.ts", import.meta.url))], {
          env: { HOME: dataDir, USERPROFILE: dataDir, PATH: process.env.PATH,
            SAGAX_HARNESS_URL: url, SAGAX_BOT_ID: owner.id, SAGAX_THREAD_ID: owner.threadId,
            SAGAX_COMMS_TOKEN: token, SAGAX_TURN_DEPTH: String(depth), SAGAX_PEER_HOP: "1", SAGAX_ROOM_TURN: "0" },
          stdio: ["pipe", "pipe", "pipe"],
        });
        proxy.stderr!.resume();
        let names: string[];
        try {
          names = await new Promise<string[]>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error("Native depth catalog did not answer")), 10_000);
            createInterface({ input: proxy.stdout! }).on("line", line => {
              const response = JSON.parse(line);
              if (response.id !== 2) return;
              clearTimeout(timer);
              resolve(response.result.tools.map((tool: { name: string }) => tool.name));
            });
            proxy.once("error", reject);
            proxy.stdin!.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {} } }) + "\n");
            proxy.stdin!.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }) + "\n");
          });
        } finally {
          proxy.stdin!.destroy();
          await waitForExit(proxy, { signal: "SIGTERM" });
        }
        const response = await fetch(url + "/api/internal/ask-bot", { method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify({ toBotId: peer.id, message: "A second hop must be refused" }),
        });
        return { names, ask: { status: response.status, body: await response.json() as any } };
      },
    });
  } catch (error) {
    const diagnostic = `${logPath}.comms.json`;
    writeFileSync(diagnostic, JSON.stringify({ assignments: assignments(), turns: evidence().map(turn => ({
      botId: turn.botId, threadId: turn.threadId, resumed: turn.resumed, turnIndex: turn.turnIndex,
      protocol: turn.protocol, freshAfterRejectedLoad: turn.freshAfterRejectedLoad,
      calls: (turn.evidence ?? []).filter((entry: any) => entry.step), prompt: turn.prompt,
    })) }, null, 2));
    console.error(`Comms fixture failure evidence: ${diagnostic}`);
    throw error;
  } finally {
    for (const gate of gates) writeFileSync(gate, "release");
    await waitForExit(server, { signal: "SIGTERM" });
    compat.closeAllConnections();
    await new Promise<void>(resolve => compat.close(() => resolve()));
    await session.close();
  }
}

export interface CommsRuntimeFixture {
  url: string;
  dataDir: string;
  plan: Record<string, any>;
  api(method: string, path: string, body?: unknown, status?: number): Promise<any>;
  assignments(): Assignment[];
  evidence(): any[];
  compatPrompts: string[];
  compatUrl: string;
  setCompat(mode: "hang" | "reply" | "steps" | "limit"): void;
  gate(name: string): string;
  save(): void;
  messages(threadId: string): Promise<any[]>;
  bot(name: string, patch?: Record<string, unknown>): Promise<CommsBot>;
  settled(): Promise<void>;
  invariants(): string[];
  catalogAtDepth(owner: CommsBot, peer: CommsBot, depth: number): Promise<{ names: string[]; ask: { status: number; body: any } }>;
}
