// Slice 5: the stdio bridge an engine mounts per Perspicax profile
// (server/perspicax-mcp-bridge.ts), against a fake harness.
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type RequestListener, type Server } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const ENTRY = join(dirname(fileURLToPath(import.meta.url)), "perspicax-mcp-bridge.ts");
let child: ChildProcessWithoutNullStreams | null = null;
let server: Server | null = null;

async function listen(handler: RequestListener) {
  server = createServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("test server did not bind");
  return `http://127.0.0.1:${address.port}`;
}

function start(env: Record<string, string>) {
  child = spawn(process.execPath, ["--experimental-strip-types", ENTRY], {
    env: { ...process.env, ...env },
    stdio: ["pipe", "pipe", "pipe"],
  });
  return readline.createInterface({ input: child.stdout });
}

function nextJson(lines: readline.Interface) {
  return new Promise<Record<string, any>>((resolve, reject) => {
    lines.once("line", (line) => {
      try { resolve(JSON.parse(line)); } catch (error) { reject(error); }
    });
  });
}

afterEach(async () => {
  child?.kill("SIGKILL");
  child = null;
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = null;
});

describe("Perspicax MCP bridge", () => {
  it("posts each frame to the harness with the capability and writes the answer as one line", async () => {
    const received: Array<{ url: string; authorization?: string; body: any }> = [];
    const harness = await listen((request, response) => {
      let body = "";
      request.on("data", (chunk) => { body += chunk; });
      request.on("end", () => {
        const frame = JSON.parse(body);
        received.push({ url: request.url ?? "", authorization: request.headers.authorization, body: frame });
        if (frame.id === undefined) {
          response.writeHead(202);
          response.end();
          return;
        }
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ jsonrpc: "2.0", id: frame.id, result: { tools: [{ name: "api_list" }] } }));
      });
    });
    const lines = start({ SAGAX_HARNESS_URL: harness, SAGAX_PERSPICAX_TOKEN: "turn-capability", SAGAX_PERSPICAX_PROFILE: "P1", SAGAX_BOT_ID: "bot1", SAGAX_THREAD_ID: "th1" });
    child!.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
    child!.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 7, method: "tools/list" })}\n`);
    expect(await nextJson(lines)).toEqual({ jsonrpc: "2.0", id: 7, result: { tools: [{ name: "api_list" }] } });
    expect(received).toHaveLength(2);
    expect(received[1]).toEqual({
      url: "/api/internal/perspicax/mcp?profile=P1&botId=bot1&fromThreadId=th1",
      authorization: "Bearer turn-capability",
      body: { jsonrpc: "2.0", id: 7, method: "tools/list" },
    });
  });

  it("reads the current turn's capability from its file on every frame (a kept process)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "px-bridge-"));
    const file = join(dir, "cap");
    writeFileSync(file, "warm-cap", { mode: 0o600 });
    const seen: string[] = [];
    const harness = await listen((request, response) => {
      let body = "";
      request.on("data", (chunk) => { body += chunk; });
      request.on("end", () => {
        seen.push(request.headers.authorization ?? "");
        const frame = JSON.parse(body);
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ jsonrpc: "2.0", id: frame.id, result: {} }));
      });
    });
    const lines = start({ SAGAX_HARNESS_URL: harness, SAGAX_PERSPICAX_TOKEN: "launch-cap", SAGAX_PERSPICAX_TOKEN_FILE: file, SAGAX_PERSPICAX_PROFILE: "P1" });
    child!.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })}\n`);
    await nextJson(lines);
    writeFileSync(file, "turn-cap");
    child!.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" })}\n`);
    await nextJson(lines);
    rmSync(file);
    child!.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/list" })}\n`);
    await nextJson(lines);
    expect(seen).toEqual(["Bearer warm-cap", "Bearer turn-cap", "Bearer launch-cap"]);
    rmSync(dir, { recursive: true, force: true });
  });

  it("answers Perspicax is unavailable when the harness refuses or cannot be reached", async () => {
    const harness = await listen((request, response) => {
      request.resume();
      request.on("end", () => {
        response.writeHead(401, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "unauthorized" }));
      });
    });
    const lines = start({ SAGAX_HARNESS_URL: harness, SAGAX_PERSPICAX_TOKEN: "expired", SAGAX_PERSPICAX_PROFILE: "P1" });
    child!.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "api_list" } })}\n`);
    expect(await nextJson(lines)).toEqual({ jsonrpc: "2.0", id: 1, error: { code: -32000, message: "Perspicax is unavailable" } });
    child!.kill("SIGKILL");
    const closed = start({ SAGAX_HARNESS_URL: "http://127.0.0.1:9", SAGAX_PERSPICAX_TOKEN: "x", SAGAX_PERSPICAX_PROFILE: "P1" });
    child!.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: "a", method: "tools/list" })}\n`);
    expect(await nextJson(closed)).toEqual({ jsonrpc: "2.0", id: "a", error: { code: -32000, message: "Perspicax is unavailable" } });
  });
});
