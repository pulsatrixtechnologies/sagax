// POST /api/internal/routine-run end to end against the real harness server:
// the run_routine tool's route starts a routine of the calling bot only.
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { removeTempDir, waitForExit } from "../testing/cleanup.ts";
import { freePortBlock } from "../testing/ports.ts";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(SERVER_DIR, "..");
const FAKE_CLAUDE = join(SERVER_DIR, "testing", "fake-claude-cli.ts");
const TEST_CAPABILITY_KEY = "routine-run-fixture-capability-key-01";

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
  home = mkdtempSync(join(tmpdir(), "omb-routine-run-"));
  data = join(home, ".sagax");
  const staticDir = join(home, "static");
  mkdirSync(data, { recursive: true });
  mkdirSync(staticDir, { recursive: true });
  writeFileSync(join(staticDir, "index.html"), "<!doctype html><title>routine run test</title>");
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
  const deadline = Date.now() + 20_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`server exited ${child.exitCode}: ${stderr}`);
    try {
      if ((await fetch(`${base}/api/health`)).status === 200) break;
    } catch {
      // still starting
    }
    if (Date.now() >= deadline) throw new Error(`server never became healthy: ${stderr}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}, 30_000);

afterAll(async () => {
  if (child) await waitForExit(child, { signal: "SIGTERM" });
  if (home) await removeTempDir(home);
});

const createBot = async (name: string) =>
  (await api("POST", "/api/bots", { name, description: "fixture", modelSelection: { instanceId: "plain", model: "claude-sonnet-5" }, requireAvailableModel: true })).body.bot;
const threadOf = async (botId: string) => (await api("GET", "/api/bots")).body.bots.find((bot: { id: string }) => bot.id === botId).threadId as string;
const mint = async (botId: string, threadId: string): Promise<string> => {
  const minted = await api("POST", "/api/testing/internal-capability", { botId, threadId, kind: "agents", depth: 0 }, { "x-openmausbot-test-capability": TEST_CAPABILITY_KEY });
  expect(minted.status).toBe(201);
  return String(minted.body.token);
};
const routineFor = async (botId: string) => (await api("POST", "/api/routines", {
  name: "Report", prompt: "Report.", botId, enabled: false,
  schedule: { type: "interval", everyMinutes: 60, anchorAt: Date.now() + 3_600_000 },
})).body.routine.id as string;
const runRoutine = (token: string, body: unknown) => api("POST", "/api/internal/routine-run", body, { authorization: `Bearer ${token}` });

describe("POST /api/internal/routine-run (real server)", () => {
  it("starts the calling bot's own routine, leaving its schedule alone", async () => {
    const alpha = await createBot("Alpha");
    const routineId = await routineFor(alpha.id);
    const token = await mint(alpha.id, await threadOf(alpha.id));
    const started = await runRoutine(token, { routineId });
    expect(started.status).toBe(201);
    expect(started.body.runId).toEqual(expect.any(String));
    const listed = (await api("GET", "/api/routines")).body;
    expect(listed.runs.some((run: { id: string }) => run.id === started.body.runId)).toBe(true);
    expect(listed.routines.find((r: { id: string; enabled: boolean }) => r.id === routineId).enabled).toBe(false);
  });

  it("answers 404 for another bot's routine and for a missing id, and starts no run", async () => {
    const alpha = await createBot("Alpha two");
    const beta = await createBot("Beta");
    const betaRoutine = await routineFor(beta.id);
    const before = (await api("GET", "/api/routines")).body.runs.length;
    const token = await mint(alpha.id, await threadOf(alpha.id));
    expect((await runRoutine(token, { routineId: betaRoutine })).status).toBe(404);
    expect((await runRoutine(token, { routineId: "nope" })).status).toBe(404);
    expect((await runRoutine(token, {})).status).toBe(404);
    expect((await api("GET", "/api/routines")).body.runs.length).toBe(before);
  });

  it("answers 403 when the capability's thread is not the sender's, and 401 with no token", async () => {
    const alpha = await createBot("Alpha three");
    const beta = await createBot("Beta two");
    const routineId = await routineFor(alpha.id);
    const foreign = await mint(alpha.id, await threadOf(beta.id));
    expect((await runRoutine(foreign, { routineId })).status).toBe(403);
    expect((await api("POST", "/api/internal/routine-run", { routineId })).status).toBeGreaterThanOrEqual(401);
  });
});

describe("the other internal MCP routes (real server)", () => {
  const post = (token: string, path: string, body: unknown) => api("POST", path, body, { authorization: `Bearer ${token}` });

  it("/api/internal/perspicax/tool refuses an unknown tool, and a server not linked to Perspicax", async () => {
    const bot = await createBot("Gateway");
    const token = await mint(bot.id, await threadOf(bot.id));
    expect((await post(token, "/api/internal/perspicax/tool", { tool: "rm_rf", args: {} })).status).toBe(400);
    // api_query is not a Perspicax tool (the per-profile one is cw_psa_query, on the bridge).
    expect((await post(token, "/api/internal/perspicax/tool", { tool: "api_query", args: {} })).status).toBe(400);
    const linked = await post(token, "/api/internal/perspicax/tool", { tool: "api_search", args: { query: "tickets" } });
    expect(linked.status).toBe(409);
    expect(linked.body.error).toMatch(/not linked/);
  });

  it("/api/internal/mcp-audit writes a row without arguments to the admin activity log", async () => {
    const bot = await createBot("Audited");
    const token = await mint(bot.id, await threadOf(bot.id));
    const record = { at: new Date().toISOString(), principal: "p", role: "viewer", tool: "cw_psa_write", permission: "api:write", scope: "self", decision: "denied", reason: "not_granted", enforced: true, args: { secret: "hunter2" } };
    expect((await post(token, "/api/internal/mcp-audit", record)).status).toBe(200);
    expect((await post(token, "/api/internal/mcp-audit", { nothing: 1 })).status).toBe(400);
    // The rows are sealed on disk (#1263): read back through the
    // admin-activity route, the way the Activity view reads them.
    const rows = async (): Promise<any[]> => {
      const activity = await api("GET", "/api/admin-activity?what=all&limit=5000");
      return activity.status === 200 ? activity.body.entries : [];
    };
    await expect.poll(async () => (await rows()).map((row) => row.action), { timeout: 15_000 }).toContain("mcp.deny");
    const row = (await rows()).find((entry) => entry.action === "mcp.deny");
    expect(JSON.stringify(row)).toContain(bot.id);
    expect(JSON.stringify(row)).not.toContain("hunter2");
    // and never the arguments on disk, sealed or not
    const dir = join(data, "admin-activity");
    expect(readdirSync(dir).map((f) => readFileSync(join(dir, f), "utf8")).join("")).not.toContain("hunter2");
  });
});
