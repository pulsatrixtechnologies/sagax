// The console's Test for a stdio MCP server (POST connections/test, kind
// mcp): a real command started from a tiny fake server script
// (server/testing/fake-stdio-mcp.mjs), through the route.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Duplex } from "node:stream";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

import { testStdioMcpCommand, testStdioMcpStream, type StdioTestServer } from "./mcp-stdio-test.ts";
import { opsRoutes, type OpsDeps } from "./org/org-admin-ops.ts";
import { fakeConsole } from "./testing/console-context.ts";

const FAKE = fileURLToPath(new URL("./testing/fake-stdio-mcp.mjs", import.meta.url));
const SECRET = "sk-fake-secret-value-123456";
const dir = mkdtempSync(join(tmpdir(), "sagax-stdio-test-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const server = (mode: string, extra: Record<string, string> = {}): StdioTestServer => ({
  command: process.execPath,
  args: [FAKE],
  env: { FAKE_MCP_MODE: mode, FAKE_MCP_SECRET: SECRET, ...extra },
});

function routes(servers: Record<string, StdioTestServer>, timeoutMs = 4_000) {
  const deps = {
    test: async (kind, id) => {
      if (kind !== "mcp") return null;
      const configured = servers[id];
      return configured ? testStdioMcpCommand(configured, { timeoutMs }) : { ok: false, reason: "not_found", label: "No MCP server with that name." };
    },
  } as Pick<OpsDeps, "test"> as OpsDeps;
  return fakeConsole(opsRoutes(deps));
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

async function gone(pid: number): Promise<boolean> {
  for (let i = 0; i < 50; i += 1) {
    if (!alive(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return !alive(pid);
}

describe("connections/test for a stdio MCP server", () => {
  it("starts the command, completes the handshake, counts the tools and stops it", async () => {
    const pidFile = join(dir, "ok.pid");
    const console = routes({ local: server("ok", { FAKE_MCP_PID_FILE: pidFile }) });
    const answer = await console.call("POST", "connections/test", { body: { kind: "mcp", id: "local" } });
    expect(answer.status).toBe(200);
    expect(answer.body).toEqual({ ok: true, latencyMs: expect.any(Number), reason: null, label: "The server answered with 2 tools." });
    expect(console.records.at(-1)).toMatchObject({ category: "mcp", action: "connections.test", target: { kind: "mcp", id: "local" }, after: { ok: true } });
    expect(await gone(Number(readFileSync(pidFile, "utf8")))).toBe(true);
  });

  it("reports the exit code of a command that stops before the handshake", async () => {
    const answer = await routes({ local: server("exit") }).call("POST", "connections/test", { body: { kind: "mcp", id: "local" } });
    expect(answer.body).toMatchObject({ ok: false, reason: "exited", label: expect.stringContaining("exit code 3") });
  });

  it("reports a refused handshake without the configured values", async () => {
    const answer = await routes({ local: server("refuse") }).call("POST", "connections/test", { body: { kind: "mcp", id: "local" } });
    expect(answer.body).toMatchObject({ ok: false, reason: "handshake_refused", label: expect.stringContaining("bad key [redacted]") });
    expect(JSON.stringify(answer)).not.toContain(SECRET);
  });

  it("times out a command that never answers, and stops it", async () => {
    const pidFile = join(dir, "hang.pid");
    const answer = await routes({ local: server("hang", { FAKE_MCP_PID_FILE: pidFile }) }, 400).call("POST", "connections/test", { body: { kind: "mcp", id: "local" } });
    expect(answer.body).toMatchObject({ ok: false, reason: "timeout", label: expect.stringContaining("initialize") });
    expect(await gone(Number(readFileSync(pidFile, "utf8")))).toBe(true);
  });

  it("reports a command that cannot start", async () => {
    const answer = await routes({ local: { command: join(dir, "missing-binary"), args: [], env: { TOKEN: SECRET } } }).call("POST", "connections/test", { body: { kind: "mcp", id: "local" } });
    expect(answer.body).toMatchObject({ ok: false, reason: "spawn_failed" });
    expect(JSON.stringify(answer)).not.toContain(SECRET);
  });

  it("never answers 501 for an MCP line", async () => {
    expect((await routes({}).call("POST", "connections/test", { body: { kind: "mcp", id: "ghost" } })).body).toMatchObject({ ok: false, reason: "not_found" });
  });

  it("runs a person's command over their server environment's stream", async () => {
    const toServer: string[] = [];
    // A duplex where what the test writes is read back as the server's answers.
    const duplex = new Duplex({
      read() {},
      write(chunk, _encoding, done) {
        const frame = JSON.parse(String(chunk));
        toServer.push(frame.method);
        if (frame.method === "initialize") duplex.push(`${JSON.stringify({ jsonrpc: "2.0", id: frame.id, result: { capabilities: {} } })}\n`);
        if (frame.method === "tools/list") duplex.push(`${JSON.stringify({ jsonrpc: "2.0", id: frame.id, result: { tools: [{ name: "one" }] } })}\n`);
        done();
      },
    });
    const result = await testStdioMcpStream(async () => duplex, server("ok"));
    expect(result).toEqual({ ok: true, reason: null, label: "The server answered with 1 tool." });
    expect(toServer).toEqual(["initialize", "notifications/initialized", "tools/list"]);
    expect(duplex.destroyed).toBe(true);
    const refused = await testStdioMcpStream(async () => { throw new Error(`denied ${SECRET}`); }, server("ok"));
    expect(refused).toMatchObject({ ok: false, reason: "environment_refused" });
    expect(JSON.stringify(refused)).not.toContain(SECRET);
  });
});
