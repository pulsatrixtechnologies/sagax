// The gate as a real process, with a scripted upstream MCP server on the far
// side: frames must survive the round trip untouched except for an oversized
// tool result, which must come back trimmed with its full text on disk.
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { once } from "node:events";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { removeTempDir } from "./testing/cleanup.ts";
import { createPageSchema } from "./testing/oversized-tool-schema.ts";
import { schemaBytes, TOOL_SCHEMA_PROFILE_ENV } from "./tool-schema-profile.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const GATE = join(HERE, "mcp-gate.ts");

/** An upstream that answers tools/call with whatever its script says, and
 * echoes anything else back so the test can prove pass-through. */
const UPSTREAM = `
const { createInterface } = require("node:readline");
const { readFileSync } = require("node:fs");
const reply = JSON.parse(readFileSync(process.env.SCRIPT, "utf8"));
createInterface({ input: process.stdin }).on("line", (line) => {
  if (!line.trim()) return;
  const msg = JSON.parse(line);
  if (msg.method === "tools/call") {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: reply }) + "\\n");
    return;
  }
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { echoed: msg.method, params: msg.params ?? null } }) + "\\n");
});
`;

/** An upstream whose tools declare an outputSchema, listed over two pages. */
const SCHEMA_UPSTREAM = `
const { createInterface } = require("node:readline");
const { readFileSync } = require("node:fs");
const reply = JSON.parse(readFileSync(process.env.SCRIPT, "utf8"));
const send = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\\n");
const tool = (name) => ({ name, inputSchema: { type: "object" }, outputSchema: { type: "object" } });
createInterface({ input: process.stdin }).on("line", (line) => {
  const msg = JSON.parse(line);
  if (msg.method === "tools/list") {
    return msg.params?.cursor === "second" ? send(msg.id, { tools: [tool("write")] }) : send(msg.id, { tools: [tool("read")], nextCursor: "second" });
  }
  if (msg.method === "tools/call") return send(msg.id, reply);
  send(msg.id, {});
});
`;

const SCOPED_UPSTREAM = `
const { createInterface } = require("node:readline");
const { appendFileSync, readFileSync, writeFileSync } = require("node:fs");
const script = JSON.parse(readFileSync(process.env.SCRIPT, "utf8"));
writeFileSync(process.env.SCRIPT + ".started", "started");
let delayedList;
const send = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\\n");
const catalog = (params) => params?.cursor === "second"
  ? { tools: [{ name: "write", inputSchema: { type: "object" } }] }
  : { tools: [{ name: "read", inputSchema: { type: "object" } }, { name: "write", inputSchema: { type: "object" } }], nextCursor: "second" };
createInterface({ input: process.stdin }).on("line", (line) => {
  const msg = JSON.parse(line);
  if (msg.method === "tools/list") {
    if (script.malformedFrame) return process.stdout.write("not-json\\n");
    if (script.malformedCatalog) return send(msg.id, { tools: [{ inputSchema: { type: "object" } }] });
    if (msg.params?.collision) { delayedList = msg; return; }
    return send(msg.id, catalog(msg.params));
  }
  if (msg.method === "tools/call") {
    appendFileSync(process.env.SCRIPT + ".calls", msg.params.name + (script.recordArgs ? " " + JSON.stringify(msg.params.arguments) : "") + "\\n");
    send(msg.id, { content: [{ type: "text", text: script.text ?? "executed" }] });
    if (delayedList) { send(delayedList.id, catalog()); delayedList = undefined; }
    return;
  }
  send(msg.id, { scope: process.env.SAGAX_GATE_TOOL_SCOPE ?? null, upstreamOnly: process.env.UPSTREAM_ONLY });
});
`;

/** Answers tools/list with its script as the catalog. */
const LISTING_UPSTREAM = `
const { createInterface } = require("node:readline");
const { readFileSync } = require("node:fs");
const catalog = JSON.parse(readFileSync(process.env.SCRIPT, "utf8"));
createInterface({ input: process.stdin }).on("line", (line) => {
  const msg = JSON.parse(line);
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: msg.method === "tools/list" ? catalog : {} }) + "\\n");
});
`;

/** The handle a shaped result names in its query_result call. */
const heldHandle = (shaped: string): string => /"result":"([^"]+)"/.exec(shaped)![1];

describe("mcp-gate", () => {
  let scratch: string;
  let gate: ChildProcessWithoutNullStreams | undefined;
  let lines: string[];
  let waiting: Array<(line: string) => void>;

  const start = (reply: unknown, env: Record<string, string> = {}, source = UPSTREAM, args: string[] = []) => {
    const script = join(scratch, "reply.json");
    writeFileSync(script, JSON.stringify(reply));
    const upstreamJs = join(scratch, "upstream.cjs");
    writeFileSync(upstreamJs, source);
    gate = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", GATE, ...args], {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        SAGAX_GATE_NAME: "shop",
        SAGAX_GATE_SPILL_DIR: join(scratch, "spill"),
        SAGAX_GATE_UPSTREAM: JSON.stringify({
          command: process.execPath,
          args: [upstreamJs],
          env: { SCRIPT: script, UPSTREAM_ONLY: "yes" },
        }),
        ...env,
      },
    }) as ChildProcessWithoutNullStreams;
    createInterface({ input: gate.stdout }).on("line", (line) => {
      const next = waiting.shift();
      if (next) next(line);
      else lines.push(line);
    });
  };

  const nextLine = (): Promise<string> =>
    new Promise((resolve, reject) => {
      const buffered = lines.shift();
      if (buffered !== undefined) return resolve(buffered);
      const timer = setTimeout(() => reject(new Error("no frame from the gate")), 15_000);
      const closed = () => {
        clearTimeout(timer);
        reject(new Error("gate closed before replying"));
      };
      gate!.once("close", closed);
      waiting.push((line) => {
        clearTimeout(timer);
        gate!.off("close", closed);
        resolve(line);
      });
    });

  const send = (message: unknown) => gate!.stdin.write(`${JSON.stringify(message)}\n`);

  const call = async (name: string, id = 1) => {
    send({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: {} } });
    return JSON.parse(await nextLine());
  };

  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), "omb-gate-test-"));
    lines = [];
    waiting = [];
  });

  afterEach(async () => {
    if (gate && gate.exitCode === null && gate.signalCode === null) {
      const closed = once(gate, "close");
      gate.kill();
      await closed;
    }
    gate = undefined;
    await removeTempDir(scratch);
  });

  it("relays a frame that is not a tool result untouched", async () => {
    start({ content: [{ type: "text", text: "ok" }] });
    send({ jsonrpc: "2.0", id: 7, method: "tools/list" });
    expect(JSON.parse(await nextLine())).toEqual({ jsonrpc: "2.0", id: 7, result: { echoed: "tools/list", params: null } });
  });

  it.each([undefined, "not-json", "{}", '{"SAGAX_GATE_NAME":"notes","SAGAX_GATE_TOOL_SCOPE":"{}"}'])("refuses missing or corrupt private gate settings before spawning upstream: %s", value => {
    const key = `SAGAX_GATE_CONFIG_${"a".repeat(64)}`;
    start({}, value === undefined ? {} : { [key]: value }, SCOPED_UPSTREAM, ["--config-env", key]);
    return once(gate!, "close").then(([code]) => {
      expect(code).toBe(1);
      expect(existsSync(join(scratch, "reply.json.started"))).toBe(false);
    });
  });

  it("starts an unscoped searched gate from its private record", async () => {
    const key = `SAGAX_GATE_CONFIG_${"a".repeat(64)}`;
    const settings = {
      SAGAX_GATE_NAME: "shop",
      SAGAX_GATE_SPILL_DIR: join(scratch, "spill"),
      SAGAX_GATE_BUDGET: "0",
      SAGAX_GATE_UPSTREAM: JSON.stringify({
        command: process.execPath,
        args: [join(scratch, "upstream.cjs")],
        env: { SCRIPT: join(scratch, "reply.json"), UPSTREAM_ONLY: "yes" },
      }),
      SAGAX_GATE_SEARCH: JSON.stringify({ pinned: ["read"], maxTools: 0 }),
    };
    start({}, { [key]: JSON.stringify(settings) }, SCOPED_UPSTREAM, ["--config-env", key]);
    send({ jsonrpc: "2.0", id: 7, method: "tools/list" });
    expect(JSON.parse(await nextLine()).result.tools.map((tool: { name: string }) => tool.name))
      .toEqual(["read", "search_tools", "describe_tool", "call_tool"]);
  });

  it("leaves a small tool result exactly as the server sent it", async () => {
    const result = { content: [{ type: "text", text: JSON.stringify({ cart: { total: 131 } }) }] };
    start(result);
    expect((await call("get_food_cart")).result).toEqual(result);
    expect(existsSync(join(scratch, "spill"))).toBe(false);
  });

  it("trims an oversized result and saves the whole thing for the bot to read", async () => {
    const products = Array.from({ length: 300 }, (_, i) => ({ id: `p${i}`, name: `Bar ${i}`, blurb: "x".repeat(300) }));
    const full = JSON.stringify({ nextOffset: "1", products });
    start({ content: [{ type: "text", text: full }] });

    const answer = await call("search_products");
    const text = answer.result.content[0].text;
    expect(text.length).toBeLessThan(full.length / 10);
    expect(text).toContain("SHAPED by Sagax");

    const spillDir = join(scratch, "spill");
    const [file] = readdirSync(spillDir);
    expect(file).toContain("search_products");
    expect(readFileSync(join(spillDir, file), "utf8")).toBe(full);
    // …but the model is not pointed at it: reading it back costs more than
    // never trimming. It is there for the person and the harness.
    expect(text).not.toContain(join(spillDir, file));

    const kept = JSON.parse(text.slice(text.indexOf("\n\n") + 2, text.lastIndexOf("\n\n⚠️")));
    expect(kept.products[0]).toEqual(products[0]);
    expect(kept.nextOffset).toBe("1");
  });

  it("drops structuredContent once the text was trimmed, so the engine shows the banner and not a full second copy", async () => {
    // Claude Code hands the model structuredContent serialized instead of
    // the text blocks whenever a result carries one (measured 2026-11-05).
    const products = Array.from({ length: 300 }, (_, i) => ({ id: `p${i}`, blurb: "x".repeat(300) }));
    start({
      content: [{ type: "text", text: JSON.stringify({ products }) }],
      structuredContent: { products },
    });

    const answer = await call("search_products");
    expect(answer.result.structuredContent).toBeUndefined();
    expect(answer.result.content[0].text.startsWith("⚠️ SHAPED by Sagax")).toBe(true);
  });

  it("drops structuredContent on a document that has no array to cut", async () => {
    const doc = { title: "Guide", body: "y".repeat(40_000) };
    start({
      content: [{ type: "text", text: JSON.stringify(doc) }],
      structuredContent: doc,
    });

    const answer = await call("read_doc");
    expect(answer.result.structuredContent).toBeUndefined();
    const text = answer.result.content[0].text as string;
    expect(text.length).toBeLessThan(9_000);
    expect(text.startsWith("⚠️ SHAPED by Sagax")).toBe(true);
  });

  it("keeps structuredContent on a result it did not trim", async () => {
    const result = { content: [{ type: "text", text: JSON.stringify({ cart: { total: 131 } }) }], structuredContent: { cart: { total: 131 } } };
    start(result);
    expect((await call("get_food_cart")).result).toEqual(result);
  });

  it("strips outputSchema from a relayed catalog, on every page, so no client demands structuredContent back", async () => {
    start({}, {}, SCHEMA_UPSTREAM);
    send({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    const first = JSON.parse(await nextLine()).result;
    expect(first.tools.map((tool: { name: string }) => tool.name)).toEqual(["read"]);
    expect(first.tools[0].outputSchema).toBeUndefined();
    expect(first.tools[0].inputSchema).toEqual({ type: "object" });
    send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: { cursor: "second" } });
    const second = JSON.parse(await nextLine()).result;
    expect(second.tools.map((tool: { name: string }) => tool.name)).toEqual(["write", "query_result"]);
    expect(second.tools.every((tool: { outputSchema?: unknown }) => tool.outputSchema === undefined)).toBe(true);
  });

  it("strips outputSchema from a searched catalog too", async () => {
    start({}, { SAGAX_GATE_SEARCH: JSON.stringify({ pinned: ["read"], maxTools: 0 }) }, SCHEMA_UPSTREAM);
    send({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    const tools = JSON.parse(await nextLine()).result.tools as Array<{ name: string; outputSchema?: unknown }>;
    expect(tools.map((tool) => tool.name)).toEqual(["read", "search_tools", "describe_tool", "call_tool", "query_result"]);
    expect(tools.every((tool) => tool.outputSchema === undefined)).toBe(true);
  });

  it("leaves outputSchema in place when the gate does not trim", async () => {
    start({}, { SAGAX_GATE_BUDGET: "0" }, SCHEMA_UPSTREAM);
    send({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(JSON.parse(await nextLine()).result.tools[0].outputSchema).toEqual({ type: "object" });
  });

  it("honours a budget the harness sets", async () => {
    const products = Array.from({ length: 300 }, (_, i) => ({ id: `p${i}`, blurb: "x".repeat(300) }));
    start({ content: [{ type: "text", text: JSON.stringify({ products }) }], structuredContent: undefined }, { SAGAX_GATE_BUDGET: "2000" });
    const text = (await call("search_products")).result.content[0].text;
    expect(text.length).toBeLessThan(2_400);
  });

  it("keeps the upstream server's own environment and hides the gate's", async () => {
    start({ content: [{ type: "text", text: "ok" }] });
    send({ jsonrpc: "2.0", id: 3, method: "peek" });
    await nextLine();
    // proven by the upstream having started at all: it reads SCRIPT from the
    // env the gate passed through. Gate-only keys must not reach it.
    expect(JSON.parse(JSON.stringify(process.env.SAGAX_GATE_UPSTREAM ?? null))).toBe(null);
  });

  it("spawns an upstream named as a bare command on PATH", async () => {
    // The CLI spawned these servers itself on every platform, so the gate has
    // to as well: `npx -y mcp-remote ...` is an npm shim on Windows, which
    // CreateProcess cannot exec directly. Proven here through the same
    // resolver the drivers use, on a bare name rather than an absolute path.
    const script = join(scratch, "reply.json");
    writeFileSync(script, JSON.stringify({ content: [{ type: "text", text: "ok" }] }));
    const upstreamJs = join(scratch, "upstream.cjs");
    writeFileSync(upstreamJs, UPSTREAM);
    gate = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", GATE], {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        SAGAX_GATE_NAME: "shop",
        SAGAX_GATE_UPSTREAM: JSON.stringify({ command: "node", args: [upstreamJs], env: { SCRIPT: script } }),
      },
    }) as ChildProcessWithoutNullStreams;
    createInterface({ input: gate.stdout }).on("line", (line) => {
      const next = waiting.shift();
      if (next) next(line);
      else lines.push(line);
    });

    expect((await call("get_food_cart")).result).toEqual({ content: [{ type: "text", text: "ok" }] });
  });

  it("relays a result whole when it is a shape the trimmer cannot cut", async () => {
    // no content array at all: nothing to trim, and dropping it would lose the
    // tool's answer
    start({ someOtherShape: "z".repeat(40_000) });
    const answer = await call("weird_tool");
    expect(answer.result.someOtherShape.length).toBe(40_000);
  });

  const selected = { SAGAX_GATE_TOOL_SCOPE: JSON.stringify({ allow: ["mcp:shop:read"] }), SAGAX_GATE_BUDGET: "0" };

  it("filters each catalog page and rejects a withheld call before upstream execution", async () => {
    start({}, selected, SCOPED_UPSTREAM);
    send({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(JSON.parse(await nextLine())).toEqual({ jsonrpc: "2.0", id: 1, result: {
      tools: [{ name: "read", inputSchema: { type: "object" } }], nextCursor: "second",
    } });
    send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: { cursor: "second" } });
    expect(JSON.parse(await nextLine()).result).toEqual({ tools: [] });
    expect((await call("write", 3)).error).toMatchObject({ code: -32602 });
    expect(existsSync(join(scratch, "reply.json.calls"))).toBe(false);
    expect((await call("read", 4)).result.content[0].text).toBe("executed");
    expect(readFileSync(join(scratch, "reply.json.calls"), "utf8")).toBe("read\n");
  });

  it("keeps numeric and string IDs separate when list and call answers arrive out of order", async () => {
    start({}, selected, SCOPED_UPSTREAM);
    send({ jsonrpc: "2.0", id: 1, method: "tools/list", params: { collision: true } });
    send({ jsonrpc: "2.0", id: "1", method: "tools/call", params: { name: "read", arguments: {} } });
    expect(JSON.parse(await nextLine())).toMatchObject({ id: "1", result: { content: [{ text: "executed" }] } });
    expect(JSON.parse(await nextLine())).toMatchObject({ id: 1, result: { tools: [{ name: "read" }] } });
  });

  it("fits each listed schema to the engine's provider profile, and lists tools as they came without one", async () => {
    const catalog = { tools: [{ name: "small", inputSchema: { type: "object", properties: { q: { type: "string" } } } },
      { name: "create_page", description: "Create a page.", inputSchema: createPageSchema() }] };
    start(catalog, { SAGAX_GATE_BUDGET: "0", [TOOL_SCHEMA_PROFILE_ENV]: "moonshot" }, LISTING_UPSTREAM);
    send({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    const [small, page] = JSON.parse(await nextLine()).result.tools;
    expect(small).toEqual(catalog.tools[0]);
    expect(schemaBytes(page.inputSchema)).toBeLessThanOrEqual(12_000);
    expect(page.description).toMatch(/^Create a page\.\n\n\(Sagax shortened this tool's parameters to fit Kimi's size limit/);
    gate!.kill();
    await once(gate!, "close");

    start(catalog, { SAGAX_GATE_BUDGET: "0" }, LISTING_UPSTREAM);
    send({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(JSON.parse(await nextLine()).result).toEqual(catalog);
  });

  it("enforces deny precedence without trimming when the result budget is zero", async () => {
    const text = "z".repeat(40_000);
    start({ text }, { SAGAX_GATE_BUDGET: "0", SAGAX_GATE_TOOL_SCOPE: JSON.stringify({ allow: ["mcp:shop:*"], deny: ["mcp:shop:write"] }) }, SCOPED_UPSTREAM);
    expect((await call("write")).error).toMatchObject({ code: -32602 });
    expect((await call("read", 2)).result.content[0].text).toBe(text);
    expect(existsSync(join(scratch, "spill"))).toBe(false);
  });

  // #1374: on Sagax's own agents server a use_tool is the call it runs
  it("checks an agents use_tool as the tool it runs and sends upstream only that call", async () => {
    start({}, { SAGAX_GATE_NAME: "agents", SAGAX_GATE_BUDGET: "0", SAGAX_GATE_TOOL_SCOPE: JSON.stringify({ allow: ["mcp:agents:read"] }) }, SCOPED_UPSTREAM);
    const use = async (id: number, args: unknown) => {
      send({ jsonrpc: "2.0", id, method: "tools/call", params: { name: "use_tool", arguments: args } });
      return JSON.parse(await nextLine());
    };
    // the same refusal as a direct call of write
    expect((await call("write", 1)).error).toMatchObject({ code: -32602 });
    expect((await use(2, { name: "write", arguments: {} })).error).toMatchObject({ code: -32602 });
    expect(existsSync(join(scratch, "reply.json.calls"))).toBe(false);
    // a use_tool naming no tool runs nothing
    expect((await use(3, { name: "use_tool" })).result).toMatchObject({ isError: true });
    expect(existsSync(join(scratch, "reply.json.calls"))).toBe(false);
    // the allowed tool runs, and upstream sees its own name, not use_tool
    expect((await use(4, { name: "read", arguments: {} })).result.content[0].text).toBe("executed");
    expect(readFileSync(join(scratch, "reply.json.calls"), "utf8")).toBe("read\n");
  });

  it.each(["{", "null", '{"allow":null}'])("exits on invalid scope %s before starting the upstream", async (scope) => {
    start({}, { SAGAX_GATE_TOOL_SCOPE: scope }, SCOPED_UPSTREAM);
    const closed = once(gate!, "close");
    gate!.stdin.end();
    const [code] = await closed;
    expect(code).toBe(1);
    expect(existsSync(join(scratch, "reply.json.started"))).toBe(false);
    expect(lines).toEqual([]);
  });

  it("never exposes malformed tool definitions in a restricted connection", async () => {
    start({ malformedCatalog: true }, selected, SCOPED_UPSTREAM);
    send({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    const reply = JSON.parse(await nextLine());
    expect(reply.error).toMatchObject({ code: -32603 });
    expect(reply.result).toBeUndefined();
  });

  it("closes a restricted connection instead of forwarding an unreadable upstream frame", async () => {
    start({ malformedFrame: true }, selected, SCOPED_UPSTREAM);
    const closed = once(gate!, "close");
    send({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    gate!.stdin.end();
    expect((await closed)[0]).toBe(1);
    expect(lines).toEqual([]);
  });

  it("rejects invalid call parameters and unreadable client frames locally", async () => {
    start({}, selected, SCOPED_UPSTREAM);
    send({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: ["read"] } });
    expect(JSON.parse(await nextLine()).error).toMatchObject({ code: -32602 });
    gate!.stdin.write("not-json\n");
    expect(JSON.parse(await nextLine()).error).toMatchObject({ code: -32700 });
    expect(existsSync(join(scratch, "reply.json.calls"))).toBe(false);
  });

  // An upstream that lists the directory's three names beside a plain tool
  // and answers every call with a long text, recording what it ran.
  const DIRECTORY_UPSTREAM = `
const { createInterface } = require("node:readline");
const { appendFileSync } = require("node:fs");
const send = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\\n");
createInterface({ input: process.stdin }).on("line", (line) => {
  const msg = JSON.parse(line);
  if (msg.method === "tools/list") return send(msg.id, { tools: ["search_tools", "describe_tool", "call_tool", "read"].map((name) => ({ name, inputSchema: { type: "object" } })) });
  if (msg.method === "tools/call") {
    appendFileSync(process.env.SCRIPT + ".calls", JSON.stringify(msg.params) + "\\n");
    return send(msg.id, { content: [{ type: "text", text: "d".repeat(4_000) }] });
  }
  send(msg.id, {});
});
`;
  const ran = () => existsSync(join(scratch, "reply.json.calls"))
    ? readFileSync(join(scratch, "reply.json.calls"), "utf8").trim().split("\n").map((line) => JSON.parse(line).name as string) : [];
  const callWith = async (name: string, args: unknown, id: number) => {
    send({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });
    return JSON.parse(await nextLine());
  };

  // #1935: a Perspicax-like profile catalog, too big to list whole.
  const PROFILE_UPSTREAM = `
const { createInterface } = require("node:readline");
const send = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\\n");
const names = ["api_search", "api_describe", "api_result_query", "api_list", "identity_switch", "memory_find", "flow_run", "cw_psa_query", "cw_psa_write", "cw_psa_action", "backup_query",
  ...Array.from({ length: 14 }, (_, i) => "cw_psa_find_thing_" + i)];
createInterface({ input: process.stdin }).on("line", (line) => {
  const msg = JSON.parse(line);
  if (msg.method === "tools/list") return send(msg.id, { tools: names.map((name) => ({ name, description: "Tool " + name, inputSchema: { type: "object" } })) });
  if (msg.method === "tools/call") return send(msg.id, { content: [{ type: "text", text: "ran " + msg.params.name }] });
  send(msg.id, {});
});
`;

  it("#1935: a searched profile catalog still lists its query, write and action tools whole", async () => {
    start({}, { SAGAX_GATE_SEARCH: JSON.stringify({ pinned: ["api_describe", "api_list", "api_result_query", "api_search", "flow_run", "identity_switch", "memory_find"], pinnedSuffixes: ["_action", "_query", "_write"] }) }, PROFILE_UPSTREAM);
    send({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    const listed = JSON.parse(await nextLine()).result.tools.map((tool: { name: string }) => tool.name);
    expect(listed).toEqual(expect.arrayContaining(["api_search", "api_describe", "api_list", "api_result_query", "identity_switch", "memory_find", "flow_run", "cw_psa_query", "cw_psa_write", "cw_psa_action", "backup_query", "search_tools", "describe_tool", "call_tool"]));
    expect(listed).not.toContain("cw_psa_find_thing_0");
    // a pinned tool runs by its own name; the rest stays behind call_tool
    expect((await callWith("cw_psa_query", { resource: "service.tickets" }, 2)).result.content[0].text).toBe("ran cw_psa_query");
    expect((await callWith("call_tool", { name: "cw_psa_find_thing_3", arguments: {} }, 3)).result.content[0].text).toBe("ran cw_psa_find_thing_3");
  });

  it("#1935: an unreadable pinned suffix stops the gate rather than widening", async () => {
    start({}, { SAGAX_GATE_SEARCH: JSON.stringify({ pinned: [], pinnedSuffixes: ["*"] }) }, PROFILE_UPSTREAM);
    const [code] = await once(gate!, "exit");
    expect(code).not.toBe(0);
  });

  it("checks call_tool against the tool it runs only when its upstream is the tool directory", async () => {
    const scope = { SAGAX_GATE_TOOL_SCOPE: JSON.stringify({ allow: ["mcp:shop:read"] }), SAGAX_GATE_BUDGET: "600" };
    start({}, { ...scope, SAGAX_GATE_DIRECTORY: "1" }, DIRECTORY_UPSTREAM);
    send({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(JSON.parse(await nextLine()).result.tools.map((tool: { name: string }) => tool.name)).toEqual(["search_tools", "describe_tool", "call_tool", "read", "query_result"]);
    expect((await callWith("call_tool", { name: "write", arguments: {} }, 2)).error).toMatchObject({ code: -32602 });
    expect(ran()).toEqual([]);
    // the directory's own answers pass whole: its reads, and a call_tool
    // naming no tool, which runs nothing; the tool call_tool runs is trimmed
    expect((await callWith("describe_tool", { name: "read" }, 3)).result.content[0].text).toHaveLength(4_000);
    expect((await callWith("call_tool", { arguments: {} }, 4)).result.content[0].text).toHaveLength(4_000);
    expect((await callWith("call_tool", { name: "read", arguments: {} }, 5)).result.content[0].text).toContain("TRUNCATED by Sagax");
    expect(ran()).toEqual(["describe_tool", "call_tool", "call_tool"]);
  });

  it("treats those names as ordinary tools for any other upstream", async () => {
    start({}, { SAGAX_GATE_TOOL_SCOPE: JSON.stringify({ allow: ["mcp:shop:read"] }), SAGAX_GATE_BUDGET: "600" }, DIRECTORY_UPSTREAM);
    send({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(JSON.parse(await nextLine()).result.tools.map((tool: { name: string }) => tool.name)).toEqual(["read", "query_result"]);
    expect((await callWith("call_tool", { name: "read", arguments: {} }, 2)).error).toMatchObject({ code: -32602 });
    expect((await callWith("describe_tool", { name: "read" }, 3)).error).toMatchObject({ code: -32602 });
    expect(ran()).toEqual([]);
  });

  describe("shaping an oversized result", () => {
    const products = Array.from({ length: 300 }, (_, i) => ({ id: `p${i}`, name: `Bar ${i}`, price: 100 + i, blurb: "x".repeat(300) }));
    const full = JSON.stringify({ nextOffset: "1", products });
    const query = async (args: unknown, id: number) => {
      send({ jsonrpc: "2.0", id, method: "tools/call", params: { name: "query_result", arguments: args } });
      return JSON.parse(await nextLine());
    };

    it("lists query_result beside the server's tools only while it trims", async () => {
      start({ text: full }, {}, SCOPED_UPSTREAM);
      send({ jsonrpc: "2.0", id: 1, method: "tools/list" });
      const first = JSON.parse(await nextLine()).result;
      expect(first.tools.map((tool: { name: string }) => tool.name)).toEqual(["read", "write"]);
      send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: { cursor: "second" } });
      const last = JSON.parse(await nextLine()).result;
      expect(last.tools.map((tool: { name: string }) => tool.name)).toEqual(["write", "query_result"]);
      expect(last.tools[1].annotations.readOnlyHint).toBe(true);
    });

    it("never lists it when the budget is zero", async () => {
      start({ text: full }, { SAGAX_GATE_BUDGET: "0" }, SCOPED_UPSTREAM);
      send({ jsonrpc: "2.0", id: 1, method: "tools/list", params: { cursor: "second" } });
      expect(JSON.parse(await nextLine()).result.tools.map((tool: { name: string }) => tool.name)).toEqual(["write"]);
    });

    it("holds the whole result and answers a query locally with just the selection", async () => {
      start({ text: full }, {}, SCOPED_UPSTREAM);
      const shaped: string = (await call("read")).result.content[0].text;
      expect(shaped.startsWith("⚠️ SHAPED by Sagax:")).toBe(true);
      const handle = heldHandle(shaped);
      // the handle names the server whose query_result holds it
      expect(handle).toMatch(/^shop:r1\.[a-z0-9]+$/);
      expect(shaped).toContain(`query_result {"result":"${handle}","query":`);
      expect(shaped).toContain("products: 300 items{id, name, price, blurb}");
      expect(shaped.length).toBeLessThan(8_200);

      const answer = await query({ result: handle, query: "products[?price > `397`].{name: name, price: price}" }, 2);
      expect(answer.result.isError).toBeUndefined();
      expect(JSON.parse(answer.result.content[0].text)).toEqual([{ name: "Bar 298", price: 398 }, { name: "Bar 299", price: 399 }]);
      // the upstream saw the original call and nothing else
      expect(readFileSync(join(scratch, "reply.json.calls"), "utf8")).toBe("read\n");
    });

    it("cuts a query answer to the same budget, so the whole thing never comes back", async () => {
      start({ text: full }, { SAGAX_GATE_BUDGET: "2000" }, SCOPED_UPSTREAM);
      const handle = heldHandle((await call("read")).result.content[0].text);
      const answer = await query({ result: handle, query: "@" }, 2);
      expect(answer.result.content[0].text.length).toBeLessThan(2_400);
      expect(answer.result.content[0].text).toContain("Narrow the query");
    });

    it("answers a bad handle or query as a tool error without touching upstream", async () => {
      start({ text: full }, {}, SCOPED_UPSTREAM);
      expect((await query({ result: "shop:r9.zzzz", query: "@" }, 1)).result).toMatchObject({ isError: true });
      expect((await query({ query: "@" }, 2)).result).toMatchObject({ isError: true });
      expect(existsSync(join(scratch, "reply.json.calls"))).toBe(false);
    });

    it("answers without an approval card, which the server's own tools still need", async () => {
      // an approval socket that does not exist: any call that asks it fails
      start({ text: full }, { SAGAX_GATE_APPROVAL_SOCKET: join(scratch, "no-such.sock"), SAGAX_GATE_APPROVAL_TOKEN: "t" }, SCOPED_UPSTREAM);
      expect((await query({ result: "shop:r1.zzzz", query: "@" }, 1)).result).toMatchObject({ isError: true, content: [{ text: expect.stringContaining("no longer held") }] });
      expect(existsSync(join(scratch, "reply.json.calls"))).toBe(false);
    });

    it("keeps query_result listed and callable under a tool selection that never names it", async () => {
      start({ text: full }, { SAGAX_GATE_TOOL_SCOPE: JSON.stringify({ allow: ["mcp:shop:read"] }) }, SCOPED_UPSTREAM);
      send({ jsonrpc: "2.0", id: 1, method: "tools/list", params: { cursor: "second" } });
      expect(JSON.parse(await nextLine()).result.tools.map((tool: { name: string }) => tool.name)).toEqual(["query_result"]);
      const handle = heldHandle((await call("read", 2)).result.content[0].text);
      const answer = await query({ result: handle, query: "length(products)" }, 3);
      expect(answer.result.content[0].text).toBe("300");
    });

    it("never hands one connection's result to another: a new gate holds nothing", async () => {
      // the first conversation's gate holds r1
      start({ text: full }, {}, SCOPED_UPSTREAM);
      const handle = heldHandle((await call("read")).result.content[0].text);
      expect((await query({ result: handle, query: "length(products)" }, 2)).result.content[0].text).toBe("300");
      const first = gate!;
      const closed = once(first, "close");
      first.kill();
      await closed;
      // another conversation (or person) gets its own gate on its own connection: r1 is not there
      lines = [];
      waiting = [];
      start({ text: "{}" }, {}, SCOPED_UPSTREAM);
      expect((await query({ result: handle, query: "length(products)" }, 1)).result).toMatchObject({ isError: true });
    });

    it("sends a handle another server holds back to that server's query_result", async () => {
      // a bot runs one gate per MCP server: another server's handle must not be read here
      start({ text: full }, {}, SCOPED_UPSTREAM);
      await call("read");
      const foreign = (await query({ result: "files:r1.ab12", query: "@" }, 2)).result;
      expect(foreign).toMatchObject({ isError: true });
      expect(foreign.content[0].text).toContain('held by the "files" server');
      // a bare handle, as models wrote before handles named their server, is never another result's r1
      const bare = (await query({ result: "r1", query: "length(products)" }, 3)).result;
      expect(bare).toMatchObject({ isError: true });
      expect(bare.content[0].text).toContain("not a handle of this server");
      expect(existsSync(join(scratch, "reply.json.calls"))).toBe(true);
    });
  });

  describe("a handle given to the other family's query tool (#3127)", () => {
    const products = Array.from({ length: 300 }, (_, i) => ({ id: `p${i}`, name: `Bar ${i}`, price: 100 + i, blurb: "x".repeat(300) }));
    const full = JSON.stringify({ products });
    const callWithArgs = async (name: string, args: unknown, id: number) => {
      send({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });
      return JSON.parse(await nextLine());
    };

    it("forwards a handle the server minted itself from query_result to the server's api_result_query", async () => {
      start({ text: "[1,2,3]", recordArgs: true }, {}, SCOPED_UPSTREAM);
      const answer = await callWithArgs("query_result", { result: "res_58e88a3adbc84612", query: "length(items)" }, 1);
      expect(answer.result.isError).toBeUndefined();
      expect(answer.result.content[0].text).toBe("[1,2,3]");
      expect(readFileSync(join(scratch, "reply.json.calls"), "utf8"))
        .toBe('api_result_query {"handle":"res_58e88a3adbc84612","expression":"length(items)"}\n');
    });

    it("answers a handle the gate shaped, given to api_result_query, without the server", async () => {
      start({ text: full, recordArgs: true }, {}, SCOPED_UPSTREAM);
      const handle = heldHandle((await call("read")).result.content[0].text);
      const answer = await callWithArgs("api_result_query", { handle, expression: "length(products)" }, 2);
      expect(answer.result.isError).toBeUndefined();
      expect(answer.result.content[0].text).toBe("300");
      // the alias spelling of the server's own tool is read the same way
      const aliased = await callWithArgs("api_result_query", { handle, query: "products[0].name" }, 3);
      expect(aliased.result.content[0].text).toBe('"Bar 0"');
      expect(readFileSync(join(scratch, "reply.json.calls"), "utf8")).toBe("read {}\n");
    });

    it("says which server holds another server's shaped handle given to api_result_query", async () => {
      start({ text: full, recordArgs: true }, {}, SCOPED_UPSTREAM);
      const answer = await callWithArgs("api_result_query", { handle: "files:r1.ab12", expression: "@" }, 1);
      expect(answer.result).toMatchObject({ isError: true });
      expect(answer.result.content[0].text).toContain('held by the "files" server');
      expect(existsSync(join(scratch, "reply.json.calls"))).toBe(false);
    });
  });

  it("strips policy from the upstream environment without losing its own configuration", async () => {
    start({}, selected, SCOPED_UPSTREAM);
    send({ jsonrpc: "2.0", id: 1, method: "peek" });
    expect(JSON.parse(await nextLine()).result).toEqual({ scope: null, upstreamOnly: "yes" });
  });
});
