// Stop right away (2026-10-28): a person who writes "stop", "attends" or
// "wait" while the bot works ends the running turn at once, on every engine,
// and the bot says so in one line. Before, only a handful of words stopped;
// "attends" was steered into the turn and read after the running tool, so the
// bot finished what it was doing first.
//
// The real harness with two fake engines, each holding a long tool:
// - the fake claude CLI (`slow`, FAKE_CLAUDE_HOLD_AFTER_TOOL): a Bash call
//   that never returns until the turn ends;
// - the fake ACP CLI (`slow-tool`, gated, FAKE_ACP_HONOR_CANCEL): a `sleep`
//   that runs until session/cancel.
//
// POSIX-gated like the other CLI e2es (the fakes are shebang scripts).
import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { STOPPED_TURN_NAME } from "../shared/client-cancel.ts";
import { freePortBlock } from "./testing/ports.ts";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const FAKE_CLAUDE = join(SERVER_DIR, "testing", "fake-claude-cli.ts");
const FAKE_ACP = join(SERVER_DIR, "testing", "fake-acp-cli.ts");
const posixOnly = describe.skipIf(process.platform === "win32");

/** The bound a person feels as "right away". */
const STOP_BUDGET_MS = 2_000;

posixOnly("stop right away e2e", () => {
  let child: ChildProcess;
  let home: string;
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
  const waitFor = async (predicate: () => Promise<boolean>, what: string, ms = 30_000) => {
    const deadline = Date.now() + ms;
    while (!(await predicate())) {
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}. stderr: ${stderr.slice(-3000)}`);
      await new Promise((r) => setTimeout(r, 25));
    }
  };
  /** A bot whose turn is inside a long tool call. */
  const botInLongTool = async (instanceId: string) => {
    const bot = (await api("POST", "/api/bots")).body.bot;
    await api("PATCH", `/api/bots/${bot.id}`, { modelSelection: { instanceId, model: instanceId === "claude" ? "claude-fake" : "fake-model" } });
    expect((await api("POST", `/api/bots/${bot.id}/messages`, { text: "rebuild the whole project", threadId: bot.threadId })).status).toBe(202);
    await waitFor(async () => (await getBot(bot.id)).busy === true, "the turn to start");
    if (instanceId !== "deaf") await waitFor(async () => (await messages(bot.threadId)).some((m) => m.kind === "activity" && m.tool?.ok === undefined), "the long tool to run");
    return bot as { id: string; threadId: string };
  };
  /** Writes `text` mid-turn; how long until the bot is free again. */
  const stopWith = async (bot: { id: string; threadId: string }, text: string) => {
    const started = Date.now();
    const sent = await api("POST", `/api/bots/${bot.id}/messages`, { text, threadId: bot.threadId });
    expect(sent.status, JSON.stringify(sent.body)).toBe(200);
    expect(sent.body.stopped, JSON.stringify(sent.body)).toBe(true);
    await waitFor(async () => (await getBot(bot.id)).busy === false, "the turn to stop", 15_000);
    const elapsed = Date.now() - started;
    console.log(`[measure] stop "${text}" → free in ${elapsed} ms`);
    return elapsed;
  };

  beforeAll(async () => {
    chmodSync(FAKE_CLAUDE, 0o755);
    chmodSync(FAKE_ACP, 0o755);
    home = mkdtempSync(join(tmpdir(), "sagax-live-stop-"));
    mkdirSync(join(home, ".sagax"), { recursive: true });
    writeFileSync(join(home, ".sagax", "config.json"), JSON.stringify({
      instances: {
        claude: {
          driver: "claudeAgent",
          environment: { FAKE_CLAUDE_MODE: "slow", FAKE_CLAUDE_HOLD_AFTER_TOOL: "1", FAKE_CLAUDE_SLOW_FINISH_GATE: join(home, "never") },
          config: { cli: FAKE_CLAUDE, permissionMode: "bypassPermissions" },
        },
        grok: {
          driver: "grokAgent",
          environment: { FAKE_ACP_MODE: "slow-tool", FAKE_ACP_TOOL_GATE: join(home, "never"), FAKE_ACP_HONOR_CANCEL: "1" },
          config: { cli: FAKE_ACP, fullAuto: true },
        },
        // an agent that never answers session/cancel
        deaf: {
          driver: "grokAgent",
          environment: { FAKE_ACP_MODE: "echo-gated", FAKE_ACP_GATE_FILE: join(home, "never") },
          config: { cli: FAKE_ACP, fullAuto: true },
        },
      },
    }));
    const port = await freePortBlock([0, 1]);
    base = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, [join(SERVER_DIR, "index.ts")], {
      cwd: join(SERVER_DIR, ".."),
      env: { ...(process.env.PATH ? { PATH: process.env.PATH } : {}), HOME: home, USERPROFILE: home, SAGAX_PORT: String(port) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stderr!.on("data", (c) => (stderr += c));
    child.stdout!.on("data", (c) => (stderr += c));
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

  it.each([
    ["claude", "stop"],
    ["claude", "attends"],
    ["claude", "Wait!"],
    ["grok", "arrête"],
    ["grok", "laisse tomber"],
    ["deaf", "stop"],
  ])("%s: %j during a long tool stops the turn in under 2 s and says so in one line", async (engine, text) => {
    const bot = await botInLongTool(engine);
    const elapsed = await stopWith(bot, text);
    expect(elapsed).toBeLessThan(STOP_BUDGET_MS);
    const rows = await messages(bot.threadId);
    // the person's words are kept, answered by one confirmation line
    const asked = rows.findIndex((m) => m.role === "user" && m.text === text);
    expect(asked, JSON.stringify(rows.map((m) => [m.role, m.kind, m.text ?? m.tool?.name]))).toBeGreaterThan(-1);
    // the tool the stop cut short is closed, not left running
    const tool = engine === "deaf" ? { tool: { ok: true } } : rows.find((m) => m.kind === "activity" && m.tool?.name !== STOPPED_TURN_NAME && !m.tool?.name?.startsWith("stopped:"));
    expect(tool?.tool?.ok, JSON.stringify(tool)).not.toBeUndefined();
    const confirmations = rows.filter((m) => m.role === "bot" && m.kind === "activity" && m.tool?.name === STOPPED_TURN_NAME);
    expect(confirmations).toHaveLength(1);
    // Stop stays final past the unfinished-turn guard's 500 ms relaunch:
    // a native ACP cancellation must not start a second provider turn.
    const stoppedTurnIds = [...new Set(rows.map((row) => row.turnId).filter(Boolean))];
    await new Promise((resolve) => setTimeout(resolve, 750));
    expect((await getBot(bot.id)).busy).toBe(false);
    expect([...new Set((await messages(bot.threadId)).map((row) => row.turnId).filter(Boolean))]).toEqual(stoppedTurnIds);
    // a new message after the stop starts a fresh turn
    expect((await api("POST", `/api/bots/${bot.id}/messages`, { text: "status?", threadId: bot.threadId })).status).toBe(202);
    await waitFor(async () => (await getBot(bot.id)).busy === true, "the next turn");
    await api("POST", `/api/bots/${bot.id}/interrupt`, { threadId: bot.threadId });
    await waitFor(async () => (await getBot(bot.id)).busy === false, "the next turn to stop");
  }, 60_000);
});
