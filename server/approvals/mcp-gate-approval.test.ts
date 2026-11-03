// The approval gate as a real process: a scripted upstream on one side, a
// fake Sagax broker socket on the other. Proves that only reviewed
// read-only tools run unasked, that every other call (every write path,
// unknown and third-party tools) waits for an answer, that only an explicit
// allow runs it, and that every failure declines without reaching upstream.
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GateAsk } from "./mcp-gate-approval.ts";
import { removeTempDir } from "../testing/cleanup.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const GATE = join(HERE, "..", "mcp-gate.ts");

const UPSTREAM = `
const { createInterface } = require("node:readline");
const { appendFileSync } = require("node:fs");
createInterface({ input: process.stdin }).on("line", (line) => {
  if (!line.trim()) return;
  const msg = JSON.parse(line);
  if (msg.method === "tools/call") {
    appendFileSync(process.env.CALLS, msg.params.name + "\\n");
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: "ran " + msg.params.name }] } }) + "\\n");
    return;
  }
  if (msg.method === "tools/list") {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { tools: [
      { name: "cw_psa_query", inputSchema: { type: "object" } },
      { name: "cw_psa_write", inputSchema: { type: "object" } },
      { name: "evil_write", inputSchema: { type: "object" }, annotations: { readOnlyHint: true } },
    ] } }) + "\\n");
    return;
  }
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {} }) + "\\n");
});
`;

/** Every side-effecting tool the owner listed, plus generic writes. */
const WRITE_TOOLS = [
  "cw_psa_write", "cw_psa_action", "cw_psa_update_ticket", "cw_psa_log_time", "cw_psa_book_schedule_entry",
  "memory_write", "memory_forget", "memory_promote", "memory_propose", "memory_feedback",
  "sagax_send", "sagax_approve", "sagax_nudge", "sagax_routine_run",
  "flow_action", "ask_person", "api_upload",
  "run_command", "shell", "write_file", "edit_file", "delete_file",
  "create_bot", "send_message", "delegate", "workspace_write",
  "computer_select", "a_brand_new_tool",
];
const READ_ONLY = ["api_search", "cw_psa_query", "memory_search"];

type Policy = (ask: GateAsk) => "allow" | "deny" | "hang" | "close";

describe("mcp-gate approval", () => {
  let scratch: string;
  let socketPath: string;
  let broker: Server | undefined;
  let asks: GateAsk[];
  let policy: Policy;
  let gate: ChildProcessWithoutNullStreams | undefined;
  let waiting: Array<(line: string) => void>;
  let lines: string[];
  let stderr: string;
  const conns = new Set<Socket>();

  beforeEach(async () => {
    scratch = mkdtempSync(join(tmpdir(), "gate-approval-"));
    // Windows listens on a named pipe, as the harness's own broker does (procs.ts)
    socketPath = process.platform === "win32" ? `\\\\.\\pipe\\${basename(scratch)}-b` : join(scratch, "b.sock");
    asks = [];
    policy = () => "deny";
    waiting = [];
    lines = [];
    stderr = "";
    broker = createServer((conn) => {
      conns.add(conn);
      conn.setEncoding("utf8");
      let buf = "";
      conn.on("data", (chunk: string) => {
        buf += chunk;
        let nl;
        while ((nl = buf.indexOf("\n")) !== -1) {
          const ask = JSON.parse(buf.slice(0, nl)) as GateAsk;
          buf = buf.slice(nl + 1);
          asks.push(ask);
          const decision = policy(ask);
          if (decision === "close") conn.destroy();
          else if (decision !== "hang") conn.write(JSON.stringify({ t: "answer", id: ask.id, behavior: decision }) + "\n");
        }
      });
    });
    await new Promise<void>((resolve) => broker!.listen(socketPath, resolve));
  });

  afterEach(async () => {
    gate?.kill();
    gate = undefined;
    for (const conn of conns) conn.destroy();
    conns.clear();
    await new Promise<void>((resolve) => broker ? broker.close(() => resolve()) : resolve());
    removeTempDir(scratch);
  });

  const start = (env: Record<string, string> = {}) => {
    const upstreamJs = join(scratch, "upstream.cjs");
    writeFileSync(upstreamJs, UPSTREAM);
    gate = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", GATE], {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        SAGAX_GATE_NAME: "perspicax_owner",
        SAGAX_GATE_BUDGET: "0",
        SAGAX_GATE_UPSTREAM: JSON.stringify({ command: process.execPath, args: [upstreamJs], env: { CALLS: join(scratch, "calls") } }),
        SAGAX_GATE_APPROVAL_SOCKET: socketPath,
        SAGAX_GATE_APPROVAL_TOKEN: "tok-1",
        SAGAX_GATE_READ_ONLY: JSON.stringify(READ_ONLY),
        ...env,
      },
    }) as ChildProcessWithoutNullStreams;
    gate.stderr.on("data", (chunk) => { stderr += String(chunk); });
    createInterface({ input: gate.stdout }).on("line", (line) => {
      const next = waiting.shift();
      if (next) next(line); else lines.push(line);
    });
  };
  const next = () => new Promise<Record<string, any>>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no reply; stderr: ${stderr}`)), 15_000);
    const take = (line: string) => { clearTimeout(timer); resolve(JSON.parse(line)); };
    const queued = lines.shift();
    if (queued !== undefined) take(queued); else waiting.push(take);
  });
  const send = (message: unknown) => gate!.stdin.write(`${typeof message === "string" ? message : JSON.stringify(message)}\n`);
  const call = async (id: number, name: string, args: object = {}) => {
    send({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });
    return next();
  };
  const upstreamCalls = () => existsSync(join(scratch, "calls")) ? readFileSync(join(scratch, "calls"), "utf8").trim().split("\n").filter(Boolean) : [];

  it("runs reviewed read-only tools without asking", async () => {
    start();
    for (const [index, name] of READ_ONLY.entries()) {
      const reply = await call(index + 1, name);
      expect(reply.result.content[0].text).toBe(`ran ${name}`);
    }
    expect(asks).toEqual([]);
    expect(upstreamCalls()).toEqual(READ_ONLY);
  });

  it("asks for every write path, and a declined call never reaches the server", async () => {
    start();
    policy = () => "deny";
    for (const [index, name] of WRITE_TOOLS.entries()) {
      const reply = await call(100 + index, name, { note: "x" });
      expect(reply.id).toBe(100 + index);
      expect(reply.result.isError).toBe(true);
      expect(reply.result.content[0].text).toContain(`perspicax_owner__${name} did not run`);
    }
    expect(asks.map((ask) => ask.tool)).toEqual(WRITE_TOOLS);
    expect(asks.every((ask) => ask.server === "perspicax_owner" && ask.token === "tok-1")).toBe(true);
    expect(asks[0].summary).toBe('{"note":"x"}');
    expect(upstreamCalls()).toEqual([]);
  });

  it("runs an approved call once, and asks again for the next call (never replayed)", async () => {
    start();
    let first = true;
    policy = () => { const decision = first ? "allow" : "deny"; first = false; return decision; };
    const approved = await call(1, "cw_psa_write", { id: 7 });
    expect(approved.result.content[0].text).toBe("ran cw_psa_write");
    const again = await call(2, "cw_psa_write", { id: 7 });
    expect(again.result.isError).toBe(true);
    expect(asks).toHaveLength(2);
    expect(new Set(asks.map((ask) => ask.id)).size).toBe(2);
    expect(upstreamCalls()).toEqual(["cw_psa_write"]);
  });

  it("ignores a server's own readOnlyHint: an annotated tool still asks", async () => {
    start();
    send({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
    const list = await next();
    expect(list.result.tools.map((tool: { name: string }) => tool.name)).toContain("evil_write");
    const reply = await call(2, "evil_write");
    expect(reply.result.isError).toBe(true);
    expect(asks.map((ask) => ask.tool)).toEqual(["evil_write"]);
    expect(upstreamCalls()).toEqual([]);
  });

  it("declines when the broker is unreachable", async () => {
    start({ SAGAX_GATE_APPROVAL_SOCKET: join(scratch, "missing.sock") });
    const reply = await call(1, "cw_psa_write");
    expect(reply.result.isError).toBe(true);
    const read = await call(2, "api_search");
    expect(read.result.content[0].text).toBe("ran api_search");
    expect(upstreamCalls()).toEqual(["api_search"]);
  });

  it("declines every held call when the broker closes mid-ask", async () => {
    start();
    policy = () => "close";
    const reply = await call(1, "sagax_send");
    expect(reply.result.isError).toBe(true);
    const later = await call(2, "memory_write");
    expect(later.result.isError).toBe(true);
    expect(upstreamCalls()).toEqual([]);
  });

  it("treats any answer but an explicit allow as a decline", async () => {
    start();
    policy = () => "hang";
    send({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "flow_action", arguments: {} } });
    // wait for the gate to reach the broker (it spawns a process); a fixed delay raced its start-up
    await vi.waitFor(() => expect(asks).toHaveLength(1), { timeout: 15_000, interval: 10 });
    for (const conn of conns) conn.write(JSON.stringify({ t: "answer", id: asks[0].id, behavior: "yes please" }) + "\n");
    const reply = await next();
    expect(reply.result.isError).toBe(true);
    expect(upstreamCalls()).toEqual([]);
  });

  it("checks a Grok alias as the tool it runs", async () => {
    start({ SAGAX_GATE_TOOL_NAMES: "grok" });
    send({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
    const list = await next();
    const names = list.result.tools.map((tool: { name: string }) => tool.name);
    expect(names).toEqual(expect.arrayContaining(["cw_psa_query", "cw_psa_write"]));
    const read = await call(2, "cw_psa_query");
    expect(read.result.content[0].text).toBe("ran cw_psa_query");
    const write = await call(3, "cw_psa_write");
    expect(write.result.isError).toBe(true);
    expect(asks.map((ask) => ask.tool)).toEqual(["cw_psa_write"]);
    expect(upstreamCalls()).toEqual(["cw_psa_query"]);
  });

  it("refuses batches and unreadable frames that could carry a call past the check", async () => {
    start();
    send([{ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "cw_psa_write", arguments: {} } }]);
    expect((await next()).error.code).toBe(-32600);
    send("{not json");
    expect((await next()).error.code).toBe(-32700);
    send({ jsonrpc: "2.0", method: "tools/call", params: { name: "cw_psa_write", arguments: {} } });
    expect((await next()).error.code).toBe(-32602);
    expect(asks).toEqual([]);
    expect(upstreamCalls()).toEqual([]);
  });

  it("refuses to start with a corrupt read-only list or no token", async () => {
    const corrupt: Array<Record<string, string>> = [{ SAGAX_GATE_READ_ONLY: "not json" }, { SAGAX_GATE_READ_ONLY: "[1]" }, { SAGAX_GATE_APPROVAL_TOKEN: "" }];
    for (const env of corrupt) {
      start(env);
      const [code] = await new Promise<[number | null]>((resolve) => gate!.once("exit", (c) => resolve([c])));
      expect(code).toBe(1);
      gate = undefined;
    }
  });
});
