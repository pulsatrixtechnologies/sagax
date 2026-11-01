// 2026-11-01 (JC: "it repeats itself several times"): a model that writes
// the same text before each step of one turn ("Let me check the ticket.")
// put one identical bubble in the chat per step. The real harness with the
// fake claude CLI, whose scripted turn writes the same assistant item
// three times, then its answer: the conversation keeps one copy of the
// repeated text and the answer, and a next turn may say it again.
//
// POSIX-gated like the other CLI e2es (the fake is a shebang script).
import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { freePortBlock } from "./testing/ports.ts";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const FAKE_CLAUDE = join(SERVER_DIR, "testing", "fake-claude-cli.ts");
const posixOnly = describe.skipIf(process.platform === "win32");

const REPEATED = "Let me check the ticket.";

posixOnly("one turn repeating the same text e2e", () => {
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
      await new Promise((r) => setTimeout(r, 100));
    }
  };

  beforeAll(async () => {
    chmodSync(FAKE_CLAUDE, 0o755);
    home = mkdtempSync(join(tmpdir(), "sagax-turn-repeat-"));
    mkdirSync(join(home, ".sagax"), { recursive: true });
    writeFileSync(join(home, ".sagax", "config.json"), JSON.stringify({
      instances: {
        claude: {
          driver: "claudeAgent",
          environment: {
            FAKE_CLAUDE_REPLIES: JSON.stringify([
              [REPEATED, REPEATED, `  ${REPEATED}\n`, "Ticket 4242 is closed."],
              [REPEATED, "Ticket 4243 is open."],
            ]),
            FAKE_CLAUDE_REPLY_STATE: join(home, "reply-state"),
          },
          config: { cli: FAKE_CLAUDE, permissionMode: "bypassPermissions" },
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

  it("keeps one copy of text a turn repeats, and lets the next turn say it again", async () => {
    const bot = (await api("POST", "/api/bots")).body.bot;
    await api("PATCH", `/api/bots/${bot.id}`, { modelSelection: { instanceId: "claude", model: "claude-fake" } });
    // what the bot wrote after the person's first line (its greeting stays out)
    const botText = async () => {
      const rows = await messages(bot.threadId);
      const first = rows.findIndex((m) => m.role === "user");
      return rows.slice(first).filter((m) => m.role === "bot" && m.kind === "text").map((m) => m.text.trim());
    };

    expect((await api("POST", `/api/bots/${bot.id}/messages`, { text: "Is ticket 4242 closed?", threadId: bot.threadId })).status).toBe(202);
    await waitFor(async () => (await botText()).includes("Ticket 4242 is closed."), "the first answer");
    await waitFor(async () => (await getBot(bot.id)).busy === false, "the first turn to settle");
    expect(await botText()).toEqual([REPEATED, "Ticket 4242 is closed."]);

    expect((await api("POST", `/api/bots/${bot.id}/messages`, { text: "And 4243?", threadId: bot.threadId })).status).toBe(202);
    await waitFor(async () => (await botText()).includes("Ticket 4243 is open."), "the second answer");
    await waitFor(async () => (await getBot(bot.id)).busy === false, "the second turn to settle");
    expect(await botText()).toEqual([REPEATED, "Ticket 4242 is closed.", REPEATED, "Ticket 4243 is open."]);
  }, 60_000);
});
