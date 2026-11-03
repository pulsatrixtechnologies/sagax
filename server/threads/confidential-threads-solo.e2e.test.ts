// Confidential threads on a solo server (server/threads/confidential-threads.ts):
// the bot acts for the operator at this computer (act, no session), and the
// operator's own selected thread is confidential. The act request is marked
// on-behalf by this server (a process secret header), so it never reaches
// that thread: its listing comes back without the confidential thread.
import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { removeTempDir, waitForExit } from "../testing/cleanup.ts";
import { freePortBlock } from "../testing/ports.ts";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const FAKE_CLAUDE = join(SERVER_DIR, "..", "testing", "fake-claude-cli.ts");
const posixOnly = describe.skipIf(process.platform === "win32");
const SECRET = "OPERATORSECRET";

let PORT = 0;
let BASE = "";
let child: ChildProcess;
let home = "";
let mcpDump = "";
let log = "";

const api = async (method: string, path: string, body?: unknown): Promise<{ status: number; body: any; text: string }> => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body !== undefined ? { "content-type": "application/json" } : {},
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: any = {};
  try { parsed = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, body: parsed, text };
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor<T>(read: () => Promise<T | null | undefined | false>, ms = 60_000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out. server log:\n${log.slice(-3000)}`);
    await sleep(150);
  }
}
type Message = { role: string; kind: string; text?: string };
const messagesOf = async (threadId: string): Promise<Message[]> => ((await api("GET", `/api/threads/${threadId}/messages`)).body.messages ?? []) as Message[];
const replied = (messages: Message[], after: number) => messages.slice(after).some((m) => m.role === "bot" && m.kind === "text" && m.text);
const readDump = (): Array<{ tool: string; ok: boolean; text?: string }> => {
  try { return (JSON.parse(readFileSync(mcpDump, "utf8")) as { calls: Array<{ tool: string; ok: boolean; text?: string }> }).calls; } catch { return []; }
};

posixOnly("confidential thread on a solo server: the operator's bot acts", () => {
  beforeAll(async () => {
    chmodSync(FAKE_CLAUDE, 0o755);
    PORT = await freePortBlock([0, 1]);
    BASE = `http://127.0.0.1:${PORT}`;
    home = mkdtempSync(join(tmpdir(), "omb-confidential-solo-"));
    mcpDump = join(home, "mcp-dump.json");
    const data = join(home, ".sagax");
    mkdirSync(data, { recursive: true });
    await start([{ server: "agents", tool: "act", arguments: { method: "GET", path: "/api/bots" }, when: "ACT-LIST" }]);
  }, 40_000);

  async function start(calls: unknown[]) {
    const data = join(home, ".sagax");
    const config = (() => { try { return JSON.parse(readFileSync(join(data, "config.json"), "utf8")) as Record<string, unknown>; } catch { return {}; } })();
    writeFileSync(join(data, "config.json"), JSON.stringify({
      ...config,
      instances: {
        claude: {
          driver: "claudeAgent",
          environment: { FAKE_CLAUDE_MCP_DUMP: mcpDump, FAKE_CLAUDE_MCP_TEXT_LIMIT: "200000", FAKE_CLAUDE_MCP_CALLS: JSON.stringify(calls) },
          config: { cli: FAKE_CLAUDE, fullAuto: true },
        },
      },
    }));
    child = spawn(process.execPath, [join(SERVER_DIR, "..", "index.ts")], {
      cwd: join(SERVER_DIR, "..", ".."),
      env: {
        ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
        HOME: home, USERPROFILE: home, SAGAX_LOCAL_VM_TEST_NAMESPACE: process.env.SAGAX_LOCAL_VM_TEST_NAMESPACE ?? "", SAGAX_PORT: String(PORT), SAGAX_WEBHOOK_PORT: String(PORT + 1),
        SAGAX_ANTHROPIC_API_KEY: "sk-ant-test-key",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout!.on("data", (c) => (log += c));
    child.stderr!.on("data", (c) => (log += c));
    await waitFor(async () => (await fetch(`${BASE}/api/health`).catch(() => null))?.ok, 20_000);
  }

  afterAll(async () => {
    child?.kill("SIGTERM");
    if (child) await waitForExit(child);
    if (home) removeTempDir(home);
  });

  it("an operator act lists nothing of the selected confidential thread", async () => {
    const created = await api("POST", "/api/bots", { name: "Solo" });
    expect(created.status, created.text).toBe(201);
    const botId = created.body.bot.id as string;
    expect((await api("PATCH", `/api/bots/${botId}`, { modelSelection: { instanceId: "claude", model: "fake-model" } })).status).toBe(200);
    const ordinary = created.body.bot.threadId as string;
    // the operator opens a confidential thread: it is the bot's selected one
    const secret = await api("POST", `/api/bots/${botId}/tasks`, { title: `Projet ${SECRET}`, confidential: true });
    expect(secret.status, secret.text).toBe(201);
    const secretThread = secret.body.task.threadId as string;
    expect(((await api("GET", "/api/bots")).body.bots as Array<{ id: string; threadId: string }>).find((bot) => bot.id === botId)!.threadId).toBe(secretThread);
    const before = (await messagesOf(ordinary)).length;
    expect((await api("POST", `/api/bots/${botId}/messages`, { text: "ACT-LIST", threadId: ordinary })).status).toBe(202);
    await waitFor(async () => replied(await messagesOf(ordinary), before));
    const act = readDump().find((entry) => entry.tool === "act");
    expect(act?.ok, JSON.stringify(readDump())).toBe(true);
    expect(act!.text).toContain("Solo");
    expect(act!.text).not.toContain(SECRET);
    expect(act!.text).not.toContain(secretThread);
  }, 120_000);
});
