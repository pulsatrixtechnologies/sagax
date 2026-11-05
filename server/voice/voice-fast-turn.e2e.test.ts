// Fast voice turns (server/voice/voice-turn.ts, docs/voice-mode-xai.md "A call
// turn runs fast"), end to end through the real server and the fake Claude
// CLI and its fake speech: a call turn runs on the fast model, in a session
// of its own started from a short view of the conversation and kept warm
// from turn to turn, while the conversation keeps its own session; a
// barge-in cuts the answer being written; lines said while the bot cannot
// answer never pile up into turns; and a heavy request is handed to a
// parallel task on the bot's main model.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, it } from "vitest";

import { launchVerificationServer } from "../../scripts/control-omb.ts";
import { VOICE_BRIEF_PREAMBLE } from "./voice-turn.ts";

const CALL_ID = "call-fast-0123456";
const FAST = "claude-haiku-4-5";

async function fixture(env: Record<string, string> = {}) {
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
  const received = join(dataDir, "received.jsonl");
  const gates = join(dataDir, "gates");
  mkdirSync(gates, { recursive: true });
  const wrapper = join(dataDir, "call-claude.mjs");
  writeFileSync(wrapper, [
    "#!/usr/bin/env node",
    'import { appendFileSync } from "node:fs";',
    `if (process.argv.includes("--input-format")) appendFileSync(${JSON.stringify(launches)}, JSON.stringify({ pid: process.pid, argv: process.argv.slice(2) }) + "\\n");`,
    `process.env.FAKE_CLAUDE_PROMPTS = ${JSON.stringify(received)};`,
    `process.env.FAKE_CLAUDE_GATE_DIR = ${JSON.stringify(gates)};`,
    ...Object.entries(env).map(([key, value]) => `process.env[${JSON.stringify(key)}] = ${JSON.stringify(value)};`),
    'process.stdin.on("end", () => process.exit(0));',
    `await import(${JSON.stringify(pathToFileURL(fileURLToPath(new URL("../testing/fake-claude-cli.ts", import.meta.url))).href)});`,
  ].join("\n"), { mode: 0o700 });
  await api("PATCH", "/api/instances/claude", { cli: wrapper });
  const bot = (await api("POST", "/api/bots", { name: "Quasar" }, 201)).bot;
  const thread = bot.threadId as string;
  const lines = (file: string) => (existsSync(file) ? readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)) : []);
  const launched = () => lines(launches) as Array<{ pid: number; argv: string[] }>;
  const prompts = () => (lines(received) as unknown[]).map((entry: any) => {
    const content = entry?.message?.content ?? entry;
    return typeof content === "string" ? content : JSON.stringify(content);
  });
  const messages = async (threadId = thread) => (await api("GET", `/api/threads/${threadId}/messages?limit=200`)).messages as any[];
  const replies = async () => (await messages()).filter((m) => m.role === "bot" && m.turnTerminal);
  const send = (body: Record<string, unknown>) => api("POST", `/api/bots/${bot.id}/messages`, { threadId: thread, ...body }, 202);
  const call = (state: "start" | "end") => api("POST", `/api/bots/${bot.id}/voice/call`, { threadId: thread, callId: CALL_ID, state });
  const busy = async () => Boolean((await api("GET", "/api/bots")).bots.find((entry: any) => entry.id === bot.id)?.busy);
  const open = (name: string) => writeFileSync(join(gates, name), "open");
  const arg = (argv: string[], flag: string) => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : undefined);
  const log = () => readFileSync(logPath, "utf8");
  return { server, api, bot, thread, launched, prompts, messages, replies, send, call, busy, open, arg, log };
}

const said = (turn: number, text: string) => ({ text, sendId: `send-fast-00000${turn}`, voiceCall: { callId: CALL_ID, utteranceId: `utt-fast-00${turn}` } });

it("runs a call on the fast model from a short context in one warm session, and the conversation keeps its own", async () => {
  const t = await fixture();
  try {
    // a long written conversation first, on the bot's main model
    for (let turn = 1; turn <= 4; turn++) {
      await t.send({ text: `[old-${turn}] ${"we discussed the firewall migration at length ".repeat(70)}` });
      await expect.poll(async () => (await t.replies()).length, { timeout: 15_000 }).toBe(turn);
    }
    const written = t.launched().at(-1)!;
    const mainModel = t.arg(written.argv, "--model");
    const mainSession = t.arg(written.argv, "--resume") ?? t.arg(written.argv, "--session-id");
    expect(mainModel).not.toBe(FAST);
    const before = t.launched().length;
    const promptsBefore = t.prompts().length;

    await t.call("start");
    // the warm: the fast model, a new session, never the conversation's
    await expect.poll(() => t.launched().length, { timeout: 15_000 }).toBe(before + 1);
    const warm = t.launched().at(-1)!;
    expect(t.arg(warm.argv, "--model")).toBe(FAST);
    expect(t.arg(warm.argv, "--resume")).toBeUndefined();
    expect(t.arg(warm.argv, "--session-id")).not.toBe(mainSession);
    expect(t.arg(warm.argv, "--effort")).toBe("low");

    const started = performance.now();
    for (let turn = 1; turn <= 3; turn++) {
      await t.send(said(turn, `question ${turn}`));
      await expect.poll(async () => (await t.replies()).length, { timeout: 15_000 }).toBe(4 + turn);
    }
    const perTurnMs = (performance.now() - started) / 3;
    // one process for the whole call: the warm one
    expect(t.launched()).toHaveLength(before + 1);
    const callPrompts = t.prompts().slice(promptsBefore);
    expect(callPrompts).toHaveLength(3);
    // the first spoken turn carries the short view: the latest turns, not the oldest
    expect(callPrompts[0]).toContain(VOICE_BRIEF_PREAMBLE);
    expect(callPrompts[0]).toContain("[old-4]");
    // the older turns only as a short summary
    expect(callPrompts[0]).toContain("[Earlier conversation summary");
    // the conversation part of it stays inside the call budget (the system
    // prompt's volatile half rides the same first message)
    expect(Buffer.byteLength(callPrompts[0]!.slice(callPrompts[0]!.indexOf(VOICE_BRIEF_PREAMBLE)))).toBeLessThan(8_000);
    // the later ones resume the call session with the words alone
    for (const prompt of callPrompts.slice(1)) {
      expect(prompt).not.toContain(VOICE_BRIEF_PREAMBLE);
      expect(prompt).not.toContain("[old-4]");
    }
    expect(t.log()).toMatch(/\[voice-turn\] thread \S+: new call session on claude\/claude-haiku-4-5/);
    expect(t.log()).toMatch(/\[voice-turn\] thread \S+: call session resumed on claude\/claude-haiku-4-5/);
    await expect.poll(() => /\[voice-latency\] utt=utt-fast-003 /.test(t.log()), { timeout: 5_000 }).toBe(true);
    console.log(`[voice-fast-turn] fake engine: ${Math.round(perTurnMs)} ms per call turn, send to settled reply\n${t.log().split("\n").filter((line) => line.includes("[voice-latency] utt=utt-fast")).join("\n")}`);

    // hung up: the written turn resumes the conversation's own session on
    // its own model, and hears what the call said
    await t.call("end");
    await t.send({ text: "in writing now" });
    await expect.poll(async () => (await t.replies()).length, { timeout: 15_000 }).toBe(8);
    const after = t.launched().at(-1)!;
    expect(t.arg(after.argv, "--model")).toBe(mainModel);
    // never the call's session: the conversation's own (an engine that
    // records what its session was handed), or a rebuild of the
    // conversation (this CLI, which does not)
    const callSession = t.arg(warm.argv, "--session-id");
    expect(t.arg(after.argv, "--resume")).not.toBe(callSession);
    if (t.arg(after.argv, "--resume") === undefined) expect(t.arg(after.argv, "--session-id")).not.toBe(callSession);
    else expect(t.arg(after.argv, "--resume")).toBe(mainSession);
    expect(t.prompts().at(-1)).toContain("question 3");
  } finally {
    await t.server.close();
  }
}, 180_000);

it("a barge-in cuts the answer being written, and lines said meanwhile become one turn answering the newest", async () => {
  const t = await fixture({ FAKE_CLAUDE_MODE: "slow", FAKE_CLAUDE_EXIT_DELAY_MS: "1500" });
  try {
    await t.call("start");
    await t.send(said(1, "[gate:first] tell me a long story"));
    await expect.poll(t.busy, { timeout: 15_000 }).toBe(true);
    // barge-in: the page stops the turn its words cut, then sends them
    await t.api("POST", `/api/bots/${t.bot.id}/interrupt`, { threadId: t.thread, expectedUtteranceId: "utt-fast-001" });
    await t.send({ ...said(2, "stop, what time is it"), voiceCall: { ...said(2, "").voiceCall, interrupted: true } });
    await expect.poll(async () => {
      const all = await t.messages();
      const asked = all.findIndex((m) => m.role === "user" && m.text === "stop, what time is it");
      return asked >= 0 && all.slice(asked + 1).some((m) => m.role === "bot" && m.kind === "text" && String(m.text ?? "").trim());
    }, { timeout: 20_000 }).toBe(true);
    // the cut story never gets a written answer of its own
    const all = await t.messages();
    const story = all.findIndex((m) => m.role === "user" && String(m.text).includes("long story"));
    const next = all.findIndex((m) => m.role === "user" && m.text === "stop, what time is it");
    expect(all.slice(story + 1, next).filter((m) => m.role === "bot" && m.kind === "text" && m.turnTerminal && String(m.text ?? "").trim())).toHaveLength(0);

    // no pile-up: lines said while a turn is being stopped are answered by
    // ONE turn: queued, they drain together and it answers the newest with
    // the earlier as context; or the newest joins the turn the first started
    await t.send(said(3, "[gate:hold] check the printer"));
    await expect.poll(t.busy, { timeout: 15_000 }).toBe(true);
    const stopping = t.api("POST", `/api/bots/${t.bot.id}/interrupt`, { threadId: t.thread });
    await new Promise((resolve) => setTimeout(resolve, 20));
    await t.send(said(4, "the one upstairs"));
    await t.send(said(5, "is it fixed"));
    await stopping;
    const answersAfter = async () => {
      const all = await t.messages();
      const first = all.findIndex((m) => m.role === "user" && m.text === "the one upstairs");
      return all.slice(first + 1).filter((m) => m.role === "bot" && m.kind === "text" && m.turnTerminal && String(m.text ?? "").trim()).length;
    };
    await expect.poll(answersAfter, { timeout: 20_000 }).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    expect(await answersAfter()).toBe(1);
    const merged = t.prompts().filter((prompt) => prompt.includes("the one upstairs") && prompt.includes("is it fixed"));
    for (const prompt of merged) expect(prompt).toContain("Before you could answer, they also said this on the call");
    // and every line stays in the conversation
    const texts = (await t.messages()).filter((m) => m.role === "user").map((m) => m.text);
    expect(texts).toEqual(expect.arrayContaining(["the one upstairs", "is it fixed"]));
  } finally {
    t.open("first");
    t.open("hold");
    await t.server.close();
  }
}, 180_000);

it("hands a heavy request to a parallel task on the bot's main model, with the conversation, and its result comes back", async () => {
  const t = await fixture({
    FAKE_CLAUDE_MCP_CALLS: JSON.stringify([{ server: "agents", tool: "start_thread", when: "refactor", arguments: { title: "Refactor the export", message: "Refactor the CSV export and fix its failing tests", report_back: true } }]),
  });
  try {
    await t.send({ text: "[old-1] the CSV export lives in the billing module" });
    await expect.poll(async () => (await t.replies()).length, { timeout: 15_000 }).toBe(1);
    const mainModel = t.arg(t.launched().at(-1)!.argv, "--model");
    await t.call("start");
    await t.send(said(1, "please refactor the CSV export"));
    // the call turn opened a parallel task of this conversation
    await expect.poll(async () => (await t.messages()).some((m) => m.parallelTask?.role === "card"), { timeout: 20_000 }).toBe(true);
    const card = (await t.messages()).find((m) => m.parallelTask?.role === "card");
    // it ran on the bot's main model, with the conversation in its brief
    await expect.poll(() => t.launched().some((launch) => t.arg(launch.argv, "--model") === mainModel && t.prompts().some((p) => p.includes("handed off from a live phone call"))), { timeout: 20_000 }).toBe(true);
    const brief = t.prompts().find((p) => p.includes("handed off from a live phone call"))!;
    expect(brief).toContain("the CSV export lives in the billing module");
    expect(brief).toContain("Refactor the CSV export and fix its failing tests");
    // its result is posted back into the conversation, to be read aloud
    await expect.poll(async () => (await t.messages()).some((m) => m.parallelTask?.role === "result" && m.parallelTask.threadId === card.parallelTask.threadId), { timeout: 30_000 }).toBe(true);
  } finally {
    await t.server.close();
  }
}, 180_000);
