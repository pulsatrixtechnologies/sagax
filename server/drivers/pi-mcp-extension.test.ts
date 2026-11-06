import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";
import { removeTempDir } from "../testing/cleanup.ts";
import { STABLE_ACK, STABLE_CWD_NOTE, STABLE_END_MARKER, splitStableMessages, stableCwdTurn } from "./pi-mcp-extension.ts";
import { startFakeHttpMcp } from "../testing/fake-http-mcp-server.ts";
import { whopLikeCatalog } from "../testing/whop-like-catalog.ts";
import { buildMcpServers } from "./pi.ts";
import { mcpStdioServer } from "../mcp/mcp-gate-config.ts";

import extension, {
  allocateToolName,
  StdioMcp,
  toTypebox,
  truncateToolText,
} from "./pi-mcp-extension.ts";

const tempDirs: string[] = [];
const clients: StdioMcp[] = [];
const originalMcpConfig = process.env.SAGAX_MCP_CONFIG;

type ExtensionApi = Parameters<typeof extension>[0];
type RegisteredTool = Parameters<ExtensionApi["registerTool"]>[0];
type ShutdownHandler = Parameters<ExtensionApi["on"]>[1];

interface SchemaNode {
  type?: string;
  const?: unknown;
  enum?: unknown[];
  anyOf?: SchemaNode[];
  required?: string[];
  additionalProperties?: boolean | SchemaNode;
  properties?: Record<string, SchemaNode>;
}

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "omb-pi-mcp-ext-"));
  tempDirs.push(dir);
  return dir;
}

function fakeMcpScript(source: string): string {
  const dir = tempDir();
  const path = join(dir, "fake-mcp.mjs");
  writeFileSync(path, source, "utf8");
  chmodSync(path, 0o755);
  return path;
}

function createClient(source: string, env: Record<string, string> = {}): StdioMcp {
  const client = new StdioMcp({ command: process.execPath, args: [fakeMcpScript(source)], env });
  clients.push(client);
  return client;
}

afterEach(async () => {
  vi.restoreAllMocks();
  for (const client of clients.splice(0)) client.dispose();
  for (const dir of tempDirs.splice(0)) await removeTempDir(dir);
  if (originalMcpConfig === undefined) delete process.env.SAGAX_MCP_CONFIG;
  else process.env.SAGAX_MCP_CONFIG = originalMcpConfig;
});

describe("Pi MCP JSON Schema conversion", () => {
  it("keeps the cua browser_prepare regression schema object-shaped at the root", () => {
    const schema = toTypebox({
      type: "object",
      additionalProperties: true,
      anyOf: [
        { required: ["pid"] },
        {
          properties: {
            allow_launch: { const: true },
            profile: { properties: { mode: { enum: ["isolated_new", "isolated_named"] } } },
          },
          required: ["allow_launch", "profile"],
        },
      ],
      properties: {
        allow_launch: { type: "boolean" },
        pid: { type: "integer" },
        profile: {
          type: "object",
          properties: { mode: { type: "string", enum: ["isolated_new", "isolated_named"] } },
          required: ["mode"],
        },
      },
      required: [],
    });
    // SAFETY: toTypebox returns a TypeBox JSON Schema; this test reads only
    // standard JSON Schema fields represented by SchemaNode.
    const inspected = schema as SchemaNode;

    expect(inspected.type).toBe("object");
    expect(inspected.additionalProperties).toBe(true);
    expect(inspected.properties?.pid.type).toBe("integer");
    expect(inspected.properties?.profile.type).toBe("object");
    expect(inspected.properties?.profile.required).toEqual(["mode"]);
  });

  it("preserves nested combinators, nullability, const and Google-compatible string enums", () => {
    const schema = toTypebox({
      type: "object",
      properties: {
        value: { anyOf: [{ type: "string" }, { type: "null" }] },
        flag: { type: ["boolean", "null"] },
        mode: { type: "string", enum: ["ax", "vision"] },
        enabled: { const: true },
      },
      required: ["value"],
    });
    // SAFETY: toTypebox returns a TypeBox JSON Schema; this test reads only
    // standard JSON Schema fields represented by SchemaNode.
    const inspected = schema as SchemaNode;

    expect(inspected.type).toBe("object");
    expect(inspected.required).toEqual(["value"]);
    expect(inspected.properties?.value.anyOf?.map((item) => item.type)).toEqual(["string", "null"]);
    expect(inspected.properties?.flag.anyOf?.map((item) => item.type)).toEqual(["boolean", "null"]);
    expect(inspected.properties?.mode).toMatchObject({ type: "string", enum: ["ax", "vision"] });
    expect(inspected.properties?.enabled).toMatchObject({ type: "boolean", const: true });
  });

  it("collects properties declared only inside root combinator branches", () => {
    const schema = toTypebox({
      oneOf: [
        { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
        { type: "object", properties: { id: { type: "integer" } }, required: ["id"] },
      ],
    });
    // SAFETY: toTypebox returns a TypeBox JSON Schema; this test reads only
    // standard JSON Schema fields represented by SchemaNode.
    const inspected = schema as SchemaNode;

    expect(inspected.type).toBe("object");
    expect(Object.keys(inspected.properties ?? {})).toEqual(["query", "id"]);
    // A field required by only one choice cannot be globally required.
    expect(inspected.required).toBeUndefined();
  });

  it("always returns an object schema for malformed, nullable or absent root schemas", () => {
    expect(toTypebox(undefined)).toMatchObject({ type: "object" });
    expect(toTypebox({ anyOf: [] })).toMatchObject({ type: "object" });
    expect(toTypebox({ type: "object", nullable: true })).toMatchObject({ type: "object" });
  });
});

describe("Pi MCP tool names and output bounds", () => {
  it("keeps collision suffixes inside the provider 64-character limit", () => {
    const used = new Set<string>();
    const long = "x".repeat(100);
    const names = Array.from({ length: 12 }, () => {
      const name = allocateToolName("computer", long, used);
      used.add(name);
      return name;
    });

    expect(new Set(names).size).toBe(names.length);
    expect(names.every((name) => name.length <= 64)).toBe(true);
    expect(names.at(-1)).toMatch(/_12$/);
  });

  it("truncates by lines and UTF-8 bytes without splitting a code point", () => {
    const manyLines = Array.from({ length: 2_100 }, (_, index) => `line ${index}`).join("\n");
    expect(truncateToolText(manyLines)).toContain("2000-line limit");

    const manyAccents = "á".repeat(30_000);
    const truncated = truncateToolText(manyAccents);
    expect(truncated).toContain("50KB limit");
    expect(truncated).not.toContain("�");
  });
});

describe("StdioMcp", () => {
  it("initializes, paginates tools/list, preserves images and truncates text", async () => {
    const client = createClient(`
      let buffer = "";
      process.stdin.setEncoding("utf8");
      const send = (value) => process.stdout.write(JSON.stringify(value) + "\\n");
      process.stdin.on("data", (chunk) => {
        buffer += chunk;
        let newline;
        while ((newline = buffer.indexOf("\\n")) !== -1) {
          const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
          if (!line.trim()) continue;
          const msg = JSON.parse(line);
          if (msg.method === "initialize") send({ jsonrpc: "2.0", id: msg.id, result: { capabilities: { tools: {} } } });
          else if (msg.method === "tools/list" && !msg.params?.cursor) send({ jsonrpc: "2.0", id: msg.id, result: { tools: [{ name: "first", inputSchema: { type: "object" } }], nextCursor: "page-2" } });
          else if (msg.method === "tools/list") send({ jsonrpc: "2.0", id: msg.id, result: { tools: [{ name: "second", inputSchema: { type: "object" } }] } });
          else if (msg.method === "tools/call") send({ jsonrpc: "2.0", id: msg.id, result: { content: [
            { type: "text", text: "x".repeat(60 * 1024) },
            { type: "image", data: "aW1hZ2U=", mimeType: "image/png" }
          ] } });
        }
      });
    `);

    await client.init();
    await expect(client.listTools()).resolves.toMatchObject([{ name: "first" }, { name: "second" }]);
    const result = await client.callTool("first", {});
    expect(result.content[0]).toMatchObject({ type: "text", text: expect.stringContaining("50KB limit") });
    expect(result.content[1]).toEqual({ type: "image", data: "aW1hZ2U=", mimeType: "image/png" });
  });

  it("propagates abort and sends MCP notifications/cancelled", async () => {
    const dir = tempDir();
    const dump = join(dir, "cancel.json");
    const client = createClient(
      `
        import { writeFileSync } from "node:fs";
        let buffer = "";
        process.stdin.setEncoding("utf8");
        const send = (value) => process.stdout.write(JSON.stringify(value) + "\\n");
        process.stdin.on("data", (chunk) => {
          buffer += chunk;
          let newline;
          while ((newline = buffer.indexOf("\\n")) !== -1) {
            const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
            if (!line.trim()) continue;
            const msg = JSON.parse(line);
            if (msg.method === "initialize") send({ jsonrpc: "2.0", id: msg.id, result: { capabilities: { tools: {} } } });
            else if (msg.method === "notifications/cancelled") writeFileSync(process.env.DUMP, JSON.stringify(msg.params));
          }
        });
      `,
      { DUMP: dump },
    );
    await client.init();
    const controller = new AbortController();
    const pending = client.callTool("slow", {}, controller.signal);
    controller.abort();
    await expect(pending).rejects.toThrow(/aborted/);
    await vi.waitFor(() => expect(JSON.parse(readFileSync(dump, "utf8"))).toMatchObject({ requestId: 2 }));
  });
});

describe("Pi MCP startup budgets", () => {
  /** Lets real I/O run, the faked clock standing still, until `condition`. */
  async function untilReal(condition: () => boolean): Promise<void> {
    const started = Date.now();
    while (!condition() && Date.now() - started < 15_000) await new Promise((resolve) => setImmediate(resolve));
    expect(condition()).toBe(true);
  }
  function watch<T>(pending: Promise<T>) {
    const state: { done: boolean; value?: T; error?: unknown } = { done: false };
    void pending.then((value) => { state.done = true; state.value = value; }, (error: unknown) => { state.done = true; state.error = error; });
    return state;
  }

  it("gives a searched URL server 30 seconds to start, the same server mounted plainly 8", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const remote = await startFakeHttpMcp({ tools: whopLikeCatalog(300), toolsDelayMs: 20_000 });
    try {
      const descriptor = mcpStdioServer({ type: "http", url: remote.url, headers: {} }, { directory: { name: "whop" } })!;
      const server = { command: descriptor.command, args: descriptor.args, env: descriptor.env };
      const searched = new StdioMcp({ ...server, directory: true });
      clients.push(searched);
      const listing = watch(searched.init().then(() => searched.listTools()));
      await untilReal(() => remote.delayedToolsLists === 1);
      await vi.advanceTimersByTimeAsync(20_000);
      await untilReal(() => listing.done);
      expect(listing.error).toBeUndefined();
      expect(listing.value!.map((tool) => tool.name)).toEqual(["search_tools", "describe_tool", "call_tool"]);

      const plain = new StdioMcp(server);
      clients.push(plain);
      const failing = watch(plain.init().then(() => plain.listTools()));
      await untilReal(() => remote.delayedToolsLists === 2);
      await vi.advanceTimersByTimeAsync(8_000);
      await untilReal(() => failing.done);
      expect(String(failing.error)).toMatch(/timed out/);
    } finally {
      vi.useRealTimers();
      await remote.close();
    }
  });
});

describe("Pi MCP extension registration", () => {
  it("refreshes a switched role before the next call and resets warm declarations on the next turn", async () => {
    const dir = tempDir();
    const rolePath = join(dir, "role");
    writeFileSync(rolePath, "default");
    const script = fakeMcpScript(`
      import { readFileSync, writeFileSync } from "node:fs";
      import { createInterface } from "node:readline";
      const send = (value) => process.stdout.write(JSON.stringify(value) + "\\n");
      let failNextList = false;
      createInterface({ input: process.stdin }).on("line", (line) => {
        const msg = JSON.parse(line);
        if (msg.method === "initialize") send({ jsonrpc: "2.0", id: msg.id, result: { capabilities: { tools: { listChanged: true } } } });
        else if (msg.method === "tools/list" && failNextList) {
          failNextList = false;
          send({ jsonrpc: "2.0", id: msg.id, error: { code: -32000, message: "Discovery unavailable" } });
        } else if (msg.method === "tools/list") send({ jsonrpc: "2.0", id: msg.id, result: { tools: [
          { name: "identity_switch", inputSchema: { type: "object", properties: { profile: { type: "string" } } } },
          { name: readFileSync(process.env.ROLE_PATH, "utf8") === "billing" ? "write_bill" : "read_ticket", inputSchema: { type: "object", properties: {} } },
        ] } });
        else if (msg.method === "tools/call") {
          if (msg.params.name === "identity_switch") {
            writeFileSync(process.env.ROLE_PATH, msg.params.arguments.profile);
            send({ jsonrpc: "2.0", method: "notifications/tools/list_changed" });
          }
          if (msg.params.name === "write_bill") {
            failNextList = true;
            send({ jsonrpc: "2.0", method: "notifications/tools/list_changed" });
          }
          send({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: msg.params.name }] } });
        }
      });
    `);
    process.env.SAGAX_MCP_CONFIG = join(dir, "mcp.json");
    writeFileSync(process.env.SAGAX_MCP_CONFIG, JSON.stringify({ mcpServers: {
      perspicax: { command: process.execPath, args: [script], env: { ROLE_PATH: rolePath }, scope: "custom" },
    } }));
    const tools = new Map<string, RegisteredTool>();
    const registrations = new Map<string, number>();
    const handlers = new Map<string, ShutdownHandler>();
    let active = ["native_read"];
    await extension({
      registerTool(tool) {
        tools.set(tool.name, tool);
        registrations.set(tool.name, (registrations.get(tool.name) ?? 0) + 1);
        active = [...new Set([...active, tool.name])];
      },
      on(event, handler) { handlers.set(event, handler); },
      getActiveTools: () => active,
      setActiveTools: (names) => { active = names; },
    });
    const confirm = vi.fn(async () => true);
    const run = (name: string, args = {}) => tools.get(name)!.execute("call", args, undefined, undefined, { ui: { confirm } });
    try {
      expect(active).toEqual(["native_read", "perspicax_identity_switch", "perspicax_read_ticket"]);
      await expect(run("perspicax_identity_switch", { profile: "billing" })).resolves.toMatchObject({ content: [{ text: "identity_switch" }] });
      expect(active).toEqual(["native_read", "perspicax_identity_switch", "perspicax_write_bill"]);
      await expect(run("perspicax_write_bill")).resolves.toMatchObject({ content: [{ text: "write_bill" }, { text: expect.stringContaining("Its result still applies") }] });
      expect(confirm).toHaveBeenCalledTimes(2);
      expect(confirm).toHaveBeenLastCalledWith("Allow perspicax:write_bill?", "Run perspicax:write_bill");
      // Sagax ends the role at the generation boundary while Pi stays warm.
      writeFileSync(rolePath, "default");
      await handlers.get("before_agent_start")?.({});
      expect(active).toEqual(["native_read", "perspicax_identity_switch", "perspicax_read_ticket"]);
      expect([...tools.keys()]).toEqual(["perspicax_identity_switch", "perspicax_read_ticket", "perspicax_write_bill"]);
      expect([...registrations.values()]).toEqual([1, 1, 1]);
    } finally { await handlers.get("session_shutdown")?.(); }
  });

  const scopedApi = (initial: string[]) => {
    let active = initial;
    const tools: RegisteredTool[] = [];
    const handlers = new Map<string, (event?: any) => any>();
    return { tools, handlers, current: () => active, restore: (names: string[]) => { active = names; }, api: {
      registerTool(tool: RegisteredTool) { tools.push(tool); },
      on(event: string, handler: (event?: any) => any) { handlers.set(event, handler); },
      getActiveTools: () => [...active], setActiveTools: (names: string[]) => { active = names; },
    } };
  };
  const scopeConfig = (toolScope: unknown, other = {}) => {
    const dir = tempDir();
    process.env.SAGAX_MCP_CONFIG = join(dir, "scope.json");
    writeFileSync(process.env.SAGAX_MCP_CONFIG, JSON.stringify({ toolScope, ...other }));
    return dir;
  };

  it("intersects native and package tools before the first turn and after restoration", async () => {
    scopeConfig({ allow: ["native:read", "native:edit", "native:write"] });
    const f = scopedApi(["read", "write", "bash", "package_tool"]);
    await extension(f.api);
    await f.handlers.get("session_start")?.({});
    expect(f.current()).toEqual(["read", "write"]);
    f.restore(["read", "write", "bash", "late_package"]);
    await f.handlers.get("before_agent_start")?.({});
    expect(f.current()).toEqual(["read", "write"]);
    f.restore(["edit", "bash"]);
    await f.handlers.get("session_switch")?.({});
    await f.handlers.get("model_select")?.({});
    expect(f.current()).toEqual(["edit"]);
    expect(await f.handlers.get("tool_call")?.({ toolName: "bash" })).toMatchObject({ block: true });
    expect(await f.handlers.get("tool_call")?.({ toolName: "read" })).toBeUndefined();
    f.restore(["read", "bash"]);
    const payload = { tools: ["read", "bash", "late_package"].map((name) => ({ type: "function", function: { name, parameters: { type: "object" } } })) };
    await f.handlers.get("before_provider_request")?.({ payload });
    expect(payload.tools.map((tool) => tool.function.name)).toEqual(["read"]);
  });

  it("does not confirm a refused active-tool clamp or restore a tool another extension disabled", async () => {
    const directory = scopeConfig({ allow: ["native:read", "native:write"] });
    const readyPath = join(directory, "ready.json");
    scopeConfig({ allow: ["native:read", "native:write"] }, { scopeReadyPath: readyPath });
    const refused = scopedApi(["read", "bash"]);
    refused.api.setActiveTools = () => {};
    await extension(refused.api);
    expect(() => refused.handlers.get("session_start")?.({})).toThrow(/enforcement/i);
    expect(JSON.parse(readFileSync(readyPath, "utf8"))).toEqual({ ok: false });
    const f = scopedApi(["write"]);
    await extension(f.api);
    const payload = { tools: ["read", "write"].map((name) => ({ name, input_schema: { type: "object" } })) };
    await f.handlers.get("before_provider_request")?.({ payload });
    expect(payload.tools.map((tool) => tool.name)).toEqual(["write"]);
  });

  it("makes no-tools explicit and refuses unavailable enforcement APIs or corrupt configuration", async () => {
    scopeConfig({ allow: [] });
    const f = scopedApi(["read", "bash"]);
    await extension(f.api);
    await f.handlers.get("session_start")?.({});
    expect(f.current()).toEqual([]);
    expect(await f.handlers.get("tool_call")?.({ toolName: "read" })).toMatchObject({ block: true });
    await expect(extension({ registerTool() {}, on() {} })).rejects.toThrow(/enforcement/i);
    writeFileSync(process.env.SAGAX_MCP_CONFIG!, "not json");
    await expect(extension(f.api)).rejects.toThrow(/configuration/i);
  });

  it("removes declarations if enforcement becomes unavailable after startup", async () => {
    scopeConfig({ allow: ["native:read"] });
    const f = scopedApi(["read"]);
    await extension(f.api);
    await f.handlers.get("session_start")?.({});
    f.api.setActiveTools = () => {};
    f.restore(["read", "bash"]);
    const payload = { tools: ["read", "bash"].map((name) => ({ type: "function", function: { name } })) };
    // Pi catches extension exceptions and can keep sending the old payload.
    // This hook must return a deny-all declaration rather than throw past it.
    await f.handlers.get("before_provider_request")?.({ payload });
    expect(payload.tools).toEqual([]);
  });

  it("filters raw MCP identities and still asks before custom execution", async () => {
    const receipt = join(tempDir(), "execution.txt");
    const script = fakeMcpScript(`
      import { createInterface } from "node:readline";
      import { writeFileSync } from "node:fs";
      createInterface({input:process.stdin}).on("line", line => {
        const m = JSON.parse(line); if (m.id === undefined) return;
        let result = {};
        if (m.method === "tools/list") result = {tools:[{name:"read-notes",inputSchema:{type:"object"}},{name:"read_notes",inputSchema:{type:"object"}}]};
        if (m.method === "tools/call") { writeFileSync(process.env.RECEIPT, m.params.name); result = {content:[{type:"text",text:"selected"}]}; }
        process.stdout.write(JSON.stringify({jsonrpc:"2.0",id:m.id,result}) + "\\n");
      });
    `);
    scopeConfig({ allow: ["mcp:mail:read-notes"] }, { mcpServers: { mail: { command: process.execPath, args: [script], env: { RECEIPT: receipt }, scope: "custom" } } });
    const f = scopedApi(["read", "mail_read_notes"]);
    await extension(f.api);
    try {
      expect(f.tools.map((tool) => tool.name)).toEqual(["mail_read_notes"]);
      const blocked = await f.tools[0].execute("denied", {}, undefined, undefined, { ui: { confirm: async () => false } });
      expect(blocked.content).toMatchObject([{ text: "Blocked by the user." }]);
      expect(existsSync(receipt)).toBe(false);
      await f.tools[0].execute("allowed", {}, undefined, undefined, { ui: { confirm: async () => true } });
      expect(readFileSync(receipt, "utf8")).toBe("read-notes");
      expect(await f.handlers.get("tool_call")?.({ toolName: "mail_read_notes_2" })).toMatchObject({ block: true });
    } finally { await f.handlers.get("session_shutdown")?.(); }
  });
  // #1982: Full also confirms so Sagax's gate sees the call (reads/writes
  // follow the level in index.ts). confirm(false) declines; confirm(true)
  // stands for the harness Full-approving.
  it.each([["ask"], ["auto"], ["edits"], ["full"]] as const)("asks before Sagax's own Browser and Data tools at %s, as on Claude (engine parity)", async (approvalMode) => {
    const receipt = join(tempDir(), "data-call.txt");
    const script = fakeMcpScript(`
      import { createInterface } from "node:readline";
      import { writeFileSync } from "node:fs";
      createInterface({input:process.stdin}).on("line", line => {
        const m = JSON.parse(line); if (m.id === undefined) return;
        let result = {};
        if (m.method === "tools/list") result = {tools:[{name:"data_sql",inputSchema:{type:"object"}}]};
        if (m.method === "tools/call") { writeFileSync(process.env.RECEIPT, m.params.name); result = {content:[{type:"text",text:"ran"}]}; }
        process.stdout.write(JSON.stringify({jsonrpc:"2.0",id:m.id,result}) + "\\n");
      });
    `);
    const servers = buildMcpServers({ threadId: "pi-data", text: "Go", approvalMode, integrations: { data: { command: process.execPath, args: [script], env: { RECEIPT: receipt } } } });
    expect(servers?.data).toMatchObject({ scope: "approval" });
    scopeConfig(undefined, { mcpServers: servers, approvalMode });
    const tools: RegisteredTool[] = [];
    const handlers = new Map<string, ShutdownHandler>();
    await extension({ registerTool(tool) { tools.push(tool); }, on(event, handler) { handlers.set(event, handler); } });
    try {
      const asked: string[] = [];
      const ui = { confirm: async (title: string) => { asked.push(title); return false; } };
      await tools[0].execute("call", { sql: "select 1" }, undefined, undefined, { ui });
      expect(asked).toEqual(["Allow data:data_sql?"]);
      expect(existsSync(receipt)).toBe(false);
      asked.length = 0;
      await tools[0].execute("call", { sql: "select 1" }, undefined, undefined, { ui: { confirm: async (title: string) => { asked.push(title); return true; } } });
      expect(asked).toEqual(["Allow data:data_sql?"]);
      expect(readFileSync(receipt, "utf8")).toBe("data_sql");
    } finally { await handlers.get("session_shutdown")?.(); }
  });

  it.each([["ask"], ["auto"], ["edits"], ["full"]] as const)("asks before each tool on the person's own computer at %s (#1982 Full reaches Sagax)", async (approvalMode) => {
    const receipt = join(tempDir(), "computer-call.txt");
    const script = fakeMcpScript(`
      import { createInterface } from "node:readline";
      import { writeFileSync } from "node:fs";
      createInterface({input:process.stdin}).on("line", line => {
        const m = JSON.parse(line); if (m.id === undefined) return;
        let result = {};
        if (m.method === "tools/list") result = {tools:[{name:"click",inputSchema:{type:"object"}}]};
        if (m.method === "tools/call") { writeFileSync(process.env.RECEIPT, m.params.name); result = {content:[{type:"text",text:"ran"}]}; }
        process.stdout.write(JSON.stringify({jsonrpc:"2.0",id:m.id,result}) + "\\n");
      });
    `);
    const servers = buildMcpServers({ threadId: "pi-computer", text: "Go", approvalMode, integrations: { localComputer: { command: process.execPath, args: [script], env: { RECEIPT: receipt }, scope: "local-computer" } } });
    expect(servers?.computer).toMatchObject({ scope: "local-computer" });
    scopeConfig(undefined, { mcpServers: servers, approvalMode });
    const tools: RegisteredTool[] = [];
    const handlers = new Map<string, ShutdownHandler>();
    await extension({ registerTool(tool) { tools.push(tool); }, on(event, handler) { handlers.set(event, handler); } });
    try {
      const asked: string[] = [];
      const ui = { confirm: async (title: string) => { asked.push(title); return false; } };
      await tools[0].execute("call", { x: 1 }, undefined, undefined, { ui });
      expect(asked).toEqual(["Allow click on your computer?"]);
      expect(existsSync(receipt)).toBe(false);
      asked.length = 0;
      await tools[0].execute("call", { x: 1 }, undefined, undefined, { ui: { confirm: async (title: string) => { asked.push(title); return true; } } });
      expect(asked).toEqual(["Allow click on your computer?"]);
      expect(readFileSync(receipt, "utf8")).toBe("click");
    } finally { await handlers.get("session_shutdown")?.(); }
  });

  it("still asks on the person's own computer when the turn names no mode (legacy callers)", async () => {
    const receipt = join(tempDir(), "computer-legacy.txt");
    const script = fakeMcpScript(`
      import { createInterface } from "node:readline";
      import { writeFileSync } from "node:fs";
      createInterface({input:process.stdin}).on("line", line => {
        const m = JSON.parse(line); if (m.id === undefined) return;
        let result = {};
        if (m.method === "tools/list") result = {tools:[{name:"click",inputSchema:{type:"object"}}]};
        if (m.method === "tools/call") { writeFileSync(process.env.RECEIPT, m.params.name); result = {content:[{type:"text",text:"ran"}]}; }
        process.stdout.write(JSON.stringify({jsonrpc:"2.0",id:m.id,result}) + "\\n");
      });
    `);
    scopeConfig(undefined, { mcpServers: { computer: { command: process.execPath, args: [script], env: { RECEIPT: receipt }, scope: "local-computer" } } });
    const tools: RegisteredTool[] = [];
    const handlers = new Map<string, ShutdownHandler>();
    await extension({ registerTool(tool) { tools.push(tool); }, on(event, handler) { handlers.set(event, handler); } });
    try {
      const asked: string[] = [];
      await tools[0].execute("call", {}, undefined, undefined, { ui: { confirm: async (title: string) => { asked.push(title); return false; } } });
      expect(asked).toEqual(["Allow click on your computer?"]);
      expect(existsSync(receipt)).toBe(false);
    } finally { await handlers.get("session_shutdown")?.(); }
  });

  it("registers a big URL server as three tools, asking only about the tool call_tool runs", async () => {
    const remote = await startFakeHttpMcp({ tools: whopLikeCatalog(300) });
    try {
      const servers = buildMcpServers({ threadId: "pi-whop", text: "Go", integrations: { custom: { whop: { type: "http", url: remote.url, headers: {} } } } });
      scopeConfig(undefined, { mcpServers: servers, approvalMode: "ask" });
      const tools: RegisteredTool[] = [];
      const handlers = new Map<string, ShutdownHandler>();
      await extension({ registerTool(tool) { tools.push(tool); }, on(event, handler) { handlers.set(event, handler); } });
      try {
        expect(tools.map((tool) => tool.name)).toEqual(["whop_search_tools", "whop_describe_tool", "whop_call_tool"]);
        const asked: string[] = [];
        const ui = { confirm: async (title: string) => { asked.push(title); return true; } };
        const search = await tools[0].execute("search", { query: "list payments" }, undefined, undefined, { ui });
        expect(JSON.parse((search.content[0] as { text: string }).text).matches[0].name).toBe("payments_list");
        await tools[1].execute("describe", { name: "payments_list" }, undefined, undefined, { ui });
        expect(asked).toEqual([]);
        await tools[2].execute("run", { name: "payments_list", arguments: { company_id: "biz_1" } }, undefined, undefined, { ui });
        expect(asked).toEqual(["Allow whop:payments_list?"]);
        expect(remote.calls).toEqual([{ name: "payments_list", arguments: { company_id: "biz_1" } }]);
      } finally { await handlers.get("session_shutdown")?.(); }
    } finally { await remote.close(); }
  });

  it("keeps a searched URL server to the bot's selection", async () => {
    const catalog = whopLikeCatalog(300);
    const selected = [...catalog.filter((tool) => tool.name.endsWith("_list")).map((tool) => tool.name), "payments_get", "stats_get"];
    const toolScope = { allow: selected.map((name) => `mcp:whop:${name}`) };
    const remote = await startFakeHttpMcp({ tools: catalog });
    try {
      const servers = buildMcpServers({ threadId: "pi-whop-scoped", text: "Go", toolScope, integrations: { custom: { whop: { type: "http", url: remote.url, headers: {} } } } });
      scopeConfig(toolScope, { mcpServers: servers, approvalMode: "ask" });
      const f = scopedApi(["read", "whop_search_tools", "whop_describe_tool", "whop_call_tool"]);
      await extension(f.api);
      try {
        expect(f.tools.map((tool) => tool.name)).toEqual(["whop_search_tools", "whop_describe_tool", "whop_call_tool"]);
        await f.handlers.get("session_start")?.({});
        expect(f.current()).toEqual(["whop_search_tools", "whop_describe_tool", "whop_call_tool"]);
        expect(await f.handlers.get("tool_call")?.({ toolName: "whop_call_tool" })).toBeUndefined();
        const asked: string[] = [];
        const ui = { confirm: async (title: string) => { asked.push(title); return true; } };
        // refused here, before any card asks about a tool the bot may not use
        await expect(f.tools[2].execute("excluded", { name: "payments_create", arguments: {} }, undefined, undefined, { ui })).rejects.toThrow("Tool selection excludes this tool");
        expect(asked).toEqual([]);
        expect(remote.calls).toEqual([]);
        const found = await f.tools[0].execute("search", { query: "create payments", limit: 20 }, undefined, undefined, { ui });
        const names = JSON.parse((found.content[0] as { text: string }).text).matches.map((match: { name: string }) => match.name);
        expect(names.every((name: string) => selected.includes(name))).toBe(true);
        await f.tools[2].execute("selected", { name: "payments_list", arguments: { company_id: "biz_1" } }, undefined, undefined, { ui });
        expect(asked).toEqual(["Allow whop:payments_list?"]);
        expect(remote.calls).toEqual([{ name: "payments_list", arguments: { company_id: "biz_1" } }]);
      } finally { await f.handlers.get("session_shutdown")?.(); }
    } finally { await remote.close(); }
  });

  it("keeps earlier tools alive when a later registration fails", async () => {
    const script = fakeMcpScript(`
      let buffer = "";
      process.stdin.setEncoding("utf8");
      const send = (value) => process.stdout.write(JSON.stringify(value) + "\\n");
      process.stdin.on("data", (chunk) => {
        buffer += chunk;
        let newline;
        while ((newline = buffer.indexOf("\\n")) !== -1) {
          const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
          if (!line.trim()) continue;
          const msg = JSON.parse(line);
          if (msg.method === "initialize") send({ jsonrpc: "2.0", id: msg.id, result: { capabilities: { tools: {} } } });
          else if (msg.method === "tools/list") send({ jsonrpc: "2.0", id: msg.id, result: { tools: [
            { name: "good", inputSchema: { type: "object", properties: {} } },
            { name: "bad", inputSchema: { type: "object", properties: {} } }
          ] } });
          else if (msg.method === "tools/call") send({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: "still alive" }] } });
        }
      });
    `);
    const dir = tempDir();
    const config = join(dir, "mcp.json");
    writeFileSync(config, JSON.stringify({ mcpServers: { test: { command: process.execPath, args: [script] } } }));
    process.env.SAGAX_MCP_CONFIG = config;

    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const tools: RegisteredTool[] = [];
    const handlers = new Map<string, ShutdownHandler>();
    await extension({
      registerTool(tool) {
        if (tool.name.endsWith("_bad")) throw new Error("synthetic registration failure");
        tools.push(tool);
      },
      on(event, handler) {
        handlers.set(event, handler);
      },
    });

    expect(tools).toHaveLength(1);
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining("synthetic registration failure"));
    await expect(
      tools[0].execute("call-1", {}, undefined, undefined, { ui: { confirm: async () => true } }),
    ).resolves.toMatchObject({ content: [{ type: "text", text: "still alive" }] });
    await handlers.get("session_shutdown")?.();
  });

  it("hands its tool lists to the next pi, which declares them and connects at the first call (#1276)", async () => {
    const dir = tempDir();
    const live = join(dir, "turn-live");
    // a server whose credentials hold only while a turn runs: between turns
    // (when the standby pi starts) it can list nothing
    const script = fakeMcpScript(`
      const { existsSync } = await import("node:fs");
      let buffer = "";
      process.stdin.setEncoding("utf8");
      const send = (value) => process.stdout.write(JSON.stringify(value) + "\\n");
      process.stdin.on("data", (chunk) => {
        buffer += chunk;
        let newline;
        while ((newline = buffer.indexOf("\\n")) !== -1) {
          const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
          if (!line.trim()) continue;
          const msg = JSON.parse(line);
          const ok = existsSync(${JSON.stringify(live)});
          if (msg.method === "initialize") send({ jsonrpc: "2.0", id: msg.id, result: { capabilities: { tools: {} } } });
          else if (!ok) send({ jsonrpc: "2.0", id: msg.id, error: { message: "unauthorized" } });
          else if (msg.method === "tools/list") send({ jsonrpc: "2.0", id: msg.id, result: { tools: [{ name: "lookup", description: "Look up", inputSchema: { type: "object", properties: {} } }] } });
          else if (msg.method === "tools/call") send({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: "found" }] } });
        }
      });
    `);
    const server = { command: process.execPath, args: [script] };
    const mount = async (config: Record<string, unknown>) => {
      const path = join(dir, `mcp-${Math.random()}.json`);
      writeFileSync(path, JSON.stringify({ mcpServers: { data: server }, ...config }));
      process.env.SAGAX_MCP_CONFIG = path;
      const tools: RegisteredTool[] = [];
      const handlers = new Map<string, ShutdownHandler>();
      await extension({ registerTool(tool) { tools.push(tool); }, on(event, handler) { handlers.set(event, handler); } });
      return { tools, shutdown: async () => handlers.get("session_shutdown")?.() };
    };

    writeFileSync(live, "1");
    const cachePath = join(dir, "tools.json");
    const first = await mount({ toolCachePath: cachePath });
    expect(first.tools.map((tool) => tool.name)).toEqual(["data_lookup"]);
    await first.shutdown();
    const toolCache = JSON.parse(readFileSync(cachePath, "utf8"));
    expect(toolCache).toEqual({ data: [{ name: "lookup", description: "Look up", inputSchema: { type: "object", properties: {} } }] });

    // between turns: listing fails, the previous list stands in (same declaration)
    await removeTempDir(live);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const nextCache = join(dir, "tools-next.json");
    const standby = await mount({ toolCache, toolCachePath: nextCache });
    expect(standby.tools.map((tool) => [tool.name, tool.description])).toEqual([["data_lookup", "Look up"]]);
    expect(stderr).not.toHaveBeenCalled();
    // and passes it on to the pi after it
    expect(JSON.parse(readFileSync(nextCache, "utf8"))).toEqual(toolCache);

    // the next turn runs: the first call connects
    writeFileSync(live, "1");
    await expect(
      standby.tools[0].execute("call-1", {}, undefined, undefined, { ui: { confirm: async () => true } }),
    ).resolves.toMatchObject({ content: [{ type: "text", text: "found" }] });
    await standby.shutdown();

    // with no list to stand in, a server that cannot list stays unmounted
    await removeTempDir(live);
    const bare = await mount({});
    expect(bare.tools).toEqual([]);
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining("unauthorized"));
    await bare.shutdown();
  });

  it("throws when an MCP tool result declares isError", async () => {
    const script = fakeMcpScript(`
      let buffer = "";
      process.stdin.setEncoding("utf8");
      const send = (value) => process.stdout.write(JSON.stringify(value) + "\\n");
      process.stdin.on("data", (chunk) => {
        buffer += chunk;
        let newline;
        while ((newline = buffer.indexOf("\\n")) !== -1) {
          const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
          if (!line.trim()) continue;
          const msg = JSON.parse(line);
          if (msg.method === "initialize") send({ jsonrpc: "2.0", id: msg.id, result: { capabilities: { tools: {} } } });
          else if (msg.method === "tools/list") send({ jsonrpc: "2.0", id: msg.id, result: { tools: [{ name: "fail", inputSchema: { type: "object", properties: {} } }] } });
          else if (msg.method === "tools/call") send({ jsonrpc: "2.0", id: msg.id, result: { isError: true, content: [{ type: "text", text: "remote failure" }] } });
        }
      });
    `);
    const dir = tempDir();
    const config = join(dir, "mcp.json");
    writeFileSync(config, JSON.stringify({ mcpServers: { test: { command: process.execPath, args: [script] } } }));
    process.env.SAGAX_MCP_CONFIG = config;

    const tools: RegisteredTool[] = [];
    const handlers = new Map<string, ShutdownHandler>();
    await extension({
      registerTool(tool) {
        tools.push(tool);
      },
      on(event, handler) {
        handlers.set(event, handler);
      },
    });

    expect(tools).toHaveLength(1);
    await expect(
      tools[0].execute("call-1", {}, undefined, undefined, { ui: { confirm: async () => true } }),
    ).rejects.toThrow("remote failure");
    await handlers.get("session_shutdown")?.();
  });
});

describe("stableCwdTurn (#1276)", () => {
  it("names a fixed text in pi's cwd section and hands the real folder to the turn", () => {
    const options: { cwd?: unknown } = { cwd: "/work/bot/thread-a" };
    expect(stableCwdTurn(options)).toEqual({ customType: "sagax-cwd", content: "Current working directory: /work/bot/thread-a", display: false });
    expect(options.cwd).toBe(STABLE_CWD_NOTE);
    // the same text for every conversation
    const other: { cwd?: unknown } = { cwd: "/work/bot/thread-b" };
    stableCwdTurn(other);
    expect(other.cwd).toBe(options.cwd);
  });

  it("leaves an already fixed or missing cwd alone", () => {
    expect(stableCwdTurn({ cwd: STABLE_CWD_NOTE })).toBeUndefined();
    expect(stableCwdTurn({})).toBeUndefined();
  });
});

describe("splitStableMessages (#1276)", () => {
  it("cuts the marked message around a fixed reply and keeps the messages that end at the shared part", () => {
    const system = { role: "system", content: "sys" };
    const first = { role: "user", content: `shared${STABLE_END_MARKER}recent work\n\nquestion` };
    const later = [{ role: "assistant", content: "answer" }, { role: "user", content: "next" }];
    const split = splitStableMessages([system, first, ...later]);
    expect(split?.messages).toEqual([
      system,
      { role: "user", content: "shared" },
      { role: "assistant", content: STABLE_ACK },
      { role: "user", content: "recent work\n\nquestion" },
      ...later,
    ]);
    expect(split?.stable).toEqual([system, { role: "user", content: "shared" }]);
  });

  it("reads text parts and leaves an unmarked transcript alone", () => {
    const parts = { role: "user", content: [{ type: "text", text: "shared" }, { type: "text", text: `${STABLE_END_MARKER}rest` }] };
    expect(splitStableMessages([parts])?.messages).toEqual([
      { role: "user", content: "shared" },
      { role: "assistant", content: STABLE_ACK },
      { role: "user", content: "rest" },
    ]);
    expect(splitStableMessages([{ role: "user", content: "plain" }])).toBeUndefined();
  });
});

describe("stable split and warm request (#1276)", () => {
  it("rewrites every provider request and writes the warm request once, without credentials", async () => {
    const dir = tempDir();
    const warmPath = join(dir, "warm.json");
    process.env.SAGAX_MCP_CONFIG = join(dir, "mcp.json");
    writeFileSync(process.env.SAGAX_MCP_CONFIG, JSON.stringify({ splitStable: true, warmPath }));
    const handlers = new Map<string, (event?: any, context?: any) => any>();
    await extension({ registerTool() {}, on(event, handler) { handlers.set(event, handler); } });
    const payload = { model: "local", stream: true, stream_options: { include_usage: true }, max_completion_tokens: 900, tools: [{ type: "function" }], messages: [
      { role: "system", content: "sys" },
      { role: "user", content: `shared${STABLE_END_MARKER}question` },
    ] };
    const sent = await handlers.get("before_provider_request")!({ payload });
    expect(sent.messages.map((message: { content: string }) => message.content)).toEqual(["sys", "shared", STABLE_ACK, "question"]);
    expect(JSON.parse(readFileSync(warmPath, "utf8"))).toEqual({
      model: "local", tools: [{ type: "function" }], max_tokens: 1, stream: false,
      messages: [{ role: "system", content: "sys" }, { role: "user", content: "shared" }],
    });
    await handlers.get("before_provider_request")!({ payload: { ...payload, messages: [{ role: "user", content: `other${STABLE_END_MARKER}x` }] } });
    expect(JSON.parse(readFileSync(warmPath, "utf8")).messages).toEqual([{ role: "system", content: "sys" }, { role: "user", content: "shared" }]);
  });

  it("sends the warm request once when a standby resumes its session, through the session's provider", async () => {
    const dir = tempDir();
    const warm = { model: "local", messages: [{ role: "user", content: "shared" }], max_tokens: 1, stream: false };
    const config = { warm, warmPath: join(dir, "warm.json") };
    const fetched: Array<{ url: string; init: RequestInit }> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => { fetched.push({ url: String(url), init: init! }); return new Response("{}"); });
    const context = {
      model: { id: "local", api: "openai-completions", baseUrl: "http://127.0.0.1:8000/v1/" },
      modelRegistry: { getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "test-key" }) },
    };
    const start = async () => {
      process.env.SAGAX_MCP_CONFIG = join(dir, `mcp-${Math.random()}.json`);
      writeFileSync(process.env.SAGAX_MCP_CONFIG, JSON.stringify(config));
      const handlers = new Map<string, (event?: any, context?: any) => any>();
      await extension({ registerTool() {}, on(event, handler) { handlers.set(event, handler); } });
      return handlers.get("session_start")!;
    };
    const first = await start();
    await first({ reason: "startup" }, context);
    expect(fetched).toEqual([]);
    await first({ reason: "resume" }, context);
    // pi loads the extension again for the resumed session: still one warm
    await (await start())({ reason: "resume" }, context);
    await vi.waitFor(() => expect(fetched).toHaveLength(1));
    expect(fetched[0].url).toBe("http://127.0.0.1:8000/v1/chat/completions");
    expect(fetched[0].init.headers).toMatchObject({ authorization: "Bearer test-key" });
    expect(JSON.parse(String(fetched[0].init.body))).toEqual(warm);
  });
  it("sends no warm request when the resumed session is on another model (a cloud key would pay for it)", async () => {
    const dir = tempDir();
    const warm = { model: "local", messages: [{ role: "user", content: "shared" }], max_tokens: 1, stream: false };
    const fetched: unknown[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => { fetched.push(url); return new Response("{}"); });
    process.env.SAGAX_MCP_CONFIG = join(dir, "mcp.json");
    writeFileSync(process.env.SAGAX_MCP_CONFIG, JSON.stringify({ warm, warmPath: join(dir, "warm.json") }));
    const handlers = new Map<string, (event?: any, context?: any) => any>();
    await extension({ registerTool() {}, on(event, handler) { handlers.set(event, handler); } });
    await handlers.get("session_start")!({ reason: "resume" }, {
      model: { id: "grok-4", api: "openai-completions", baseUrl: "https://api.x.ai/v1" },
      modelRegistry: { getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "xai-key" }) },
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fetched).toEqual([]);
  });
});

describe("Pi ask_user tool", () => {
  const load = async (config: Record<string, unknown>, active = ["read", "ask_user"]) => {
    const dir = tempDir();
    process.env.SAGAX_MCP_CONFIG = join(dir, "mcp.json");
    writeFileSync(process.env.SAGAX_MCP_CONFIG, JSON.stringify(config));
    const tools: RegisteredTool[] = [];
    let current = active;
    await extension({
      registerTool(tool) { tools.push(tool); },
      on() {},
      getActiveTools: () => [...current],
      setActiveTools: (names) => { current = names; },
    });
    return tools.find((tool) => tool.name === "ask_user");
  };
  // What pi's RPC mode does with each dialog: the driver answers with the
  // picked label, the person's typed words, or a cancel (undefined).
  const dialogs = (replies: Array<string | undefined>) => {
    const asked: Array<{ method: string; title: string; options?: string[] }> = [];
    const next = async () => replies.shift();
    return { asked, ctx: { ui: {
      confirm: async () => false,
      select: async (title: string, options: string[]) => { asked.push({ method: "select", title, options }); return next(); },
      input: async (title: string) => { asked.push({ method: "input", title }); return next(); },
    } } };
  };
  const QUESTIONS = { questions: [
    { question: "Which color?", options: [{ label: "Blue" }, { label: "Green", description: "the calm one" }] },
    { question: "Any notes?" },
  ] };

  it("registers only when the driver allows it and the selection includes native:ask_user", async () => {
    expect(await load({})).toBeUndefined();
    expect(await load({ askUser: true, toolScope: { allow: ["native:read"] } })).toBeUndefined();
    const tool = await load({ askUser: true, toolScope: { allow: ["native:ask_user"] } });
    expect(tool).toMatchObject({ name: "ask_user", exposure: "model-only" });
  });

  it("asks each question in turn and returns the answers in the shared Q:/A: form", async () => {
    const tool = (await load({ askUser: true }))!;
    const { asked, ctx } = dialogs(["Green", "Ship it on Friday"]);
    const result = await tool.execute("call-1", QUESTIONS, undefined, undefined, ctx);
    expect(asked).toEqual([
      // the description shows under the question; the labels stay exact
      { method: "select", title: "Which color?\n\nGreen: the calm one", options: ["Blue", "Green"] },
      { method: "input", title: "Any notes?" },
    ]);
    expect(result.content).toEqual([{ type: "text", text:
      "The user answered your questions.\n\nQ: Which color?\nA: Green\n\nQ: Any notes?\nA: Ship it on Friday" }]);
  });

  it("returns the person's own words when they answer a select in free text", async () => {
    const tool = (await load({ askUser: true }))!;
    const result = await tool.execute("call-2", { questions: [QUESTIONS.questions[0]] }, undefined, undefined, dialogs(["Purple, please"]).ctx);
    expect(result.content).toEqual([{ type: "text", text: "The user answered your questions.\n\nQ: Which color?\nA: Purple, please" }]);
  });

  it("says plainly when nobody answered, and stops at the first unanswered question", async () => {
    const tool = (await load({ askUser: true }))!;
    await expect(tool.execute("call-3", QUESTIONS, undefined, undefined, dialogs([undefined]).ctx)).rejects.toThrow(/did not answer/);
    const partial = dialogs(["Blue", undefined]);
    const result = await tool.execute("call-4", QUESTIONS, undefined, undefined, partial.ctx);
    expect(partial.asked).toHaveLength(2);
    expect(result.content[0]).toMatchObject({ text: expect.stringContaining("Q: Which color?\nA: Blue\n\nThe person did not answer the other questions.") });
  });

  it("refuses multi-select and malformed calls with words the model can act on", async () => {
    const tool = (await load({ askUser: true }))!;
    const { asked, ctx } = dialogs([]);
    await expect(tool.execute("call-5", { questions: [{ question: "Which?", multiSelect: true, options: [{ label: "A" }, { label: "B" }] }] }, undefined, undefined, ctx))
      .rejects.toThrow(/one answer per question/);
    await expect(tool.execute("call-6", { questions: [] }, undefined, undefined, ctx)).rejects.toThrow(/malformed/);
    expect(asked).toEqual([]);
  });
});
