// Pre-warm (server/thread-prewarm.ts), end to end through the real server
// and the fake Claude CLI: POST /api/bots/:id/warm starts the thread's engine
// with no transcript row; the next message reuses that process (one launch,
// no relaunch); with no message the idle process is closed after the window;
// a confidential thread and a busy one are never warmed.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, it } from "vitest";

import { launchVerificationServer } from "../scripts/control-omb.ts";

async function fixture() {
  const server = await launchVerificationServer({ ...process.env, SAGAX_PREWARM_WINDOW_MS: "3000" });
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
  const wrapper = join(dataDir, "warm-claude.mjs");
  writeFileSync(wrapper, [
    "#!/usr/bin/env node",
    'import { appendFileSync } from "node:fs";',
    `if (process.argv.includes("--input-format")) appendFileSync(${JSON.stringify(launches)}, JSON.stringify({ pid: process.pid }) + "\\n");`,
    'process.stdin.on("end", () => process.exit(0));',
    `await import(${JSON.stringify(pathToFileURL(fileURLToPath(new URL("./testing/fake-claude-cli.ts", import.meta.url))).href)});`,
  ].join("\n"), { mode: 0o700 });
  await api("PATCH", "/api/instances/claude", { cli: wrapper });
  const bot = (await api("POST", "/api/bots", { name: "Warmy" }, 201)).bot;
  const pids = () => (existsSync(launches) ? readFileSync(launches, "utf8").trim().split("\n").filter(Boolean).map((line) => (JSON.parse(line) as { pid: number }).pid) : []);
  const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
  const messages = async (threadId: string) => (await api("GET", `/api/threads/${threadId}/messages?limit=200`)).messages as any[];
  const log = () => readFileSync(logPath, "utf8");
  return { server, api, bot, pids, alive, messages, log };
}

it("warms the conversation, the first message reuses that process, and an unused warm is closed", async () => {
  const t = await fixture();
  try {
    const thread = t.bot.threadId as string;
    const before = await t.messages(thread);
    expect((await t.api("POST", `/api/bots/${t.bot.id}/warm`, { threadId: thread })).warm).toBe("started");
    await expect.poll(() => t.pids().length, { timeout: 15_000 }).toBe(1);
    // a second call (the person keeps typing) only pushes the window back
    expect((await t.api("POST", `/api/bots/${t.bot.id}/warm`, { threadId: thread })).warm).toBe("extended");
    expect(await t.messages(thread)).toEqual(before);
    await t.api("POST", `/api/bots/${t.bot.id}/messages`, { threadId: thread, text: "hello" }, 202);
    await expect.poll(async () => (await t.messages(thread)).filter((m) => m.role === "bot" && m.turnTerminal).length, { timeout: 15_000 }).toBe(1);
    expect(t.pids()).toHaveLength(1);
    expect(t.log()).not.toMatch(/relaunch: spawn contract changed/);
    // the window passing never closes a process a turn took over
    await new Promise((resolve) => setTimeout(resolve, 4_000));
    expect(t.alive(t.pids()[0]!)).toBe(true);
    // already warm: nothing new starts
    expect((await t.api("POST", `/api/bots/${t.bot.id}/warm`, { threadId: thread })).warm).toBe("skipped");

    // a new conversation warmed and never used: closed after the window
    const other = (await t.api("POST", `/api/bots/${t.bot.id}/tasks`, {}, 201)).task.threadId as string;
    expect((await t.api("POST", `/api/bots/${t.bot.id}/warm`, { threadId: other })).warm).toBe("started");
    await expect.poll(() => t.pids().length, { timeout: 15_000 }).toBe(2);
    const idle = t.pids()[1]!;
    await expect.poll(() => t.alive(idle), { timeout: 15_000 }).toBe(false);
    expect(await t.messages(other)).toEqual([]);
  } finally {
    await t.server.close();
  }
}, 120_000);

it("never warms a confidential conversation", async () => {
  const t = await fixture();
  try {
    const secret = (await t.api("POST", `/api/bots/${t.bot.id}/tasks`, { title: "Projet", confidential: true }, 201)).task.threadId as string;
    expect((await t.api("POST", `/api/bots/${t.bot.id}/warm`, { threadId: secret })).warm).toBe("skipped");
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    expect(t.pids()).toHaveLength(0);
    await t.api("POST", `/api/bots/${t.bot.id}/warm`, { threadId: "not a thread" }, 400);
    await t.api("POST", "/api/bots/nobody/warm", { threadId: t.bot.threadId }, 404);
  } finally {
    await t.server.close();
  }
}, 120_000);
