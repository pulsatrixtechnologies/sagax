// #3623: the tool list of a person's connector mount, kept between turns.
// A reproduction of the slow mount: a fake server in the person's
// environment that serves 120 tools of realistic size, with a delay on each
// step (the stream's opening, its initialize, its tools/list). Bounds are
// counts of the server's requests, not wall time.
import { Duplex } from "node:stream";
import { describe, expect, it } from "vitest";

import { SandboxStdioRelay } from "./sandbox-stdio-mcp.ts";
import type { SandboxStdioSpec } from "./sandboxd-core.ts";
import { createToolListNormalizer } from "../mcp/mcp-tool-schema.ts";
import { toolSchemaProfile } from "../tool-schema-profile.ts";

type Rpc = { jsonrpc?: string; id?: string | number; method?: string; params?: { name?: string } };

/** 120 tools the size of a real connector's: a description and a schema
 * with a few typed properties each. */
function connectorTools(tag: string, count = 120) {
  return Array.from({ length: count }, (_, index) => ({
    name: `${tag}_tool_${index}`,
    description: `Reads or writes the ${tag} records of kind ${index}. Filter on ids and flags; times are local. `.repeat(3),
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "integer", description: "The record id." },
        fields: { type: "array", items: { type: "string" }, description: "The fields each item keeps." },
        conditions: { type: "string", description: "A filter on ids and flags." },
        limit: { type: "integer", minimum: 1, maximum: 1000 },
        set: { type: "object", additionalProperties: true },
      },
      required: index % 2 ? ["id"] : [],
    },
  }));
}

interface Upstream {
  opens: number;
  initializes: number;
  lists: number;
  calls: string[];
  /** the tools the next tools/list answers, per person */
  tools: Map<string, ReturnType<typeof connectorTools>>;
  streams: Duplex[];
}

const delays = { open: 30, hello: 20, list: 40 };
const later = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function upstream(): { state: Upstream; open: (principalId: string) => Promise<Duplex> } {
  const state: Upstream = { opens: 0, initializes: 0, lists: 0, calls: [], tools: new Map(), streams: [] };
  const open = async (principalId: string) => {
    state.opens += 1;
    await later(delays.open);
    let buffer = "";
    const stream: Duplex = new Duplex({
      read() {},
      write(chunk: Buffer, _encoding, callback) {
        buffer += chunk.toString();
        let newline: number;
        while ((newline = buffer.indexOf("\n")) !== -1) {
          const frame = JSON.parse(buffer.slice(0, newline)) as Rpc;
          buffer = buffer.slice(newline + 1);
          const reply = (value: unknown) => stream.push(`${JSON.stringify(value)}\n`);
          if (frame.method === "initialize") {
            state.initializes += 1;
            setTimeout(() => reply({ jsonrpc: "2.0", id: frame.id, result: { protocolVersion: "2025-06-18", capabilities: { tools: { listChanged: true } }, serverInfo: { name: "connector", version: "1" } } }), delays.hello);
          } else if (frame.method === "tools/list") {
            state.lists += 1;
            const tools = state.tools.get(principalId) ?? connectorTools(principalId);
            setTimeout(() => reply({ jsonrpc: "2.0", id: frame.id, result: { tools } }), delays.list);
          } else if (frame.method === "tools/call") {
            const name = frame.params?.name ?? "";
            state.calls.push(name);
            const served = (state.tools.get(principalId) ?? connectorTools(principalId)).some((tool) => tool.name === name);
            reply(served
              ? { jsonrpc: "2.0", id: frame.id, result: { content: [{ type: "text", text: `called ${name}` }] } }
              : { jsonrpc: "2.0", id: frame.id, error: { code: -32602, message: `Unknown tool: ${name}` } });
          }
        }
        callback();
      },
    });
    state.streams.push(stream);
    return stream;
  };
  return { state, open };
}

const spec: SandboxStdioSpec = { argv: ["connector-mcp"], env: { CONNECTOR_TOKEN: "t" } };

/** One turn that starts an engine process: its proxy's initialize, the
 * initialized notification and its tool list, as the engine sends them. */
async function engineTurn(relay: SandboxStdioRelay, who: { principalId: string; threadId: string }, parts?: Array<[string, number]>) {
  const input = { principalId: who.principalId, botId: "bot-1", threadId: who.threadId, server: "connector", spec,
    ...(parts ? { onPart: (part: string, value: number) => { parts.push([part, value]); } } : {}) };
  const hello = await relay.relay({ ...input, frame: { jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "engine", version: "1" } } } });
  await relay.relay({ ...input, frame: { jsonrpc: "2.0", method: "notifications/initialized" } });
  const list = await relay.relay({ ...input, frame: { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} } }) as { id: number; result: { tools: Array<{ name: string }> } };
  return { hello, list, input };
}

/** Lets the background start and check finish. */
const settle = () => later(delays.open + delays.hello + delays.list + 50);

describe("SandboxStdioRelay kept tool list (#3623)", () => {
  it("names the parts of a first tool list, and a second turn of the same person asks the server nothing before its list is answered", async () => {
    const { state, open } = upstream();
    const relay = new SandboxStdioRelay({ open: (principalId) => open(principalId) });
    const parts: Array<[string, number]> = [];
    const first = await engineTurn(relay, { principalId: "pr_a", threadId: "t-1" }, parts);
    expect(first.list.result.tools).toHaveLength(120);
    // the first turn pays the whole path, one request of each kind
    expect({ opens: state.opens, initializes: state.initializes, lists: state.lists }).toEqual({ opens: 1, initializes: 1, lists: 1 });
    expect(parts.map(([part]) => part)).toEqual(["open", "hello", "list", "kb"]);
    const kb = parts.find(([part]) => part === "kb")![1];
    expect(kb).toBeGreaterThan(50);

    // a new engine process (same thread, then another conversation)
    for (const threadId of ["t-1", "t-2"]) {
      const before = { initializes: state.initializes, lists: state.lists };
      const again: Array<[string, number]> = [];
      const turn = await engineTurn(relay, { principalId: "pr_a", threadId }, again);
      // zero handshake and zero tools/list reached the server before the
      // engine had its list; no part of the slow path was paid
      expect({ initializes: state.initializes, lists: state.lists }).toEqual(before);
      expect(turn.hello).toMatchObject({ id: 0, result: { serverInfo: { name: "connector" } } });
      expect(turn.list.id).toBe(1);
      expect(turn.list.result.tools).toHaveLength(120);
      expect(again).toEqual([]);
      // the server still starts with the engine's own initialize, then the
      // list is checked once, in the background
      await settle();
      expect({ initializes: state.initializes, lists: state.lists }).toEqual({ initializes: before.initializes + 1, lists: before.lists + 1 });
    }
    relay.stop();
  });

  it("serves the kept list byte for byte as the server's fresh one, before and after fitting", async () => {
    const { open } = upstream();
    const fresh = new SandboxStdioRelay({ open: (principalId) => open(principalId) });
    const live = await engineTurn(fresh, { principalId: "pr_a", threadId: "t-1" });
    const kept = await engineTurn(fresh, { principalId: "pr_a", threadId: "t-1" });
    expect(JSON.stringify(kept.list)).toBe(JSON.stringify(live.list));
    expect(JSON.stringify(kept.hello)).toBe(JSON.stringify(live.hello));
    for (const profile of [undefined, toolSchemaProfile("moonshot")]) {
      const fit = (answer: unknown) => {
        const normalizer = createToolListNormalizer(profile);
        normalizer.observeRequest(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }));
        return normalizer.rewriteResponse(JSON.stringify(answer));
      };
      expect(fit(kept.list)).toBe(fit(live.list));
    }
    await settle();
    fresh.stop();
  });

  it("serves a list changed on the server fresh at the next turn at the latest", async () => {
    const { state, open } = upstream();
    const relay = new SandboxStdioRelay({ open: (principalId) => open(principalId) });
    await engineTurn(relay, { principalId: "pr_a", threadId: "t-1" });
    // the server's tools change; the next turn's background check sees it
    state.tools.set("pr_a", connectorTools("renamed", 3));
    const second = await engineTurn(relay, { principalId: "pr_a", threadId: "t-1" });
    expect(second.list.result.tools).toHaveLength(120);
    await settle();
    const third = await engineTurn(relay, { principalId: "pr_a", threadId: "t-1" });
    expect(third.list.result.tools.map((tool) => tool.name)).toEqual(["renamed_tool_0", "renamed_tool_1", "renamed_tool_2"]);
    await settle();

    // the server says its list changed: the very next turn has the new one
    state.tools.set("pr_a", connectorTools("again", 2));
    const stream = state.streams.at(-1)!;
    stream.push(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/tools/list_changed" })}\n`);
    await settle();
    const fourth = await engineTurn(relay, { principalId: "pr_a", threadId: "t-1" });
    expect(fourth.list.result.tools.map((tool) => tool.name)).toEqual(["again_tool_0", "again_tool_1"]);
    await settle();
    relay.stop();
  });

  it("never shows one person's kept list to another", async () => {
    const { state, open } = upstream();
    const relay = new SandboxStdioRelay({ open: (principalId) => open(principalId) });
    const a = await engineTurn(relay, { principalId: "pr_a", threadId: "t-1" });
    const listsBefore = state.lists;
    const b = await engineTurn(relay, { principalId: "pr_b", threadId: "t-1" });
    // person B's first turn asks the server in B's own environment
    expect(state.lists).toBe(listsBefore + 1);
    expect(a.list.result.tools[0]!.name).toBe("pr_a_tool_0");
    expect(b.list.result.tools[0]!.name).toBe("pr_b_tool_0");
    const bAgain = await engineTurn(relay, { principalId: "pr_b", threadId: "t-2" });
    expect(bAgain.list.result.tools.every((tool) => tool.name.startsWith("pr_b_"))).toBe(true);
    await settle();
    relay.stop();
  });

  it("drops the kept list when the person signs out or the server's access or command changes", async () => {
    const { state, open } = upstream();
    const relay = new SandboxStdioRelay({ open: (principalId) => open(principalId) });
    const live = async (change: () => void, threadId: string) => {
      await engineTurn(relay, { principalId: "pr_a", threadId });
      await settle();
      change();
      const before = state.lists;
      await engineTurn(relay, { principalId: "pr_a", threadId });
      // the list came from the server again, before the engine had it
      return state.lists - before;
    };
    // sign-out
    expect(await live(() => relay.forgetKept("pr_a"), "t-1")).toBe(1);
    // the server removed, turned off, changed or stopped (Settings, admin)
    expect(await live(() => relay.closePerson("pr_a", "connector"), "t-2")).toBe(1);
    // another person's sign-out leaves this one's copy alone
    await settle();
    relay.forgetKept("pr_b");
    const before = state.lists;
    await engineTurn(relay, { principalId: "pr_a", threadId: "t-3" });
    expect(state.lists).toBe(before);
    // a new sign-in in the server's variables is a new command: asked again
    await settle();
    const changed = state.lists;
    await relay.relay({ principalId: "pr_a", botId: "bot-1", threadId: "t-3", server: "connector", spec: { ...spec, env: { CONNECTOR_TOKEN: "u" } }, frame: { jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-06-18" } } });
    await relay.relay({ principalId: "pr_a", botId: "bot-1", threadId: "t-3", server: "connector", spec: { ...spec, env: { CONNECTOR_TOKEN: "u" } }, frame: { jsonrpc: "2.0", id: 1, method: "tools/list" } });
    expect(state.lists).toBe(changed + 1);
    await settle();
    relay.stop();
  });

  it("a call after a kept list waits for the server's start, and a tool it no longer serves gets its own error", async () => {
    const { state, open } = upstream();
    const relay = new SandboxStdioRelay({ open: (principalId) => open(principalId) });
    await engineTurn(relay, { principalId: "pr_a", threadId: "t-1" });
    state.tools.set("pr_a", connectorTools("pr_a", 1));
    const { input } = await engineTurn(relay, { principalId: "pr_a", threadId: "t-1" });
    const [served, gone] = await Promise.all([
      relay.relay({ ...input, frame: { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "pr_a_tool_0" } } }),
      relay.relay({ ...input, frame: { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "pr_a_tool_9" } } }),
    ]);
    expect(served).toMatchObject({ id: 2, result: { content: [{ text: "called pr_a_tool_0" }] } });
    expect(gone).toMatchObject({ id: 3, error: { message: "Unknown tool: pr_a_tool_9" } });
    // the call reached the new process only after its initialize
    expect(state.initializes).toBe(2);
    await settle();
    relay.stop();
  });
});
