// A duplex voice call never turns partials, finals of one sentence or
// follow-ups into parallel tasks (2026-10-13: one "Tâche en parallèle" card
// per partial and final, and a spoken "Oui ca serait bien" run as its own
// failed task). While the call turn only thinks, new words replace it. While
// its own tool runs, a correction joins that turn (steer) and the work is not
// killed; a new independent request starts beside it as a parallel task
// (#4216). Stop cancels it.
// POSIX-gated like the other CLI e2es (the fakes are shebang scripts).
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { freePortBlock } from "./testing/ports.ts";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const FAKE_CLAUDE = join(SERVER_DIR, "testing", "fake-claude-cli.ts");
const posixOnly = describe.skipIf(process.platform === "win32");
const CALL_ID = "call-conc-0123456789";

posixOnly("voice call true concurrency e2e", () => {
  let child: ChildProcess;
  let home: string;
  let gates: string;
  let base = "";
  let stderr = "";

  const api = async (method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json() };
  };
  const getBot = async (id: string) => (await api("GET", "/api/bots")).body.bots.find((b: any) => b.id === id);
  const messages = async (threadId: string): Promise<any[]> =>
    (await api("GET", `/api/threads/${threadId}/messages?limit=200`)).body.messages ?? [];
  const tasks = async (botId: string): Promise<any[]> => (await getBot(botId)).tasks ?? [];
  const open = (name: string) => writeFileSync(join(gates, name), "go");
  const waitFor = async (predicate: () => Promise<boolean>, what: string, ms = 30_000) => {
    const deadline = Date.now() + ms;
    while (!(await predicate())) {
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}. stderr: ${stderr.slice(-2000)}`);
      await new Promise((r) => setTimeout(r, 100));
    }
  };
  const voice = (text: string, utteranceId: string) => ({
    text,
    voiceCall: { callId: CALL_ID, duplex: true, utteranceId },
  });
  /** A call whose first turn holds on a tool (instance `claude`) or only
   * thinks (instance `think`). */
  const busyCall = async (gate: string, instanceId: "claude" | "think" = "claude") => {
    const bot = (await api("POST", "/api/bots")).body.bot;
    await api("PATCH", `/api/bots/${bot.id}`, { modelSelection: { instanceId, model: "claude-fake" } });
    const sent = await api("POST", `/api/bots/${bot.id}/messages`, {
      threadId: bot.threadId,
      ...voice(`[gate:${gate}] look up the weather in Montreal`, `utt-${gate}`),
    });
    expect(sent.status, JSON.stringify(sent.body)).toBe(202);
    await waitFor(async () => (await getBot(bot.id)).busy === true, "the first turn to start");
    if (instanceId === "claude") {
      await waitFor(async () => (await messages(bot.threadId)).some((m) => m.kind === "activity" && m.tool?.name && m.tool.ok === undefined && !m.parallelTask),
        "the first turn's tool in flight");
    }
    return bot as { id: string; threadId: string };
  };

  beforeAll(async () => {
    chmodSync(FAKE_CLAUDE, 0o755);
    home = mkdtempSync(join(tmpdir(), "omb-voice-conc-"));
    gates = join(home, "gates");
    mkdirSync(gates, { recursive: true });
    mkdirSync(join(home, ".sagax"), { recursive: true });
    writeFileSync(join(home, ".sagax", "config.json"), JSON.stringify({
      instances: {
        claude: {
          driver: "claudeAgent",
          environment: { FAKE_CLAUDE_MODE: "slow", FAKE_CLAUDE_GATE_DIR: gates, FAKE_CLAUDE_HOLD_AFTER_TOOL: "1" },
          config: { cli: FAKE_CLAUDE, permissionMode: "bypassPermissions" },
        },
        think: {
          driver: "claudeAgent",
          environment: { FAKE_CLAUDE_MODE: "slow", FAKE_CLAUDE_GATE_DIR: gates },
          config: { cli: FAKE_CLAUDE, permissionMode: "bypassPermissions" },
        },
      },
    }));
    const port = await freePortBlock([0, 1]);
    base = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, [join(SERVER_DIR, "index.ts")], {
      cwd: join(SERVER_DIR, ".."),
      env: { ...(process.env.PATH ? { PATH: process.env.PATH } : {}), HOME: home, USERPROFILE: home, SAGAX_PORT: String(port), SAGAX_VOICE_FULL_DUPLEX: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stderr!.on("data", (c) => (stderr += c));
    const deadline = Date.now() + 20_000;
    for (;;) {
      try {
        if ((await fetch(`${base}/api/health`)).ok) break;
      } catch {
        /* not up yet */
      }
      if (Date.now() > deadline) throw new Error(`server never came up. stderr:\n${stderr}`);
      if (child.exitCode !== null) throw new Error(`server exited ${child.exitCode}. stderr:\n${stderr}`);
      await new Promise((r) => setTimeout(r, 150));
    }
  }, 30_000);

  afterAll(async () => {
    child?.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      if (!child || child.exitCode !== null) return resolve();
      child.on("close", () => resolve());
      setTimeout(() => (child.kill("SIGKILL"), resolve()), 5_000).unref?.();
    });
    rmSync(home, { recursive: true, force: true });
  });

  it("a call with N utterances while the bot only thinks: no parallel task, one answered turn for the final words", async () => {
    // Owner 2026-10-13: a partial and its final each opened a "Tâche en
    // parallèle" card ("And And Just wondering if you will be." / "... would be
    // able to ..."). The person's words are the call, never background work.
    const bot = await busyCall("thinkN", "think");
    const send = (text: string, utteranceId: string, extra: Record<string, unknown> = {}) => api("POST", `/api/bots/${bot.id}/messages`, {
      threadId: bot.threadId, text, voiceCall: { callId: CALL_ID, duplex: true, utteranceId, ...extra },
    });
    const partial = await send("[gate:nB] And And Just wondering if you will be.", "utt-nB-partial", { speculative: true });
    expect(partial.status, JSON.stringify(partial.body)).toBe(202);
    expect(partial.body.parallel).toBeUndefined();
    const final = await send("[gate:nB] And And Just wondering if you would be able to check the ticket", "utt-nB-final", { continues: true });
    expect(final.status, JSON.stringify(final.body)).toBe(202);
    expect(final.body.parallel).toBeUndefined();
    open("thinkN");
    open("nB");
    await waitFor(async () => (await messages(bot.threadId)).some((m) => m.role === "bot" && m.kind === "text" && m.text?.includes("would be able to")),
      "the final words answered");
    await waitFor(async () => (await tasks(bot.id)).every((task) => !task.busy), "the call settled");
    const thread = await messages(bot.threadId);
    expect(thread.filter((m) => m.parallelTask)).toEqual([]);
    expect(await tasks(bot.id)).toHaveLength(1);
    const answers = thread.filter((m) => m.role === "bot" && m.kind === "text" && m.text?.startsWith("reply to:"));
    expect(answers.map((m) => m.text)).toEqual([expect.stringContaining("would be able to check the ticket")]);
  }, 60_000);

  it("#4216: a new request B said while A runs a tool starts beside A as a parallel task, A is not cancelled", async () => {
    const bot = await busyCall("besideA");
    const b = await api("POST", `/api/bots/${bot.id}/messages`, {
      threadId: bot.threadId,
      ...voice("what time is it in Tokyo", "utt-besideB"),
    });
    expect(b.status, JSON.stringify(b.body)).toBe(202);
    expect(b.body.parallel?.threadId).toBeTruthy();
    expect(b.body.queued).toBeUndefined();
    expect((await getBot(bot.id)).busy).toBe(true);
    await waitFor(async () => (await messages(bot.threadId)).some((m) => m.parallelTask?.role === "result"), "B's result in the conversation");
    // A still runs: B never waited for it
    expect((await tasks(bot.id)).find((task) => task.threadId === bot.threadId)?.busy).toBe(true);
    open("besideA");
    await waitFor(async () => (await tasks(bot.id)).every((task) => !task.busy), "the call settled");
    const thread = await messages(bot.threadId);
    expect(thread.filter((m) => m.parallelTask?.role === "request").map((m) => m.text)).toEqual(["what time is it in Tokyo"]);
    const answers = thread.filter((m) => m.role === "bot" && m.kind === "text" && m.text?.startsWith("reply to:") && !m.parallelTask);
    expect(answers.map((m) => m.text).join("\n")).toContain("look up the weather");
    expect(answers.map((m) => m.text).join("\n")).not.toContain("what time is it in Tokyo");
  }, 60_000);

  it("a) a correction B said while A runs a tool: B joins A's turn, A is not cancelled, no parallel task", async () => {
    const bot = await busyCall("joinA");
    const b = await api("POST", `/api/bots/${bot.id}/messages`, {
      threadId: bot.threadId,
      ...voice("also for that, what time is it in Tokyo", "utt-joinB"),
    });
    expect(b.status, JSON.stringify(b.body)).toBe(202);
    expect(b.body.parallel).toBeUndefined();
    expect((await tasks(bot.id))).toHaveLength(1);
    expect((await getBot(bot.id)).busy).toBe(true);
    open("joinA");
    await waitFor(async () => (await tasks(bot.id)).every((task) => !task.busy)
      && !(await messages(bot.threadId)).some((m) => m.role === "user" && m.queued), "the call settled");
    const thread = await messages(bot.threadId);
    expect(thread.filter((m) => m.parallelTask)).toEqual([]);
    const answers = thread.filter((m) => m.role === "bot" && m.kind === "text" && m.text?.startsWith("reply to:"));
    expect(answers.map((m) => m.text).join("\n")).toContain("look up the weather");
    expect(answers.map((m) => m.text).join("\n")).toContain("what time is it in Tokyo");
  }, 60_000);

  it("a continues send of a different utterance while A runs a tool joins A, no parallel task", async () => {
    const bot = await busyCall("contA");
    const b = await api("POST", `/api/bots/${bot.id}/messages`, {
      threadId: bot.threadId,
      text: "what time is it in Tokyo",
      voiceCall: { callId: CALL_ID, duplex: true, utteranceId: "utt-contB", continues: true },
    });
    expect(b.status, JSON.stringify(b.body)).toBe(202);
    expect(b.body.parallel).toBeUndefined();
    expect((await tasks(bot.id))).toHaveLength(1);
    open("contA");
    await waitFor(async () => (await tasks(bot.id)).every((task) => !task.busy), "the call settled");
    expect((await messages(bot.threadId)).filter((m) => m.parallelTask)).toEqual([]);
  }, 60_000);

  it("f) stop while A runs a tool cancels A and starts nothing", async () => {
    const bot = await busyCall("stopA");
    const stop = await api("POST", `/api/bots/${bot.id}/messages`, {
      threadId: bot.threadId,
      ...voice("stop", "utt-stop"),
    });
    expect(stop.status, JSON.stringify(stop.body)).toBe(202);
    expect(stop.body.parallel).toBeUndefined();
    await waitFor(async () => (await tasks(bot.id)).every((task) => !task.busy), "stop cancelled A");
    expect((await tasks(bot.id))).toHaveLength(1);
    expect((await messages(bot.threadId)).filter((m) => m.parallelTask)).toEqual([]);
  }, 60_000);
});
