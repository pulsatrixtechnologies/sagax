// A call's engine stays warm (docs/voice-mode-xai.md, "Latency"), end to
// end through the real server and the fake Claude CLI: accepting the call
// starts the one process every turn of the call reuses, so the first
// spoken turn pays no cold start; the per-turn comms token reaches that
// process through its token file, so its tools keep working; a hangup
// before any turn closes the idle process; a written turn outside a call
// still gets a process of its own; and the server logs each call turn's
// stages under the utterance id. The same holds on Grok (the ACP driver),
// whose call is warmed with no prompt and whose call turns are bare
// session/prompt requests.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, it } from "vitest";

import { launchVerificationServer, verificationServerEnvironment } from "../scripts/control-omb.ts";
import { removeTempDir, waitForExit } from "./testing/cleanup.ts";
import { freePortBlock } from "./testing/ports.ts";

const CALL_ID = "call-0123456789";

async function fixture() {
  const server = await launchVerificationServer();
  const { url, dataDir, logPath } = server.info;
  const api = async (method: string, path: string, body?: unknown, status = 200) => {
    const response = await fetch(`${url}${path}`, {
      method, headers: { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10_000),
    });
    const result = await response.json() as any;
    expect(response.status, `${method} ${path}: ${JSON.stringify(result)}`).toBe(status);
    return result;
  };
  const launches = join(dataDir, "launches.jsonl");
  const wrapper = join(dataDir, "call-claude.mjs");
  writeFileSync(wrapper, [
    "#!/usr/bin/env node",
    'import { appendFileSync } from "node:fs";',
    // one line per turn process (not the version and sign-in probes)
    `if (process.argv.includes("--input-format")) appendFileSync(${JSON.stringify(launches)}, JSON.stringify({ pid: process.pid, argv: process.argv.slice(2) }) + "\\n");`,
    // each turn lists the bot's teammates through the agents proxy
    `process.env.FAKE_CLAUDE_MCP_CALLS = ${JSON.stringify(JSON.stringify([{ server: "agents", tool: "list_bots", arguments: {} }]))};`,
    'process.stdin.on("end", () => process.exit(0));',
    `await import(${JSON.stringify(pathToFileURL(fileURLToPath(new URL("./testing/fake-claude-cli.ts", import.meta.url))).href)});`,
  ].join("\n"), { mode: 0o700 });
  await api("PATCH", "/api/instances/claude", { cli: wrapper });
  const bot = (await api("POST", "/api/bots", { name: "Quasar" }, 201)).bot;
  const thread = bot.threadId as string;
  const messages = async () => (await api("GET", `/api/threads/${thread}/messages?limit=200`)).messages as any[];
  const replies = async () => (await messages()).filter((m) => m.role === "bot" && m.turnTerminal);
  const send = (body: Record<string, unknown>) => api("POST", `/api/bots/${bot.id}/messages`, { threadId: thread, ...body }, 202);
  const launched = () => (existsSync(launches) ? readFileSync(launches, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as { pid: number; argv: string[] }) : []);
  const pids = () => launched().map((launch) => launch.pid);
  const processes = () => pids().length;
  const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
  const log = () => readFileSync(logPath, "utf8");
  return { server, api, bot, thread, messages, replies, send, processes, pids, launched, alive, log };
}

it("keeps one engine process for a whole call, its tools working on every turn", async () => {
  const t = await fixture();
  try {
    await t.api("POST", `/api/bots/${t.bot.id}/voice/call`, { threadId: t.thread, callId: CALL_ID, state: "start" });
    for (let turn = 1; turn <= 3; turn++) {
      await t.send({ text: `question ${turn}`, sendId: `send-${turn}-000000000${turn}`, voiceCall: { callId: CALL_ID, utteranceId: `utt-000000${turn}` } });
      await expect.poll(async () => (await t.replies()).length, { timeout: 15_000 }).toBe(turn);
    }
    // one cold start for the call; the later turns found the process warm
    expect(t.processes()).toBe(1);
    // the second and third turns' tools ran with their own (current) token
    const texts = (await t.replies()).map((m) => String(m.text));
    expect(texts).toHaveLength(3);
    for (const text of texts) expect(text).toContain("mcp:list_bots:ok");
    // the server's stages of each call turn, under its utterance id
    await expect.poll(() => (t.log().match(/\[voice-latency\] utt=utt-0000003 .*\(warm\)/) ? true : false), { timeout: 5_000 }).toBe(true);
    expect(t.log()).toMatch(/\[voice-latency\] utt=utt-0000001 .*\(warm\)/);
    expect(t.log()).not.toMatch(/relaunch: spawn contract changed/);

    // hung up: a written turn is not a call turn, and gets its own process
    await t.api("POST", `/api/bots/${t.bot.id}/voice/call`, { threadId: t.thread, callId: CALL_ID, state: "end" });
    await t.send({ text: "in writing now" });
    await expect.poll(async () => (await t.replies()).length, { timeout: 15_000 }).toBe(4);
    expect(t.processes()).toBe(2);
    // the call ran at low effort; the written turn at the bot's own (none set)
    const effort = (argv: string[]) => (argv.includes("--effort") ? argv[argv.indexOf("--effort") + 1] : undefined);
    expect(t.launched().map((launch) => effort(launch.argv))).toEqual(["low", undefined]);
  } finally {
    await t.server.close();
  }
}, 120_000);

it("starts the engine when the call is accepted, and a hangup before any turn closes it", async () => {
  const t = await fixture();
  try {
    const before = await t.messages();
    const call = (callId: string, state: "start" | "alive" | "end") =>
      t.api("POST", `/api/bots/${t.bot.id}/voice/call`, { threadId: t.thread, callId, state });
    await call(CALL_ID, "start");
    await expect.poll(() => t.processes(), { timeout: 15_000 }).toBe(1);
    const first = t.pids()[0]!;
    expect(t.alive(first)).toBe(true);
    // no transcript row, and a keepalive or a repeated start does not launch again
    expect(await t.messages()).toEqual(before);
    await call(CALL_ID, "alive");
    await call(CALL_ID, "start");
    expect(t.processes()).toBe(1);
    expect(t.alive(first)).toBe(true);
    await call(CALL_ID, "end");
    await expect.poll(() => t.alive(first), { timeout: 10_000 }).toBe(false);
    expect(await t.messages()).toEqual(before);

    await call(CALL_ID, "start");
    await expect.poll(() => t.processes(), { timeout: 15_000 }).toBe(2);
    const second = t.pids()[1]!;
    expect(t.alive(second)).toBe(true);
    // A new call on this thread reuses the idle process. The call id changes;
    // the engine does not. Give a mistaken second spawn time to appear.
    const replaced = "call-abcdef9876";
    await call(replaced, "start");
    await expect.poll(() => t.log().split("[voice-call] warming thread").length - 1, { timeout: 15_000 }).toBeGreaterThanOrEqual(3);
    const seenWarm = Date.now();
    await expect.poll(() => (Date.now() - seenWarm < 2_000 ? 0 : t.processes()), { timeout: 15_000 }).toBe(2);
    expect(t.alive(second)).toBe(true);
    expect(await t.messages()).toEqual(before);
    // The replaced call id no longer owns the thread, so its hangup is a no-op.
    await call(CALL_ID, "end");
    expect(t.alive(second)).toBe(true);
    await call(replaced, "end");
    await expect.poll(() => t.alive(second), { timeout: 10_000 }).toBe(false);
    expect(await t.messages()).toEqual(before);
  } finally {
    await t.server.close();
  }
}, 120_000);

/** The same call on Grok (the ACP driver and the fake ACP CLI in voice
 * mode): a server whose only engine is Grok, each launch's argv recorded,
 * each ACP request logged, and the agents tool called on every prompt. */
async function grokFixture() {
  const dataDir = mkdtempSync(join(tmpdir(), "omb-voice-grok-"));
  mkdirSync(join(dataDir, "tmp"), { recursive: true });
  const launches = join(dataDir, "launches.jsonl");
  const rpcLog = join(dataDir, "rpc.jsonl");
  const wrapper = join(dataDir, "call-grok.mjs");
  writeFileSync(wrapper, [
    "#!/usr/bin/env node",
    'import { appendFileSync } from "node:fs";',
    // one line per agent process (not the version, sign-in and model probes)
    `if (process.argv.includes("stdio")) appendFileSync(${JSON.stringify(launches)}, JSON.stringify({ pid: process.pid, argv: process.argv.slice(2) }) + "\\n");`,
    `await import(${JSON.stringify(pathToFileURL(fileURLToPath(new URL("./testing/fake-acp-cli.ts", import.meta.url))).href)});`,
  ].join("\n"), { mode: 0o700 });
  writeFileSync(join(dataDir, "config.json"), JSON.stringify({ instances: { grok: {
    driver: "grokAgent", displayName: "Grok fixture",
    environment: { FAKE_ACP_MODE: "voice", FAKE_ACP_VOICE_TOOL: "list_bots", FAKE_ACP_RPC_APPEND_FILE: rpcLog },
    config: { cli: wrapper, fullAuto: false },
  } } }));
  const port = await freePortBlock([0, 1]);
  let output = "";
  const child = spawn(process.execPath, ["--experimental-strip-types", fileURLToPath(new URL("./index.ts", import.meta.url))], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    env: verificationServerEnvironment(process.env, dataDir, port),
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout!.on("data", (chunk) => (output += chunk));
  child.stderr!.on("data", (chunk) => (output += chunk));
  const url = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 60_000;
  for (;;) {
    try { if ((await fetch(`${url}/api/health`)).ok) break; } catch { /* starting */ }
    if (Date.now() > deadline || child.exitCode !== null) throw new Error(`server did not start:\n${output}`);
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  const api = async (method: string, path: string, body?: unknown, status = 200) => {
    const response = await fetch(`${url}${path}`, {
      method, headers: { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10_000),
    });
    const result = await response.json() as any;
    expect(response.status, `${method} ${path}: ${JSON.stringify(result)}`).toBe(status);
    return result;
  };
  // The seed bot only gets a signed-in engine by itself (#2614) and this
  // fake Grok is signed out: put the bot on it.
  const seed = (await api("GET", "/api/bots")).bots[0];
  await api("PATCH", `/api/bots/${seed.id}`, { modelSelection: { instanceId: "grok", model: "grok-4.7" } });
  const bot = (await api("GET", "/api/bots")).bots[0];
  expect(bot.modelSelection.instanceId).toBe("grok");
  const thread = bot.threadId as string;
  const replies = async () => ((await api("GET", `/api/threads/${thread}/messages?limit=200`)).messages as any[])
    .filter((m) => m.role === "bot" && m.turnTerminal);
  const send = (body: Record<string, unknown>) => api("POST", `/api/bots/${bot.id}/messages`, { threadId: thread, ...body }, 202);
  const lines = (file: string) => (existsSync(file) ? readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)) : []);
  const processes = () => lines(launches) as Array<{ pid: number; argv: string[] }>;
  const rpc = () => (lines(rpcLog) as Array<{ method: string }>).map((entry) => entry.method).filter((method) => !method.endsWith(".result"));
  const close = async () => {
    await waitForExit(child, { signal: "SIGTERM" });
    await removeTempDir(dataDir);
  };
  return { api, bot, thread, replies, send, processes, rpc, log: () => output, close };
}

it("Grok: warms at call start, then every call turn is a bare prompt whose tools use the current token", async () => {
  const t = await grokFixture();
  try {
    await t.api("POST", `/api/bots/${t.bot.id}/voice/call`, { threadId: t.thread, callId: CALL_ID, state: "start" });
    // the warm: handshake, a native session, then one background cache-prime
    // prompt (not a turn). The spoken prompts come after.
    await expect.poll(() => t.rpc(), { timeout: 15_000 }).toEqual(["initialize", "authenticate", "session/new", "session/prompt"]);
    for (let turn = 1; turn <= 3; turn++) {
      await t.send({ text: `question ${turn}`, sendId: `send-${turn}-000000000${turn}`, voiceCall: { callId: CALL_ID, utteranceId: `utt-000000${turn}` } });
      await expect.poll(async () => (await t.replies()).length, { timeout: 15_000 }).toBe(turn);
    }
    // one process, one session, and nothing but prompts after the warm
    expect(t.processes()).toHaveLength(1);
    // (Grok's per-turn session/set_model pin and its _x.ai/mcp/list check
    // that the MCP servers are ready before a prompt (#691) are wire calls on
    // the live session, not an establishment: they are left out)
    const establishing = (methods: string[]) => methods.filter((method) => method !== "session/set_model" && method !== "_x.ai/mcp/list");
    expect(establishing(t.rpc())).toEqual([
      "initialize", "authenticate", "session/new", "session/prompt",
      "session/prompt", "session/prompt", "session/prompt",
    ]);
    for (const reply of await t.replies()) expect(String(reply.text)).toContain("mcp:list_bots:ok");
    await expect.poll(() => /\[voice-latency\] utt=utt-0000003 .*\(warm\)/.test(t.log()), { timeout: 5_000 }).toBe(true);
    expect(t.log()).toMatch(/\[voice-latency\] utt=utt-0000001 .*\(warm\)/);
    expect(t.log()).not.toMatch(/\(cold start\)/);

    // hung up: the idle process closes, and a written turn gets its own
    await t.api("POST", `/api/bots/${t.bot.id}/voice/call`, { threadId: t.thread, callId: CALL_ID, state: "end" });
    await t.send({ text: "in writing now" });
    await expect.poll(async () => (await t.replies()).length, { timeout: 15_000 }).toBe(4);
    expect(t.processes()).toHaveLength(2);
    // the call ran in a session of its own (server/voice/voice-turn.ts): this
    // conversation had none before it, so the written turn starts one
    expect(establishing(t.rpc()).slice(7)).toEqual(["initialize", "authenticate", "session/new", "session/prompt"]);
    // the call's process ran at low effort; the written turn's at the bot's own (none set)
    const effort = (argv: string[]) => (argv.includes("--reasoning-effort") ? argv[argv.indexOf("--reasoning-effort") + 1] : undefined);
    expect(t.processes().map((launch) => effort(launch.argv))).toEqual(["low", undefined]);
    expect(String((await t.replies())[3].text)).toContain("mcp:list_bots:ok");
  } finally {
    await t.close();
  }
}, 120_000);
