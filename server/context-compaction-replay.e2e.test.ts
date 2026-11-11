// Sagax-controlled compaction for an engine that is handed the stored
// transcript every turn (the OpenAI chat drivers): only the newest
// context.rebuildBytes of the thread reach it, so older turns would fall off
// unsummarized. Sagax folds them into a private summary first, without a
// chat row, and the next request carries that summary instead. The provider
// is an in-process OpenAI-compatible stub recording each request.
import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { freePortBlock } from "./testing/ports.ts";
import { removeTempDir, waitForExit } from "./testing/cleanup.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
let child: ChildProcess;
let home = "";
let data = "";
let base = "";
let stderr = "";
let upstream: Server;
type ChatRequest = { messages: Array<{ role: string; content?: unknown }>; stream?: boolean };
const requests: ChatRequest[] = [];

const frame = (delta: unknown, finish: string | null) => `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
const api = async (method: string, path: string, body?: unknown) => {
  const r = await fetch(base + path, { method, headers: { "content-type": "application/json", origin: base }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const result = await r.json() as any;
  expect(r.ok, `${method} ${path}: ${JSON.stringify(result)}`).toBe(true);
  return result;
};
async function until<T>(read: () => T | Promise<T>, accept: (value: T) => boolean): Promise<T> {
  const end = Date.now() + 20_000;
  for (;;) {
    const value = await read();
    if (accept(value)) return value;
    if (Date.now() >= end) throw new Error(`Fixture wait expired: ${JSON.stringify(value)}\n${stderr.slice(-3000)}`);
    await new Promise(r => setTimeout(r, 50));
  }
}
const text = (request: ChatRequest) => JSON.stringify(request.messages);
const isSummary = (request: ChatRequest) => text(request).includes("Summarize this conversation history");
// A chat turn streams; helper calls (the summary, memory capture) do not.
const isTurn = (request: ChatRequest & { stream?: boolean }) => request.stream !== false;

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), "omb-replay-compact-"));
  upstream = createServer(async (req, res) => {
    if (req.url === "/v1/models") { res.setHeader("content-type", "application/json"); return res.end(JSON.stringify({ data: [{ id: "fixture-model" }] })); }
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const request = JSON.parse(raw || "{}") as ChatRequest & { stream?: boolean };
    requests.push(request);
    const reply = isSummary(request) ? "SUMMARY_MARKER the user settled on port 9001." : "Noted.";
    if (request.stream === false) {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ choices: [{ index: 0, message: { role: "assistant", content: reply }, finish_reason: "stop" }] }));
    }
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.end(frame({ content: reply }, "stop") + "data: [DONE]\n\n");
  });
  await new Promise<void>(resolve => upstream.listen(0, "127.0.0.1", resolve));
  const upstreamPort = (upstream.address() as { port: number }).port;
  data = join(home, "data");
  const ui = join(home, "static");
  mkdirSync(data);
  mkdirSync(join(ui, "assets"), { recursive: true });
  writeFileSync(join(ui, "index.html"), "<title>replay compaction</title>");
  writeFileSync(join(ui, "assets", "test.css"), "body{}");
  // The smallest replay budget, so a few long messages overflow it.
  writeFileSync(join(data, "config.json"), JSON.stringify({ context: { rebuildBytes: 2_048 } }));
  const port = await freePortBlock([0, 1]);
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ["--experimental-strip-types", join(ROOT, "server/index.ts")], {
    cwd: ROOT,
    env: {
      PATH: [dirname(process.execPath), "/usr/bin", "/bin"].join(":"),
      HOME: home, USERPROFILE: home, SAGAX_DATA_DIR: data,
      TEMP: home, TMP: home, TMPDIR: home,
      SAGAX_PORT: String(port), SAGAX_WEBHOOK_PORT: String(port + 1), SAGAX_STATIC_DIR: ui,
      SAGAX_USER_DATA: join(home, "user-data"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout!.on("data", () => {});
  child.stderr!.on("data", c => { stderr += c; });
  await until(async () => {
    if (child.exitCode !== null) throw new Error(stderr);
    try { return (await fetch(base + "/api/health")).ok; } catch { return false; }
  }, Boolean);
  await api("PATCH", "/api/config", { openaiCompat: { key: "fixture-key", url: `http://127.0.0.1:${upstreamPort}/v1`, model: "fixture-model" } });
}, 30_000);

afterAll(async () => {
  if (child) await waitForExit(child, { signal: "SIGTERM" });
  if (upstream) await new Promise<void>(resolve => upstream.close(() => resolve()));
  if (home) await removeTempDir(home);
});

describe("Sagax compaction for a transcript-replay engine", () => {
  it("folds older turns into a private summary before the replay budget would drop them", async () => {
    const { bot } = await api("POST", "/api/bots", { name: "Replay probe" });
    await api("PATCH", `/api/bots/${bot.id}/model`, { instanceId: "openaiCompat", model: "fixture-model" });
    const task = () => JSON.parse(readFileSync(join(data, "bots.json"), "utf8")).find((b: any) => b.id === bot.id).tasks.find((t: any) => t.threadId === bot.threadId);
    const send = async (message: string) => {
      const before = requests.filter(isTurn).length;
      await api("POST", `/api/bots/${bot.id}/messages`, { text: message });
      await until(() => requests.filter(isTurn).length, n => n > before);
      await until(() => api("GET", "/api/bots?messages=0"), s => !s.bots.find((b: any) => b.id === bot.id)?.busy);
    };
    const filler = "x".repeat(200);
    await send(`GOAL_FIRST use port 9001 for the service. ${filler}`);
    for (let i = 1; i <= 8; i++) await send(`STEP_${i} ${filler}`);
    await send("LATEST what port again?");
    // The thread's bookkeeping is written off the event loop, within a second (#3663).
    await expect.poll(() => (task().contextSummaries ?? []).length, { timeout: 5_000 }).toBeGreaterThanOrEqual(1);
    const folds = task().contextSummaries ?? [];
    expect(folds.length).toBeGreaterThanOrEqual(1);
    expect(folds.at(-1).summary).toContain("SUMMARY_MARKER");
    // Nothing in the chat says a fold happened.
    const { messages } = await api("GET", `/api/threads/${bot.threadId}/messages`);
    expect(messages.filter((m: any) => m.kind === "compaction")).toEqual([]);
    expect(JSON.stringify(messages.filter((m: any) => m.role === "bot"))).not.toMatch(/compact|summar/i);
    // The last request carries the summary in place of the dropped turns,
    // and still ends with the person's newest message word for word.
    const last = requests.filter(isTurn).at(-1)!;
    expect(text(last)).toContain("Earlier conversation summary");
    expect(text(last)).toContain("SUMMARY_MARKER");
    expect(JSON.stringify(last.messages.at(-1))).toContain("LATEST what port again?");
    expect(text(last)).not.toContain("omitted from this context");
  }, 90_000);
});
