// A message written while the bot works is read without waiting for the
// end of the turn (2026-10-28).
// - An engine that takes words live (the fake claude CLI, `slow`): the
//   words are steered into the running turn and the CLI reads them before
//   the turn ends.
// - An engine that cannot (the fake ACP CLI, `echo-gated`, honoring
//   session/cancel): the turn is interrupted at its safe point and the
//   queue starts a turn with the words at once. Before, they waited for the
//   whole turn (here: forever, the gate never opens).
//
// POSIX-gated like the other CLI e2es (the fakes are shebang scripts).
import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { freePortBlock } from "./testing/ports.ts";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const FAKE_CLAUDE = join(SERVER_DIR, "testing", "fake-claude-cli.ts");
const FAKE_ACP = join(SERVER_DIR, "testing", "fake-acp-cli.ts");
const posixOnly = describe.skipIf(process.platform === "win32");

/** The bound a person feels as "right away". */
const SEEN_BUDGET_MS = 3_000;

posixOnly("messages read mid-turn e2e", () => {
  let child: ChildProcess;
  let home: string;
  let base = "";
  let stderr = "";
  let lastThread = "";

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
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}. rows: ${JSON.stringify((await messages(lastThread)).map((m) => [m.role, m.kind, (m.text ?? m.tool?.name ?? "").slice(0, 300)]))} stderr: ${stderr.slice(-1500)}`);
      await new Promise((r) => setTimeout(r, 25));
    }
  };
  const busyBot = async (instanceId: string, first: string) => {
    const bot = (await api("POST", "/api/bots")).body.bot;
    lastThread = bot.threadId;
    await api("PATCH", `/api/bots/${bot.id}`, { modelSelection: { instanceId, model: instanceId === "claude" ? "claude-fake" : "fake-model" } });
    expect((await api("POST", `/api/bots/${bot.id}/messages`, { text: first, threadId: bot.threadId })).status).toBe(202);
    await waitFor(async () => (await getBot(bot.id)).busy === true, "the turn to start");
    if (instanceId === "claude") await waitFor(async () => (await messages(bot.threadId)).some((m) => m.kind === "activity"), "the tool chip");
    else await waitFor(async () => existsSync(join(home, "acp-started")), "the prompt to reach the agent");
    return bot as { id: string; threadId: string };
  };

  beforeAll(async () => {
    chmodSync(FAKE_CLAUDE, 0o755);
    chmodSync(FAKE_ACP, 0o755);
    home = mkdtempSync(join(tmpdir(), "sagax-live-steer-"));
    mkdirSync(join(home, ".sagax"), { recursive: true });
    mkdirSync(join(home, "gates"), { recursive: true });
    writeFileSync(join(home, ".sagax", "config.json"), JSON.stringify({
      instances: {
        claude: {
          driver: "claudeAgent",
          environment: { FAKE_CLAUDE_MODE: "slow", FAKE_CLAUDE_GATE_DIR: join(home, "gates"), FAKE_CLAUDE_STEER_RECEIVED: join(home, "steer-received") },
          config: { cli: FAKE_CLAUDE, permissionMode: "bypassPermissions" },
        },
        gemini: {
          driver: "geminiAgent",
          environment: { GEMINI_API_KEY: "gemini-test-key", FAKE_ACP_MODE: "echo-gated", FAKE_ACP_GATE_FILE: join(home, "acp-gate"), FAKE_ACP_HONOR_CANCEL: "1", FAKE_ACP_STARTED_FILE: join(home, "acp-started") },
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

  it("an engine that takes words live reads them inside the running turn", async () => {
    const bot = await busyBot("claude", "[gate:main] audit the invoices");
    const started = Date.now();
    const sent = await api("POST", `/api/bots/${bot.id}/messages`, { text: "only the paid ones", threadId: bot.threadId, routeWhileBusy: true });
    expect(sent.body.steered, JSON.stringify(sent.body)).toBe(true);
    await waitFor(async () => existsSync(join(home, "steer-received")), "the CLI to read the words", SEEN_BUDGET_MS);
    console.log(`[measure] claude: words read mid-turn in ${Date.now() - started} ms`);
    expect((await getBot(bot.id)).busy).toBe(true);
    writeFileSync(join(home, "gates", "main"), "go");
    await waitFor(async () => (await getBot(bot.id)).busy === false, "the turn to end");
  }, 60_000);

  it.each([
    ["a send that names no mode", false],
    ["an app send (auto)", true],
  ])("an engine that cannot steer: %s is answered at once, not after the turn", async (_label, auto) => {
    rmSync(join(home, "acp-started"), { force: true });
    rmSync(join(home, "acp-gate"), { force: true });
    const bot = await busyBot("gemini", "audit the September invoices");
    rmSync(join(home, "acp-started"), { force: true });
    const started = Date.now();
    const text = "actually only the paid ones";
    const sent = await api("POST", `/api/bots/${bot.id}/messages`, { text, threadId: bot.threadId, ...(auto ? { routeWhileBusy: true } : {}) });
    expect(sent.status, JSON.stringify(sent.body)).toBe(202);
    expect(sent.body.queued, JSON.stringify(sent.body)).toBe(true);
    expect(sent.body.preempting).toBe(true);
    // a new prompt reaches the agent while the first turn's work was pending
    await waitFor(async () => existsSync(join(home, "acp-started")), "a turn that reads the words", SEEN_BUDGET_MS);
    console.log(`[measure] acp (${_label}): words sent to the engine after ${Date.now() - started} ms`);
    writeFileSync(join(home, "acp-gate"), "go");
    // that turn carries the words and the note saying why the work paused
    await waitFor(async () => (await messages(bot.threadId)).some((m) => m.role === "bot" && m.kind === "text" && m.text?.includes(text) && m.text.includes("paused at a safe step")), "the answer to the words");
    expect(stderr).toMatch(/\[safe-point\] .* interrupted to read a waiting message/);
    const rows = await messages(bot.threadId);
    expect(rows.filter((m) => m.role === "user" && m.text === text)).toHaveLength(1);
    await waitFor(async () => (await getBot(bot.id)).busy === false, "the turn to end");
  }, 60_000);
});
