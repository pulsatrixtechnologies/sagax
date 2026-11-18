// #4394: every engine start starts its gates again, and the engine waits for
// each server's initialize and tool list before the turn's prompt leaves (a
// connector: 3.4 s at every turn on a hosted server). The gate as a real
// process, in front of a server that takes seconds to answer both: a second
// start is answered at once from what the first one kept, the server is
// still initialized and listed beside it, and a list that changed is kept and
// said to the engine.
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { once } from "node:events";
import { afterEach, beforeEach, expect, it } from "vitest";

import { removeTempDir } from "./testing/cleanup.ts";

const GATE = fileURLToPath(new URL("./mcp-gate.ts", import.meta.url));

/** A server whose initialize and tool list take INIT_MS and LIST_MS, whose
 * catalog is the TOOLS file read at each list, and which logs each method. */
const SLOW_UPSTREAM = `
const { createInterface } = require("node:readline");
const { appendFileSync, readFileSync } = require("node:fs");
const send = (id, body) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, ...body }) + "\\n");
createInterface({ input: process.stdin }).on("line", (line) => {
  const msg = JSON.parse(line);
  appendFileSync(process.env.LOG, msg.method + "\\n");
  if (msg.method === "initialize") {
    const refuse = process.env.REFUSE === "1";
    return setTimeout(() => send(msg.id, refuse ? { error: { code: -32603, message: "no" } }
      : { result: { protocolVersion: msg.params.protocolVersion, capabilities: { tools: { listChanged: true } }, serverInfo: { name: "slow", version: "1" } } }), Number(process.env.INIT_MS));
  }
  if (msg.method === "tools/list") {
    const tools = JSON.parse(readFileSync(process.env.TOOLS, "utf8")).map((name) => ({ name, inputSchema: { type: "object" } }));
    return setTimeout(() => send(msg.id, { result: { tools } }), Number(process.env.LIST_MS));
  }
  if (msg.method === "tools/call") return send(msg.id, { result: { content: [{ type: "text", text: "ran " + msg.params.name } ] } });
});
`;

let scratch: string;
let gates: ChildProcessWithoutNullStreams[];

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "omb-gate-kept-"));
  gates = [];
  writeFileSync(join(scratch, "upstream.cjs"), SLOW_UPSTREAM);
  writeFileSync(join(scratch, "tools.json"), JSON.stringify(["read"]));
});

afterEach(async () => {
  for (const gate of gates) {
    if (gate.exitCode === null && gate.signalCode === null) {
      const closed = once(gate, "close");
      gate.kill();
      await closed;
    }
  }
  await removeTempDir(scratch);
});

const keptFile = () => join(scratch, "kept", "notes.json");

/** One gate in front of the slow server, as one engine start would mount it. */
function startGate(env: Record<string, string> = {}, gateEnv: Record<string, string | undefined> = {}) {
  const gate = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", GATE], {
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      SAGAX_GATE_NAME: "notes",
      SAGAX_GATE_SPILL_DIR: join(scratch, "spill"),
      SAGAX_GATE_BUDGET: "0",
      SAGAX_GATE_TOOL_NAMES: "grok",
      SAGAX_GATE_REPORT_DIR: join(scratch, "names"),
      SAGAX_GATE_KEPT: keptFile(),
      SAGAX_GATE_UPSTREAM: JSON.stringify({
        command: process.execPath,
        args: [join(scratch, "upstream.cjs")],
        env: { LOG: join(scratch, "upstream.log"), TOOLS: join(scratch, "tools.json"), INIT_MS: "2500", LIST_MS: "2500", ...env },
      }),
      ...gateEnv,
    },
  }) as ChildProcessWithoutNullStreams;
  gates.push(gate);
  const lines: any[] = [];
  const waiting: Array<(frame: any) => void> = [];
  createInterface({ input: gate.stdout }).on("line", (line) => {
    const frame = JSON.parse(line);
    const next = waiting.shift();
    if (next) next(frame);
    else lines.push(frame);
  });
  const next = (): Promise<any> => new Promise((resolve, reject) => {
    const buffered = lines.shift();
    if (buffered !== undefined) return resolve(buffered);
    const timer = setTimeout(() => reject(new Error("no frame from the gate")), 20_000);
    waiting.push((frame) => { clearTimeout(timer); resolve(frame); });
  });
  const send = (frame: object) => gate.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...frame })}\n`);
  /** A request and the time to its answer. */
  const ask = async (id: number, method: string, params: object = {}) => {
    const at = Date.now();
    send({ id, method, params });
    const answer = await next();
    return { answer, ms: Date.now() - at };
  };
  const handshake = async () => {
    const init = await ask(1, "initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "engine", version: "1" } });
    send({ method: "notifications/initialized" });
    const list = await ask(2, "tools/list");
    return { init, list };
  };
  const stop = async () => {
    const closed = once(gate, "close");
    gate.stdin.end();
    await closed;
  };
  return { ask, next, handshake, stop };
}

const upstreamLog = () => readFileSync(join(scratch, "upstream.log"), "utf8").trim().split("\n");

it("answers the next start's initialize and tool list at once from what the last one kept (#4394)", async () => {
  const first = startGate();
  const cold = await first.handshake();
  expect(cold.init.ms).toBeGreaterThanOrEqual(2_400);
  expect(cold.list.ms).toBeGreaterThanOrEqual(2_400);
  expect(cold.list.answer.result.tools.map((tool: { name: string }) => tool.name)).toEqual(["read"]);
  await first.stop();
  expect(existsSync(keptFile())).toBe(true);

  const second = startGate();
  const warm = await second.handshake();
  expect(warm.init.answer.result).toEqual(cold.init.answer.result);
  expect(warm.list.answer.result).toEqual(cold.list.answer.result);
  // both answered without the server's 2.5 s each
  expect(warm.init.ms).toBeLessThan(1_500);
  expect(warm.list.ms).toBeLessThan(1_500);
  // a call still reaches the server, after its own initialize
  const call = await second.ask(3, "tools/call", { name: "read", arguments: {} });
  expect(call.answer.result.content[0].text).toBe("ran read");
  const log = upstreamLog().slice(3);
  expect(log.indexOf("initialize")).toBe(0);
  expect(log.indexOf("tools/call")).toBeGreaterThan(log.indexOf("notifications/initialized"));
  // and the server is listed again beside the turn
  expect(log).toContain("tools/list");
}, 40_000);

it("keeps a list that changed and tells the engine, which lists it again (#4394)", async () => {
  const first = startGate();
  await first.handshake();
  await first.stop();
  writeFileSync(join(scratch, "tools.json"), JSON.stringify(["read", "write"]));

  const second = startGate();
  const warm = await second.handshake();
  expect(warm.list.answer.result.tools.map((tool: { name: string }) => tool.name)).toEqual(["read"]);
  expect(await second.next()).toEqual({ jsonrpc: "2.0", method: "notifications/tools/list_changed" });
  const again = await second.ask(4, "tools/list");
  expect(again.answer.result.tools.map((tool: { name: string }) => tool.name)).toEqual(["read", "write"]);
  expect(again.ms).toBeLessThan(1_500);
  expect(JSON.parse(readFileSync(keptFile(), "utf8")).list.tools.map((tool: { name: string }) => tool.name)).toEqual(["read", "write"]);
}, 40_000);

it("forgets what it kept of a server that now refuses to start (#4394)", async () => {
  const first = startGate();
  await first.handshake();
  await first.stop();
  const second = startGate({ REFUSE: "1" });
  await second.ask(1, "initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "engine", version: "1" } });
  await expect.poll(() => existsSync(keptFile()), { timeout: 10_000 }).toBe(false);
}, 40_000);

it("drops what was kept of a mount no start used for a month, and renews its own (#4394)", async () => {
  const first = startGate();
  await first.handshake();
  await first.stop();
  const old = new Date(Date.now() - 40 * 24 * 60 * 60_000);
  const stale = join(scratch, "kept", "gone.json");
  mkdirSync(join(scratch, "kept"), { recursive: true });
  writeFileSync(stale, "{}");
  utimesSync(stale, old, old);
  utimesSync(keptFile(), old, old);
  const second = startGate();
  const warm = await second.handshake();
  expect(warm.list.answer.result.tools.map((tool: { name: string }) => tool.name)).toEqual(["read"]);
  expect(existsSync(stale)).toBe(false);
  expect(existsSync(keptFile())).toBe(true);
}, 40_000);

it("#4527 lot D: a kept listing starts as fast from what was kept, and leaves out its tools", async () => {
  writeFileSync(join(scratch, "tools.json"), JSON.stringify(Array.from({ length: 15 }, (_, i) => `notes_tool_${String(i).padStart(2, "0")}`)));
  // no admissible-name aliases: a gate with them never searches
  const search = { SAGAX_GATE_TOOL_NAMES: undefined, SAGAX_GATE_SEARCH: JSON.stringify({ pinned: [], leftOut: ["notes_tool_07"] }) };
  const first = startGate({}, search);
  const cold = await first.handshake();
  const names = (list: any) => list.answer.result.tools.map((tool: { name: string }) => tool.name);
  expect(names(cold.list)).not.toContain("notes_tool_07");
  expect(names(cold.list)).toContain("call_tool");
  await first.stop();
  expect(existsSync(keptFile())).toBe(true);

  const second = startGate({}, search);
  const warm = await second.handshake();
  expect(warm.list.ms).toBeLessThan(1_500);
  expect(names(warm.list)).toEqual(names(cold.list));
  // the left out tool still runs through call_tool, after the server's own initialize
  expect((await second.ask(3, "tools/call", { name: "call_tool", arguments: { name: "notes_tool_07", arguments: {} } })).answer.result.content[0].text).toBe("ran notes_tool_07");
  await second.stop();
}, 30_000);
