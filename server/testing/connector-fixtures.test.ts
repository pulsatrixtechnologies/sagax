// Replays the measures of the real provider CLIs (issue #3343, part of #3286,
// docs/verification/connectors-hub-measures.md) through the three fakes, so
// the connector hub lots build on shapes a real CLI produced, not on guesses.
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { parseClaudeArtifactStream, type ClaudeArtifactTool } from "../claude-artifacts/runner.ts";
import { removeTempDir, waitForExit } from "./cleanup.ts";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const FIXTURES = join(HERE, "fixtures", "connectors");
const fixture = (name: string) => join(FIXTURES, name);
const readFixture = <T>(name: string): T => JSON.parse(readFileSync(fixture(name), "utf8")) as T;
const fakePath = (name: string) => join(HERE, name);

const children: ChildProcessWithoutNullStreams[] = [];
const temps: string[] = [];
afterEach(async () => {
  await Promise.all(children.splice(0).map((child) => waitForExit(child, { signal: "SIGTERM" })));
  await Promise.all(temps.splice(0).map((dir) => removeTempDir(dir)));
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "omb-connector-fixtures-"));
  temps.push(dir);
  return dir;
}

/** Runs a fake to its end and returns its stdout. */
function runToEnd(fake: string, args: string[], env: Record<string, string | undefined>): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fakePath(fake), ...args], { env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "pipe"] });
    children.push(child);
    let stdout = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.resume();
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve(stdout) : reject(new Error(`${fake} exited ${code}`))));
    child.stdin.end();
  });
}

type Frame = Record<string, any>;

/** A JSON-RPC session with a fake over stdio. Requests from the fake are kept. */
function rpcSession(fake: string, args: string[], env: Record<string, string | undefined>) {
  const child = spawn(process.execPath, [fakePath(fake), ...args], { env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "pipe"] });
  children.push(child);
  const frames: Frame[] = [];
  let buffer = "";
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      try { frames.push(JSON.parse(line) as Frame); } catch { /* a banner line */ }
    }
  });
  child.stderr.resume();
  let nextId = 0;
  const waitFor = async (match: (frame: Frame) => boolean): Promise<Frame> => {
    let found: Frame | undefined;
    await expect.poll(() => (found = frames.find(match)) !== undefined, { timeout: 15_000 }).toBe(true);
    return found!;
  };
  return {
    frames,
    waitFor,
    send: (frame: Frame) => child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...frame })}\n`),
    request: async (method: string, params: unknown = {}): Promise<Frame> => {
      const id = ++nextId;
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
      return waitFor((frame) => frame.id === id && frame.method === undefined);
    },
  };
}

const parseLines = (stdout: string): Frame[] => stdout.split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line) as Frame);

describe("connector fixtures are scrubbed", () => {
  // The repository is public: a capture keeps the shape and nothing of the
  // account it was read on.
  const files = readdirSync(FIXTURES);

  it("covers every capture of the measures", () => {
    expect(files.sort()).toEqual([
      "claude-connector-reach.json", "claude-mcp-serve.json", "claude-permission-allow.jsonl", "claude-permission-deny.jsonl",
      "claude-permission-log.json", "claude-pinned-call.jsonl", "codex-mcp-server-status.json", "codex-thread-start.json",
      "codex-tool-call.json", "grok-gateway-list.json", "grok-initialize.json", "grok-mcp-call.json", "grok-pinned-use-tool.json",
    ]);
  });

  it.each(readdirSync(FIXTURES))("%s holds no address, identifier, path or account name", (name) => {
    const text = readFileSync(fixture(name), "utf8");
    expect(text).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/);
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    expect(text).not.toMatch(/\/(Users|home|private|tmp)\//);
    expect(text).not.toMatch(/toolu_0[0-9A-Za-z]{10,}|mcpsrv_0|(connector|link)_[0-9a-f]{16,}|call-[0-9a-f]{8}-/);
    expect(text).not.toMatch(/"(hostname|currentWorkingDirectory|codexHome|userAgent|agentId|agentInstanceId)"\s*:/);
    // every connector and server named in a capture is a neutral example
    const named = [...text.matchAll(/claude\.ai ([A-Za-z0-9 ]+)"|user-([A-Za-z]+)-|"connector_name": "([^"]+)"/g)]
      .map((match) => match[1] ?? match[2] ?? match[3]);
    for (const value of named) expect(value).toMatch(/^Example\b|^example$/i);
  });
});

describe("Claude replays (fake-claude-cli)", () => {
  const TOOL = "mcp__claude_ai_Example_Mail__get_granted_scopes";
  const pinned = (args: string[], env: Record<string, string | undefined> = {}) => runToEnd("fake-claude-cli.ts", [
    "-p", "--model", "haiku", "--output-format", "stream-json", "--verbose", "--tools", "ToolSearch",
    "--allowedTools", `ToolSearch,${TOOL}`, "--permission-mode", "dontAsk", ...args, "--system-prompt", "Make exactly the tool calls the user message names.",
    `Call the tool ${TOOL} exactly once with this input JSON, then stop:\n{}`,
  ], { FAKE_CLAUDE_CONNECTOR_REPLAY: fixture("claude-pinned-call.jsonl"), FAKE_CLAUDE_CONNECTOR_REACH: fixture("claude-connector-reach.json"), ENABLE_CLAUDEAI_MCP_SERVERS: undefined, ...env });

  it("M1: a pinned call on a launch that loads the account's connectors returns the tool's own result", async () => {
    const stdout = await pinned(["--setting-sources", "user,project"]);
    const frames = parseLines(stdout);
    const init = frames.find((frame) => frame.subtype === "init")!;
    expect(init.mcp_servers.map((server: { name: string }) => server.name)).toContain("claude.ai Example Mail");
    // the connector is deferred: one ToolSearch round, then the call
    const uses = frames.filter((frame) => frame.type === "assistant").flatMap((frame) => frame.message.content).filter((block: Frame) => block.type === "tool_use");
    expect(uses.map((block: Frame) => block.name)).toEqual(["ToolSearch", TOOL]);
    const call = frames.find((frame) => frame.tool_use_meta)!.tool_use_meta[0];
    expect(call).toMatchObject({ server_display_name: "Example Mail", tool_name: "get_granted_scopes" });
    // the runner the Claude host will share reads the result from the stream, not from the model's words
    const parsed = parseClaudeArtifactStream(stdout, TOOL as ClaudeArtifactTool);
    expect(parsed).toMatchObject({ ok: true, text: '{"grantedScopes":["Mail.Read","Calendars.Read"]}' });
  });

  it.each([
    ["--setting-sources project (the isolated turn's launch)", ["--setting-sources", "project"], {}],
    ["--strict-mcp-config", ["--setting-sources", "project", "--strict-mcp-config"], {}],
    ["ENABLE_CLAUDEAI_MCP_SERVERS=false", [], { ENABLE_CLAUDEAI_MCP_SERVERS: "false" }],
  ] as const)("M8: %s loads no claude.ai connector, so the call never happens", async (_label, args, env) => {
    const stdout = await pinned([...args], env);
    const init = parseLines(stdout).find((frame) => frame.subtype === "init")!;
    expect(init.mcp_servers.some((server: { name: string }) => server.name.startsWith("claude.ai "))).toBe(false);
    expect(parseClaudeArtifactStream(stdout, TOOL as ClaudeArtifactTool)).toMatchObject({ ok: false, error: expect.stringContaining("No such tool available") });
  });

  it("M2: the permission prompt tool sees the exact input first, and its deny keeps the tool from running", async () => {
    const replay = (name: string) => runToEnd("fake-claude-cli.ts", ["-p", "--output-format", "stream-json", "--verbose", "--permission-prompt-tool", "mcp__probe__permission_check", "Call the tool."], {
      FAKE_CLAUDE_CONNECTOR_REPLAY: fixture(name),
    });
    const allowed = await replay("claude-permission-allow.jsonl");
    expect(parseClaudeArtifactStream(allowed, "mcp__probe__echo_read" as ClaudeArtifactTool)).toMatchObject({ ok: true, text: 'PROBE_MARKER {"item":"alpha"}' });
    const denied = await replay("claude-permission-deny.jsonl");
    expect(parseClaudeArtifactStream(denied, "mcp__probe__echo_read" as ClaudeArtifactTool)).toMatchObject({ ok: false, error: expect.stringContaining("input differs from the approved call") });
    const result = parseLines(denied).find((frame) => frame.type === "result")!;
    expect(result.permission_denials).toEqual([{ tool_name: "mcp__probe__echo_read", tool_use_id: "toolu_fixture_call", tool_input: { item: "beta" } }]);
    const log = readFixture<{ approvedInput: unknown; allowed: Array<{ call: string; args: Frame }>; denied: Array<{ call: string; args: Frame }> }>("claude-permission-log.json");
    expect(log.allowed.map((entry) => entry.call)).toEqual(["permission_check", "echo_read"]);
    expect(log.allowed[0]!.args.input).toEqual(log.approvedInput);
    expect(log.denied.map((entry) => entry.call)).toEqual(["permission_check"]);
  });

  it("M3: `claude mcp serve` serves Claude Code's own tools, never a configured server's", async () => {
    const serve = rpcSession("fake-claude-cli.ts", ["mcp", "serve"], { FAKE_CLAUDE_MCP_SERVE_REPLAY: fixture("claude-mcp-serve.json") });
    const init = await serve.request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
    expect(init.result.capabilities).toEqual({ tools: { listChanged: true } });
    const listed = await serve.request("tools/list");
    const names = listed.result.tools.map((tool: { name: string }) => tool.name);
    expect(names).toContain("Bash");
    for (const configured of readFixture<{ configuredTools: string[] }>("claude-mcp-serve.json").configuredTools) {
      expect(names.some((name: string) => name.includes(configured))).toBe(false);
    }
  });
});

describe("Grok replays (fake-acp-cli)", () => {
  const gatewayEnv = { GROK_MANAGED_MCPS_ENABLED: "true", GROK_MANAGED_MCP_GATEWAY_TOOLS_ENABLED: "true" };
  const grok = (env: Record<string, string | undefined>) => rpcSession("fake-acp-cli.ts", ["--permission-mode", "default", "agent", "--no-leader", "stdio"], {
    FAKE_ACP_INITIALIZE_REPLAY: fixture("grok-initialize.json"), FAKE_ACP_MCP_LIST_FILE: fixture("grok-gateway-list.json"), ...env,
  });

  it("M4: initialize and the gateway list keep the measured shape: tool names, titles, no input schema", async () => {
    const session = grok({ ...gatewayEnv });
    const init = await session.request("initialize", { protocolVersion: 1, clientCapabilities: {} });
    expect(init.result.authMethods.map((method: { id: string }) => method.id)).toEqual(["xai.api_key", "cached_token", "grok.com"]);
    expect(init.result._meta).toMatchObject({ agentVersion: "1.0.77", "x.ai/mcp/sdk": true });
    const created = await session.request("session/new", { cwd: tempDir(), mcpServers: [] });
    const list = await session.request("_x.ai/mcp/list", { sessionId: created.result.sessionId, cache: true });
    const gateway = list.result.result.servers.filter((server: { type: string }) => server.type === "managedGateway");
    expect(gateway.map((server: { name: string }) => server.name)).toEqual(["managed_gateway:cursor", "managed_gateway:tasks"]);
    for (const tool of gateway.flatMap((server: Frame) => server.session.tools)) {
      expect(Object.keys(tool).sort()).toEqual(["description", "displayName", "enabled", "name"]);
    }
    // without both variables, grok lists no managed server
    const off = grok({ GROK_MANAGED_MCPS_ENABLED: "true", GROK_MANAGED_MCP_GATEWAY_TOOLS_ENABLED: undefined });
    await off.request("initialize", { protocolVersion: 1, clientCapabilities: {} });
    const offSession = await off.request("session/new", { cwd: tempDir(), mcpServers: [] });
    const offList = await off.request("_x.ai/mcp/list", { sessionId: offSession.result.sessionId, cache: true });
    expect(offList.result.result.servers.some((server: { type: string }) => server.type === "managedGateway")).toBe(false);
  });

  const pinnedPrompt = (tool: string, input: unknown) => [{ type: "text", text: `Call the tool use_tool exactly once with tool "${tool}" and this input JSON, then stop:\n${JSON.stringify(input)}` }];

  it("M4: one pinned use_tool asks with the exact tool and input, returns the tool result, then ends on cancel", async () => {
    const session = grok({ ...gatewayEnv, FAKE_ACP_MODE: "connector-replay", FAKE_ACP_CONNECTOR_REPLAY: fixture("grok-pinned-use-tool.json") });
    await session.request("initialize", { protocolVersion: 1, clientCapabilities: {} });
    const { result: { sessionId } } = await session.request("session/new", { cwd: tempDir(), mcpServers: [] });
    const tool = "cursor__user-Example-mail-list_5fmessages___21";
    const input = { folder: "inbox", top: 1 };
    session.send({ id: 50, method: "session/prompt", params: { sessionId, prompt: pinnedPrompt(tool, input) } });
    const ask = await session.waitFor((frame) => frame.method === "session/request_permission");
    expect(ask.params.toolCall.rawInput).toEqual({ variant: "UseTool", tool_name: tool, tool_input: input });
    expect(ask.params.toolCall._meta["x.ai/tool"]).toMatchObject({ name: "use_tool", namespace: "grok_build" });
    expect(ask.params.options.map((option: { optionId: string; kind: string }) => [option.optionId, option.kind])).toEqual([
      ["always-allow", "allow_always"], ["allow-once", "allow_once"], ["reject-once", "reject_once"],
    ]);
    session.send({ id: ask.id, result: { outcome: { outcome: "selected", optionId: "allow-once" } } });
    const done = await session.waitFor((frame) => frame.params?.update?.sessionUpdate === "tool_call_update" && frame.params.update.rawOutput);
    expect(done.params.update.rawOutput).toMatchObject({ type: "MCP", tool_name: tool, is_error: true });
    expect(session.frames.some((frame) => frame.id === 50)).toBe(false);
    session.send({ method: "session/cancel", params: { sessionId } });
    const ended = await session.waitFor((frame) => frame.id === 50);
    expect(ended.result).toMatchObject({ stopReason: "cancelled", _meta: { modelId: "grok-4.7-build-fast", cancellationCategory: "MidTurnAbort" } });
  });

  it("M4: a refused ask runs nothing", async () => {
    const session = grok({ ...gatewayEnv, FAKE_ACP_MODE: "connector-replay", FAKE_ACP_CONNECTOR_REPLAY: fixture("grok-pinned-use-tool.json") });
    await session.request("initialize", { protocolVersion: 1, clientCapabilities: {} });
    const { result: { sessionId } } = await session.request("session/new", { cwd: tempDir(), mcpServers: [] });
    session.send({ id: 60, method: "session/prompt", params: { sessionId, prompt: pinnedPrompt("cursor__user-Example-mail-send_5fmessage___21", { to: ["someone@example.com"] }) } });
    const ask = await session.waitFor((frame) => frame.method === "session/request_permission");
    session.send({ id: ask.id, result: { outcome: { outcome: "selected", optionId: "reject-once" } } });
    const ended = await session.waitFor((frame) => frame.id === 60);
    expect(ended.result.stopReason).toBe("end_turn");
    expect(session.frames.some((frame) => frame.params?.update?.rawOutput)).toBe(false);
  });

  it("M4: _x.ai/mcp/call runs a session server's tool with no model and no ask, and never reaches the gateway", async () => {
    const dir = tempDir();
    const server = join(dir, "echo-mcp.mjs");
    writeFileSync(server, `import { createInterface } from "node:readline";
const send = (frame) => process.stdout.write(JSON.stringify(frame) + "\\n");
createInterface({ input: process.stdin }).on("line", (line) => {
  const frame = JSON.parse(line);
  if (frame.method === "initialize") send({ jsonrpc: "2.0", id: frame.id, result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "probe", version: "1" } } });
  else if (frame.method === "tools/call" && frame.params.name === "echo_read") send({ jsonrpc: "2.0", id: frame.id, result: { content: [{ type: "text", text: "PROBE_MARKER " + JSON.stringify(frame.params.arguments) }] } });
  else if (frame.id !== undefined) send({ jsonrpc: "2.0", id: frame.id, error: { code: -32601, message: "unknown tool" } });
});
`);
    const captured = readFixture<{ sessionServer: { result: unknown }; unknownTool: { error: unknown }; gatewayServer: { error: unknown } }>("grok-mcp-call.json");
    const session = grok({ ...gatewayEnv, FAKE_ACP_MCP_CALL: "1" });
    await session.request("initialize", { protocolVersion: 1, clientCapabilities: {} });
    const { result: { sessionId } } = await session.request("session/new", { cwd: dir, mcpServers: [{ name: "probe", command: process.execPath, args: [server], env: [] }] });
    const called = await session.request("_x.ai/mcp/call", { sessionId, server: "probe", tool: "echo_read", arguments: { item: "alpha" } });
    expect(called.result).toEqual(captured.sessionServer.result);
    const unknown = await session.request("_x.ai/mcp/call", { sessionId, server: "probe", tool: "no_such_tool", arguments: {} });
    expect(unknown.error).toEqual(captured.unknownTool.error);
    const gateway = await session.request("_x.ai/mcp/call", { sessionId, server: "managed_gateway:cursor", tool: "no_such_tool", arguments: {} });
    expect(gateway.error).toEqual(captured.gatewayServer.error);
    expect(session.frames.some((frame) => frame.method === "session/request_permission")).toBe(false);
  });
});

describe("Codex replays (fake-codex-app-server)", () => {
  it("M6: lists the ChatGPT apps as one server with full schemas and calls a tool with no turn and no ask", async () => {
    const home = tempDir();
    const dump = join(home, "calls.json");
    const codex = rpcSession("fake-codex-app-server.ts", ["app-server"], {
      HOME: home, USERPROFILE: home, FAKE_CODEX_MODE: "happy", FAKE_CODEX_DUMP: dump, FAKE_CODEX_CONNECTOR_REPLAY: FIXTURES,
    });
    await codex.request("initialize", { clientInfo: { name: "test", title: "test", version: "0" }, capabilities: { experimentalApi: true } });
    const thread = await codex.request("thread/start", { cwd: home, ephemeral: true });
    const threadId = thread.result.thread.id;
    const status = await codex.request("mcpServerStatus/list", { detail: "toolsAndAuthOnly" });
    const [apps] = status.result.data;
    expect(apps).toMatchObject({ name: "codex_apps", authStatus: "bearerToken" });
    for (const [key, tool] of Object.entries(apps.tools as Record<string, Frame>)) {
      expect(tool.name).toBe(key);
      expect(tool.inputSchema).toMatchObject({ type: "object" });
      expect(typeof tool.annotations.readOnlyHint).toBe("boolean");
      expect(tool._meta.connector_name).toMatch(/^Example /);
    }
    const captured = readFixture<{ request: { tool: string; arguments: unknown }; result: Frame }>("codex-tool-call.json");
    const call = await codex.request("mcpServer/tool/call", { server: "codex_apps", threadId, tool: captured.request.tool, arguments: captured.request.arguments });
    expect(call.result).toEqual(captured.result);
    expect(call.result).toMatchObject({ isError: true, structuredContent: { error_code: "NOT_FOUND" } });
    const other = await codex.request("mcpServer/tool/call", { server: "codex_apps", threadId, tool: "example_chat.list_chats", arguments: { top: 1 } });
    expect(other.result).toEqual({ content: [{ type: "text", text: 'FAKE_CODEX_APP example_chat.list_chats {"top":1}' }], isError: false });
    // no model: no turn was started, and Codex asked the client nothing
    const calls = JSON.parse(readFileSync(dump, "utf8")).calls as Array<{ method: string }>;
    expect(calls.map((entry) => entry.method)).not.toContain("turn/start");
    expect(codex.frames.some((frame) => frame.method !== undefined && frame.id !== undefined)).toBe(false);
  });
});
