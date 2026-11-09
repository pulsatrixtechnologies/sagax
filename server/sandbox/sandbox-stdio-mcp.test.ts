import { Duplex } from "node:stream";
import { describe, expect, it } from "vitest";

import { SandboxStdioRelay } from "./sandbox-stdio-mcp.ts";
import type { SandboxStdioSpec } from "./sandboxd-core.ts";
import { personalStdioRelayRequest } from "../user-sandbox-proxy.ts";

/** A tiny MCP server on a stream: answers initialize, tools/list and
 * tools/call, asks its client for roots once, and records what it read. */
function fakeServer(seen: unknown[], options: { refuse?: string } = {}): Duplex {
  let buffer = "";
  const stream: Duplex = new Duplex({
    read() {},
    write(chunk: Buffer, _encoding, callback) {
      buffer += chunk.toString();
      let newline: number;
      while ((newline = buffer.indexOf("\n")) !== -1) {
        const frame = JSON.parse(buffer.slice(0, newline)) as { id?: number; method?: string; params?: { name?: string } };
        buffer = buffer.slice(newline + 1);
        seen.push(frame);
        const reply = (value: unknown) => stream.push(`${JSON.stringify(value)}\n`);
        if (frame.method === "initialize") {
          reply({ jsonrpc: "2.0", method: "notifications/message", params: { level: "info" } });
          reply({ jsonrpc: "2.0", id: 900, method: "roots/list" });
          reply({ jsonrpc: "2.0", id: frame.id, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "fake" } } });
        } else if (frame.method === "tools/list") {
          reply({ jsonrpc: "2.0", id: frame.id, result: { tools: [{ name: "whoami", inputSchema: { type: "object" } }] } });
        } else if (frame.method === "tools/call") {
          setTimeout(() => reply({ jsonrpc: "2.0", id: frame.id, result: { content: [{ type: "text", text: `called ${frame.params?.name}` }] } }), 5);
        }
      }
      callback();
    },
  });
  if (options.refuse) stream.push(`${JSON.stringify({ sagaxStdioError: options.refuse, message: "too many MCP servers are running in this environment" })}\n`);
  return stream;
}

const spec: SandboxStdioSpec = { argv: ["npx", "-y", "server"], env: { TOKEN: "t" } };
const base = { principalId: "pr_a", botId: "bot-1", threadId: "t-1", server: "tools", spec };

describe("SandboxStdioRelay", () => {
  it("relays requests and answers through one process per person, server and thread", async () => {
    const opened: Array<{ principalId: string; spec: SandboxStdioSpec }> = [];
    const seen: unknown[] = [];
    const relay = new SandboxStdioRelay({ open: async (principalId, given) => { opened.push({ principalId, spec: given }); return fakeServer(seen); } });
    const init = await relay.relay({ ...base, frame: { jsonrpc: "2.0", id: 1, method: "initialize", params: {} } });
    expect(init).toMatchObject({ id: 1, result: { serverInfo: { name: "fake" } } });
    expect(await relay.relay({ ...base, frame: { jsonrpc: "2.0", method: "notifications/initialized" } })).toBeNull();
    const [listed, called] = await Promise.all([
      relay.relay({ ...base, frame: { jsonrpc: "2.0", id: 2, method: "tools/list" } }),
      relay.relay({ ...base, frame: { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "whoami" } } }),
    ]);
    expect(listed).toMatchObject({ id: 2, result: { tools: [{ name: "whoami" }] } });
    expect(called).toMatchObject({ id: 3, result: { content: [{ text: "called whoami" }] } });
    expect(opened).toEqual([{ principalId: "pr_a", spec }]);
    // the server's own request to its client was answered "not supported"
    expect(seen).toContainEqual({ jsonrpc: "2.0", id: 900, error: { code: -32601, message: "Not supported by Sagax." } });
    // another person gets a process of their own
    await relay.relay({ ...base, principalId: "pr_b", frame: { jsonrpc: "2.0", id: 1, method: "initialize", params: {} } });
    expect(opened.map((entry) => entry.principalId)).toEqual(["pr_a", "pr_b"]);
    expect(relay.size).toBe(2);
    expect(relay.lastUsed("pr_a", "tools")).toEqual(expect.any(Number));
    expect(relay.lastUsed("pr_a", "other")).toBeUndefined();
    expect(relay.lastUsed("pr_nobody")).toBeUndefined();
    relay.closePerson("pr_a");
    expect(relay.lastUsed("pr_a", "tools")).toBeUndefined();
    expect(relay.size).toBe(1);
    relay.stop();
  });

  it("starts a new process when the engine initializes again or the command changes", async () => {
    let opens = 0;
    const relay = new SandboxStdioRelay({ open: async () => { opens += 1; return fakeServer([]); } });
    await relay.relay({ ...base, frame: { jsonrpc: "2.0", id: 1, method: "initialize", params: {} } });
    await relay.relay({ ...base, frame: { jsonrpc: "2.0", id: 1, method: "initialize", params: {} } });
    await relay.relay({ ...base, spec: { argv: ["other"] }, frame: { jsonrpc: "2.0", id: 2, method: "tools/list" } });
    expect(opens).toBe(3);
    relay.stop();
  });

  it("says why the environment refused to start the command", async () => {
    const relay = new SandboxStdioRelay({ open: async () => fakeServer([], { refuse: "busy" }) });
    await expect(relay.relay({ ...base, frame: { jsonrpc: "2.0", id: 1, method: "initialize", params: {} } })).rejects.toMatchObject({ code: "busy" });
    relay.stop();
  });

  it("marks a server that stops before its first answer once, and does not start it again for 30 min (#3181)", async () => {
    let now = 0;
    let opens = 0;
    const failures: string[] = [];
    const dying = () => {
      const stream = new Duplex({ read() {}, write(_chunk, _encoding, callback) { callback(); } });
      setTimeout(() => stream.destroy(), 1);
      return stream;
    };
    let factory: () => Duplex = dying;
    const relay = new SandboxStdioRelay({ open: async () => { opens += 1; return factory(); }, now: () => now, onStartFailure: ({ server }) => failures.push(server) });
    const init = (threadId: string) => relay.relay({ ...base, threadId, frame: { jsonrpc: "2.0", id: 1, method: "initialize", params: {} } });
    await expect(init("t-1")).rejects.toMatchObject({ message: expect.stringContaining("stopped (exited)") });
    expect(relay.startFailed("pr_a", "tools", spec)).toBe(true);
    // the next turns (other threads) get the same answer without a new process
    await expect(init("t-2")).rejects.toMatchObject({ code: "stopped" });
    await expect(init("t-3")).rejects.toMatchObject({ code: "stopped" });
    expect(opens).toBe(1);
    expect(failures).toEqual(["tools"]);
    // another person, or a changed command, is not concerned
    expect(relay.startFailed("pr_b", "tools", spec)).toBe(false);
    expect(relay.startFailed("pr_a", "tools", { ...spec, argv: ["npx", "-y", "server@2"] })).toBe(false);
    // after 30 min it is tried again; an answer clears the mark
    now = 30 * 60_000;
    factory = () => fakeServer([]);
    expect(relay.startFailed("pr_a", "tools", spec)).toBe(false);
    await expect(init("t-4")).resolves.toMatchObject({ id: 1 });
    expect(opens).toBe(2);
    relay.stop();
  });

  it("forgets a failed start when the person changes or removes the server", async () => {
    const relay = new SandboxStdioRelay({ open: async () => fakeServer([], { refuse: "busy" }) });
    await expect(relay.relay({ ...base, frame: { jsonrpc: "2.0", id: 1, method: "initialize", params: {} } })).rejects.toMatchObject({ code: "busy" });
    expect(relay.startFailed("pr_a", "tools", spec)).toBe(true);
    relay.closePerson("pr_a", "tools");
    expect(relay.startFailed("pr_a", "tools", spec)).toBe(false);
    relay.stop();
  });

  it("closes idle sessions", async () => {
    let now = 0;
    const relay = new SandboxStdioRelay({ open: async () => fakeServer([]), idleMs: 1_000, now: () => now });
    await relay.relay({ ...base, frame: { jsonrpc: "2.0", id: 1, method: "initialize", params: {} } });
    now = 5_000;
    relay.sweep();
    expect(relay.size).toBe(0);
  });
});

describe("personalStdioRelayRequest (the engine's side)", () => {
  it("posts every frame to the internal relay with the turn capability, and answers only requests", async () => {
    const posted: Array<{ url: string; auth: string | null; body: unknown }> = [];
    const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
      posted.push({ url: String(input), auth: new Headers(init?.headers).get("authorization"), body: JSON.parse(String(init?.body)) });
      const message = (JSON.parse(String(init?.body)) as { message: { id?: number } }).message;
      return Response.json({ message: message.id === undefined ? null : { jsonrpc: "2.0", id: message.id, result: { ok: true } } });
    }) as typeof fetch;
    const connection = { url: "http://127.0.0.1:4321", token: "cap" };
    expect(await personalStdioRelayRequest({ jsonrpc: "2.0", id: 7, method: "tools/list" }, connection, fetcher)).toEqual({ jsonrpc: "2.0", id: 7, result: { ok: true } });
    expect(await personalStdioRelayRequest({ jsonrpc: "2.0", method: "notifications/initialized" }, connection, fetcher)).toBeUndefined();
    expect(posted.map((entry) => [entry.url, entry.auth])).toEqual([
      ["http://127.0.0.1:4321/api/internal/personal-mcp", "Bearer cap"],
      ["http://127.0.0.1:4321/api/internal/personal-mcp", "Bearer cap"],
    ]);
    // a non-loopback harness URL is never called
    const refused = await personalStdioRelayRequest({ jsonrpc: "2.0", id: 1, method: "tools/call" }, { url: "http://evil.example", token: "cap" }, fetcher);
    expect(refused).toMatchObject({ id: 1, result: { isError: true } });
    expect(posted).toHaveLength(2);
  });
});
