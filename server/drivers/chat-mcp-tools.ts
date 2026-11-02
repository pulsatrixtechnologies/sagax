// Per-turn MCP transport for the shared Chat Completions runtime. Approval is
// owned by the caller; only registered, schema-validated calls reach this file.
import { createHash } from "node:crypto";
import type { ValidateFunction } from "ajv";
import { stripControlPlaneEnv } from "../config.ts";
import type { SendTurnInput } from "../contracts.ts";
import { augmentedPath } from "../env-path.ts";
import { killCliTree, spawnCli } from "../procs.ts";
import { chatImage, type ChatImagePart } from "./chat-images.ts";
import { CALL_TOOL, bm25Ranker, directoryCallTarget, inputSignature, isDirectoryTool, oneLine, type CatalogTool } from "../mcp-directory.ts";
import { mcpStdioServer } from "../mcp-gate-config.ts";
import { REMOTE_MCP_STARTUP_MS, remoteMcpSpec } from "../mcp-http.ts";
import { compileToolSchema } from "../mcp-schema-validator.ts";
import { allowsTool, canUseMcpServer, parseToolScope, type ToolScope } from "../../shared/tool-scope.ts";
import { openApiWriteToolNames } from "../openapi-tools.ts";

export interface ChatToolDefinition {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}
export interface ChatToolResult { text: string; ok: boolean; images?: ChatImagePart[] }
/** How one call is shown to the person: the tool named on its approval card
 * and in the transcript, the input previewed there, whether a card is needed
 * at all, and what "Always allow this session" on that card keeps allowed:
 * the exact tool on its exact server, the server as launched (a changed
 * command, URL or credential is another server, as it is a new process to a
 * warm Claude). No grant for the person's own computer, which no engine lets
 * a session-wide allow cover. */
/** `mcpTool`: `<server>__<tool>` by the mount's own name and the tool's
 * upstream name (never the model's words), for the server's approval
 * routing (member-environment.ts, member-tool-scope.ts). */
export interface ChatToolCallView { title: string; input: Record<string, unknown>; ask: boolean; grant?: string; mcpTool?: string }
/** The transport cannot safely continue this turn. A dispatched operation may
 * already have taken effect, so callers must not retry it through a new round. */
export class ChatToolSessionError extends Error {}
/** A configured (custom) MCP server that could not mount this turn. */
export interface SkippedChatMcpServer { server: string; reason: string }
export interface ChatToolSession {
  definitions: ChatToolDefinition[];
  /** Custom servers left out of this turn because they failed to start or advertised an unusable catalog. */
  skipped: SkippedChatMcpServer[];
  validate(name: string, args: unknown): void;
  /** A searched server's search_tools and describe_tool read only its
   * catalog, so they need no card; call_tool is shown as the tool it runs.
   * Sagax's own agents server needs none either, as on Claude
   * (pre-allowed mcp__agents) and Codex (auto-approved mount): the harness
   * authorizes each of its routes itself. Its Data server asks: Sagax's
   * approval path answers what stays in the bot's workspace. */
  view(name: string, args: Record<string, unknown>): ChatToolCallView;
  execute(name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<ChatToolResult>;
  close(): Promise<void>;
}

type Server = { command: string; args: string[]; env: Record<string, string> };
type RegisteredTool = { client: ChatMcpClient; server: string; launch: string; builtInBrowser: boolean; agents: boolean; data: boolean; name: string; schema: ValidateFunction; searched: boolean };
/** A provider-safe tool name: the server's name and the tool's, joined. */
function chatToolName(server: string, tool: string): string {
  return `${server}_${tool}`.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 64) || "mcp_tool";
}
const STARTUP_MS = 8_000;
/** Historic per-call ceiling for a bot's MCP tools; a turn can override it
 * with SendTurnInput.mcpCallTimeoutMs (server config `mcp.callTimeoutMinutes`). */
const DEFAULT_CALL_MS = 10 * 60_000;
const FRAME_BYTES = 2 * 1024 * 1024;
const OUTPUT_BYTES = 50 * 1024;
/** Tools one server may list before it is refused: a sanity bound on a
 * catalog, not the provider's limit, which the session meets by deferring. */
const SERVER_TOOL_COUNT = 1_000;
/** Most tools a chat-completions provider takes in one request. xAI (Grok)
 * and OpenAI document 128 functions per request; the others served through
 * this runtime are held to the same bound until a different one is known. */
export const DEFAULT_TOOL_LIMIT = 128;
export const PROVIDER_TOOL_LIMITS: Readonly<Record<string, number>> = {
  grok: 128, "openai-compat": 128, groq: 128, mistral: 128, cerebras: 128, minimax: 128,
};
export function providerToolLimit(driverKind: string): number {
  return PROVIDER_TOOL_LIMITS[driverKind] ?? DEFAULT_TOOL_LIMIT;
}
/** The two tools that stand in for every deferred one. */
export const DEFERRED_SEARCH_TOOL = "tool_search";
export const DEFERRED_CALL_TOOL = "tool_call";
const DEFERRED_SEARCH_DEFAULT = 8;
const DEFERRED_SEARCH_MAX = 20;
const DEFERRED_SCHEMA_CHARS = 4_000;
const MAX_PAGES = 100;
const SCHEMA_BYTES = 64 * 1024;
const CATALOG_BYTES = 1024 * 1024;
const DEFERRED_CATALOG_BYTES = 8 * 1024 * 1024;
const MAX_FRAMES = 10_000;

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function aborted(): Error { return new Error("MCP operation cancelled"); }

/** These servers are a chat-runtime bot's tools, the counterpart of an engine
 * CLI's children: the operator's control-plane secrets never ride along. What
 * the server entry itself names is a deliberate grant and is applied last. */
export function chatMcpEnvironment(serverEnv: Record<string, string>, source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...source, PATH: augmentedPath() };
  stripControlPlaneEnv(env);
  return { ...env, ...serverEnv };
}

/** Stdio MCP client used by chat tool mounts and by saved-steps replay. */
export class ChatMcpClient {
  private readonly frameBytes: number;
  private child: ReturnType<typeof spawnCli>;
  private buffer = "";
  private nextId = 1;
  private frames = 0;
  private closed = false;
  private closing?: Promise<void>;
  private pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();

  constructor(server: Server, computerUse = false) {
    this.frameBytes = computerUse ? 32 * 1024 * 1024 : FRAME_BYTES;
    try {
      // The desktop shell inherits Finder's bare PATH, where `npx`-style
      // servers cannot find `node` and exit at once. Widen it the way the
      // Claude and Codex drivers do; a PATH the user set on the server wins.
      this.child = spawnCli(server.command, server.args, {
        stdio: ["pipe", "pipe", "pipe"], env: chatMcpEnvironment(server.env),
      }, "bot");
    } catch { throw new Error("MCP server could not start; check its command and installation"); }
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk: string) => this.onData(chunk));
    // Stderr may contain credentials; drain without recording or returning it.
    this.child.stderr.on("data", () => {});
    this.child.on("error", () => this.fail(new Error("MCP server could not start; check its command and installation")));
    this.child.on("exit", () => this.fail(new Error("MCP server exited before the session closed")));
    this.child.stdin.on("error", () => this.fail(new Error("MCP server input closed")));
  }

  private fail(error: Error): void {
    if (this.closed) return;
    this.closed = true;
    for (const entry of this.pending.values()) entry.reject(error);
    this.pending.clear();
    // Capture rejection here; mount/execute finally await close and surface it.
    void this.close().catch(() => {});
  }

  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    // Port de OpenMausBot #3150 : read before the rejections below. Only a
    // call still in flight now can have an uncertain outcome; a slow exit
    // with nothing in flight changes nothing the turn did.
    const inFlight = this.pending.size > 0;
    for (const entry of this.pending.values()) entry.reject(new Error("MCP session closed"));
    this.pending.clear();
    this.buffer = "";
    // Windows reaps the tree via taskkill /T, which can exceed shorter
    // budgets on a loaded machine; elsewhere the budget is the TERM grace
    // before KILL, so it stays short.
    this.closing = killCliTree(this.child, process.platform === "win32" ? 15_000 : 5_000).then((stopped) => {
      if (stopped) return;
      if (!inFlight) {
        console.warn("chat-mcp: shutdown could not be confirmed within its budget; no call was in flight, so the turn outcome is unaffected");
        return;
      }
      throw new Error("MCP server shutdown could not be confirmed; execution outcome may be uncertain");
    });
    return this.closing;
  }

  private write(frame: unknown): void {
    if (this.closed || !this.child.stdin.writable || this.child.stdin.destroyed) throw new Error("MCP session closed");
    const encoded = JSON.stringify(frame) + "\n";
    if (Buffer.byteLength(encoded) > this.frameBytes) throw new Error("MCP request exceeds the frame limit");
    this.child.stdin.write(encoded);
  }

  private onData(chunk: string): void {
    if (this.closed) return;
    this.buffer += chunk;
    let newline: number;
    while ((newline = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      if (++this.frames > MAX_FRAMES) return this.fail(new Error("MCP session exceeded the response frame count limit"));
      if (Buffer.byteLength(line) > this.frameBytes) return this.fail(new Error("MCP response exceeds the frame limit"));
      if (!line.trim()) continue;
      let message: unknown;
      try { message = JSON.parse(line); }
      catch { return this.fail(new Error("MCP server returned invalid JSON")); }
      if (!object(message) || message.jsonrpc !== "2.0") return this.fail(new Error("MCP server returned an invalid RPC envelope"));
      if (typeof message.method === "string") {
        if (typeof message.id === "number" || typeof message.id === "string") {
          try { this.write({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Client method not supported" } }); }
          catch { return this.fail(new Error("MCP server input closed")); }
        }
        continue;
      }
      if (typeof message.id !== "number") return this.fail(new Error("MCP server returned an invalid response ID"));
      const entry = this.pending.get(message.id);
      if (!entry) continue;
      this.pending.delete(message.id);
      if ("error" in message) entry.reject(new Error("MCP request failed; inspect the configured integration"));
      else if (!("result" in message)) entry.reject(new Error("MCP response has no result"));
      else entry.resolve(message.result);
    }
    if (Buffer.byteLength(this.buffer) > this.frameBytes) this.fail(new Error("MCP response exceeds the frame limit"));
  }

  async call(method: string, params: unknown, signal: AbortSignal, timeout: number): Promise<unknown> {
    if (signal.aborted) { await this.close(); throw aborted(); }
    if (this.closed) throw new Error("MCP session closed");
    const id = this.nextId++;
    try {
      return await new Promise((resolve, reject) => {
        const finish = (error?: Error, value?: unknown) => {
          clearTimeout(timer);
          signal.removeEventListener("abort", cancel);
          this.pending.delete(id);
          if (error) reject(error); else resolve(value);
        };
        const cancel = () => {
          try { this.write({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: id, reason: "Cancelled" } }); }
          catch { /* cleanup owns transport failure */ }
          finish(aborted());
        };
        const timer = setTimeout(() => finish(new Error("MCP request timed out; execution outcome may be uncertain")), timeout);
        timer.unref();
        signal.addEventListener("abort", cancel, { once: true });
        this.pending.set(id, { resolve: (value) => finish(undefined, value), reject: (error) => finish(error) });
        try { this.write({ jsonrpc: "2.0", id, method, params }); }
        catch { finish(new Error("MCP request could not be sent")); }
      });
    } catch (error) {
      await this.close();
      throw error;
    }
  }

  async tools(signal: AbortSignal, include: (tool: unknown) => boolean = () => true, startupMs = STARTUP_MS): Promise<unknown[]> {
    const deadline = Date.now() + startupMs;
    const remaining = () => {
      if (Date.now() >= deadline) throw new Error("MCP startup timed out");
      return deadline - Date.now();
    };
    const initialized = await this.call("initialize", {
      protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "openmausbot-chat", version: "1" },
    }, signal, remaining());
    if (!object(initialized)) throw new Error("MCP initialization returned an invalid result");
    if (signal.aborted) throw aborted();
    this.write({ jsonrpc: "2.0", method: "notifications/initialized" });
    const tools: unknown[] = [];
    const cursors = new Set<string>();
    let cursor: string | undefined;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const result = await this.call("tools/list", cursor ? { cursor } : {}, signal, remaining());
      if (!object(result) || !Array.isArray(result.tools)) throw new Error("MCP tools/list returned an invalid result");
      tools.push(...result.tools.filter(include));
      if (tools.length > SERVER_TOOL_COUNT) throw new Error("MCP server lists more than 1000 tools");
      if (result.nextCursor === undefined) return tools;
      if (typeof result.nextCursor !== "string" || !result.nextCursor || cursors.has(result.nextCursor)) throw new Error("MCP tools/list returned an invalid pagination cursor");
      cursors.add(result.nextCursor);
      cursor = result.nextCursor;
    }
    throw new Error("MCP tools/list exceeded the pagination limit");
  }
}

function boundedText(value: string): string {
  const bytes = Buffer.from(value);
  if (bytes.length <= OUTPUT_BYTES) return value;
  let end = OUTPUT_BYTES;
  while ((bytes[end] & 0xc0) === 0x80) end -= 1;
  return `${bytes.subarray(0, end).toString()}\n[MCP result truncated at 50KB; request less output.]`;
}

/** Optional fields a tool documents as "omit to use the default", where a
 * blank string is an error instead. Smaller models fill optional fields with
 * "" rather than leaving them out; dropping the blank restores the documented
 * call. agent_browser_read: "Omit url to read the active tab." */
const BUILT_IN_BROWSER_BLANK_MEANS_OMITTED: Record<string, readonly string[]> = {
  agent_browser_read: ["url"],
};

function omitBlankDefaults(builtInBrowser: boolean, tool: string, args: unknown) {
  if (!builtInBrowser || !object(args)) return;
  for (const field of BUILT_IN_BROWSER_BLANK_MEANS_OMITTED[tool] ?? []) {
    const value = args[field];
    if (typeof value === "string" && !value.trim()) delete args[field];
  }
}

/** Which tools ride every request when a turn has more than the provider
 * takes: the person's computer and browser first, then Sagax's own agents
 * server and each searched server's three directory tools, then every other
 * server in its configured order. Ties keep mount order, so the cut is the
 * same on every turn. */
function toolTier(entry: { hostTool: boolean; agents: boolean; directory: boolean }): number {
  if (entry.hostTool) return 0;
  if (entry.agents || entry.directory) return 1;
  return 2;
}

export async function mountChatTools(integrations: SendTurnInput["integrations"], signal: AbortSignal, computerUse = false, toolScope?: ToolScope, callTimeoutMs: number = DEFAULT_CALL_MS, toolLimit: number = DEFAULT_TOOL_LIMIT): Promise<ChatToolSession> {
  const parsed = parseToolScope(toolScope);
  if (!parsed.ok) throw new Error(parsed.error);
  const scope = parsed.scope;
  const servers: Array<[string, Server]> = [];
  /** URL servers this runtime searches rather than lists (mcp-directory.ts):
   * past the provider's tool limit, the session defers the rest. */
  const searchable = new Set<string>();
  const eligible = (server: string) => scope === undefined || canUseMcpServer(scope, server);
  if (computerUse && integrations?.localComputer && eligible("computer")) servers.push(["computer", integrations.localComputer]);
  if (computerUse && integrations?.browser && eligible("browser")) servers.push(["browser", integrations.browser]);
  if (integrations?.agents && eligible("agents")) servers.push(["agents", integrations.agents]);
  if (integrations?.data && eligible("data")) servers.push(["data", integrations.data]);
  if (integrations?.messages && eligible("messages")) servers.push(["messages", integrations.messages]);
  for (const [name, server] of Object.entries(integrations?.custom ?? {})) {
    if (!eligible(name)) continue;
    const remote = remoteMcpSpec(server) !== undefined;
    const stdio = mcpStdioServer(server, { nodeEnv: { ELECTRON_RUN_AS_NODE: "1" }, ...(remote ? { directory: { name, ...(scope ? { toolScope: scope } : {}) } } : {}) });
    if (!stdio) throw new Error("MCP server configuration is invalid");
    if (remote) searchable.add(name);
    servers.push([name, { command: stdio.command, args: stdio.args ?? [], env: stdio.env ?? {} }]);
  }
  if (servers.length > 32) throw new Error("MCP server count exceeds the 32-server limit");
  const clients: ChatMcpClient[] = [];
  // Only a server the person configured is skipped when it cannot mount; the
  // harness's own servers (browser, computer, agents, data) still
  // fail the turn, as they hold what the turn needs to run safely.
  const skippable = new Set(Object.keys(integrations?.custom ?? {}));
  const skipped: SkippedChatMcpServer[] = [];
  const started = new Map<string, ChatMcpClient>();
  let closed = false;
  let closing: Promise<void> | undefined;
  const close = (): Promise<void> => {
    if (closing) return closing;
    closed = true;
    signal.removeEventListener("abort", cancel);
    closing = Promise.allSettled(clients.map((client) => client.close())).then((results) => {
      if (results.some((result) => result.status === "rejected")) throw new ChatToolSessionError("MCP server shutdown could not be confirmed; execution outcome may be uncertain");
    });
    return closing;
  };
  const cancel = () => { void close().catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  const definitions: ChatToolDefinition[] = [];
  const candidates: Array<{ definition: ChatToolDefinition; tier: number }> = [];
  /** Tools past the provider's limit: reached through tool_search and tool_call. */
  const deferred = new Map<string, ChatToolDefinition>();
  let searchName: string | undefined;
  let callName: string | undefined;
  const registered = new Map<string, RegisteredTool>();
  const agentsEnv = (integrations?.agents as { env?: Record<string, string> } | undefined)?.env;
  const openApiWrites = new Set(openApiWriteToolNames(agentsEnv?.SAGAX_OPENAPI_TOOLS));
  try {
    if (signal.aborted) throw aborted();
    // Start independent servers concurrently; consume results in config order
    // so names and collision suffixes remain stable across startup timings.
    const mounts = await Promise.allSettled(servers.map(async ([name, descriptor]) => {
      if (signal.aborted || closed) throw aborted();
      // Every mounted MCP server can return images when the caller enables
      // image delivery, including custom servers. Text stays bounded below.
      const client = new ChatMcpClient(descriptor, computerUse);
      clients.push(client);
      started.set(name, client);
      // A searched server's three directory tools are already narrowed to
      // the selection by the proxy, which checks call_tool's target as well.
      const include = (tool: unknown) => scope === undefined || (object(tool) && typeof tool.name === "string"
        && ((searchable.has(name) && isDirectoryTool(tool.name)) || allowsTool(scope, { kind: "mcp", server: name, name: tool.name })));
      // A searched URL server answers over the internet: its initialize and
      // whole tools/list get the URL budget; command servers keep theirs.
      const tools = await client.tools(signal, include, searchable.has(name) ? REMOTE_MCP_STARTUP_MS : STARTUP_MS);
      // port of OpenMausBot #3111: a Local VM with no tools is an error, not a silent turn
      if (!tools.length && scope === undefined && descriptor === integrations?.localComputer) throw new Error("The Local VM listed no tools");
      // Harness mounts are known by the descriptor the harness passed, never
      // by a name a configured server could also claim.
      // What the server is, for a grant: hashed, so no credential is kept.
      // A bridge into a machine minted a fresh bearer this turn, so its
      // grants last a turn, as a warm engine restarts for it (perTurn).
      const launch = createHash("sha256").update(JSON.stringify(descriptor)).digest("hex");
      return { name, client, launch, builtInBrowser: descriptor === integrations?.browser, agents: descriptor === integrations?.agents, data: descriptor === integrations?.data,
        computer: descriptor === integrations?.localComputer, tools };
    }));
    for (const [index, mount] of mounts.entries()) {
      const configured = servers[index]![0];
      if (signal.aborted || closed) throw aborted();
      const skip = async (error: unknown) => {
        const reason = error instanceof Error ? error.message : "MCP server failed to start";
        skipped.push({ server: configured, reason });
        console.warn(`chat-mcp: skipping MCP server "${configured}" for this turn: ${reason}`);
        await started.get(configured)?.close().catch(() => {});
      };
      if (mount.status === "rejected") {
        if (!skippable.has(configured)) throw mount.reason;
        await skip(mount.reason);
        continue;
      }
      const { name: server, client, launch, builtInBrowser, agents, data, tools } = mount.value;
      const hostTool = builtInBrowser || mount.value.computer;
      // Staged so a server that fails halfway leaves none of its tools behind.
      const staged: Array<{ tool: RegisteredTool; candidate: { definition: ChatToolDefinition; tier: number } }> = [];
      try {
        const originalNames = new Set<string>();
        for (const tool of tools) {
          if (!object(tool) || typeof tool.name !== "string" || !tool.name.trim() || originalNames.has(tool.name)) throw new Error("MCP server advertised an invalid or duplicate tool name");
          originalNames.add(tool.name);
          if (!object(tool.inputSchema) || tool.inputSchema.type !== "object") throw new Error("MCP tools require an object input schema");
          if (Buffer.byteLength(JSON.stringify(tool.inputSchema)) > SCHEMA_BYTES) throw new Error("MCP tool schema exceeds the 64KB limit");
          const schema = compileToolSchema(tool.inputSchema);
          const parameters = { ...tool.inputSchema };
          const constraints: Record<string, unknown> = {};
          if (computerUse) {
            for (const key of ["anyOf", "oneOf", "allOf", "not"]) {
              if (key in parameters) { constraints[key] = parameters[key]; delete parameters[key]; }
            }
          }
          const description = (typeof tool.description === "string" ? tool.description : "Configured MCP tool") +
            (Object.keys(constraints).length ? " Additional argument constraints (validated before execution): " + JSON.stringify(constraints) : "");
          const base = chatToolName(server, tool.name);
          let name = base;
          const taken = (candidate: string) => registered.has(candidate) || staged.some((entry) => entry.candidate.definition.function.name === candidate);
          for (let index = 2; taken(name); index += 1) { const suffix = `_${index}`; name = base.slice(0, 64 - suffix.length) + suffix; }
          staged.push({ tool: { client, server, launch, builtInBrowser, agents, data, name: tool.name, schema, searched: searchable.has(server) },
            candidate: { definition: { type: "function", function: { name, description, parameters } },
              tier: toolTier({ hostTool, agents, directory: searchable.has(server) && isDirectoryTool(tool.name) }) } });
        }
        // One server's own catalog may not exceed the limit: a custom server that does is skipped alone.
        if (Buffer.byteLength(JSON.stringify(staged.map((entry) => entry.candidate.definition))) > CATALOG_BYTES) throw new Error("MCP tool catalog exceeds the 1MB limit");
      } catch (error) {
        if (!skippable.has(server)) throw error;
        await skip(error);
        continue;
      }
      for (const { tool, candidate } of staged) {
        registered.set(candidate.definition.function.name, tool);
        candidates.push(candidate);
      }
    }
    if (signal.aborted || closed) throw aborted();
    const limit = Math.max(0, Math.floor(toolLimit));
    // Within the provider's limit every tool is listed, as before. Past it,
    // the highest tiers ride every request and the rest are deferred behind
    // two tools of their own, so the request never names more than `limit`.
    const ranked = candidates.length > limit ? candidates.map((entry, index) => ({ ...entry, index })).sort((a, b) => a.tier - b.tier || a.index - b.index) : candidates;
    const listed = candidates.length > limit ? Math.max(0, limit - 2) : candidates.length;
    for (const [index, { definition }] of ranked.entries()) {
      if (index < listed) definitions.push(definition);
      else deferred.set(definition.function.name, definition);
    }
    if (Buffer.byteLength(JSON.stringify(definitions)) > CATALOG_BYTES) throw new Error("MCP tool catalog exceeds the 1MB limit");
    if (Buffer.byteLength(JSON.stringify([...deferred.values()])) > DEFERRED_CATALOG_BYTES) throw new Error("MCP deferred tool catalog exceeds the 8MB limit");
    if (deferred.size) {
      const free = (base: string) => { let name = base; for (let index = 2; registered.has(name); index += 1) name = `${base}_${index}`; return name; };
      searchName = free(DEFERRED_SEARCH_TOOL);
      callName = free(DEFERRED_CALL_TOOL);
      if (limit >= 2) {
        definitions.push({ type: "function", function: { name: searchName, description:
          `Find more tools. ${deferred.size} tools of this turn are not listed here, to stay within the model provider's limit of ${limit} tools. Search them by what you want to do; each match gives its name, what it does and its input. Then run it with ${callName}.`,
        parameters: { type: "object", additionalProperties: false, required: ["query"], properties: {
          query: { type: "string", description: "What the tool should do, in a few words (for example: create a ticket, recall memory, send an SMS)." },
          limit: { type: "integer", minimum: 1, maximum: DEFERRED_SEARCH_MAX, description: `How many matches (default ${DEFERRED_SEARCH_DEFAULT}).` },
        } } } });
        definitions.push({ type: "function", function: { name: callName, description:
          `Run a tool found with ${searchName}, by its exact name, with arguments that match its input. Approval works as for any listed tool.`,
        parameters: { type: "object", additionalProperties: false, required: ["name", "arguments"], properties: {
          name: { type: "string", description: `The exact tool name ${searchName} returned.` },
          arguments: { type: "object", description: "The tool's arguments." },
        } } } });
      }
      console.warn(`chat-mcp-tools: ${candidates.length} tools exceed the provider limit of ${limit}; listing ${definitions.length}, deferring ${deferred.size} behind ${searchName}/${callName}`);
    }
  } catch (error) { await close(); throw error; }
  /** The upstream tool a call runs (see directoryCallTarget). */
  const target = (tool: { name: string; searched: boolean }, args: unknown) => tool.searched ? directoryCallTarget(tool.name, args) : tool.name;
  const validateTool = (name: string, args: unknown) => {
    if (closed || signal.aborted) throw new ChatToolSessionError("MCP session closed");
    const tool = registered.get(name);
    if (!tool) throw new Error("The requested tool was not advertised for this turn");
    const excluded = (runs: string | undefined) => scope !== undefined && runs !== undefined
      && !allowsTool(scope, { kind: "mcp", server: tool.server, name: runs });
    // A searched server's directory checks its own tools' arguments and
    // answers a mistake with guidance: a wrong name or a malformed search
    // ran nothing, and must not end the turn as a failed tool call.
    const directory = tool.searched && isDirectoryTool(tool.name);
    if (!directory && excluded(tool.name)) throw new Error("Tool selection excludes this tool");
    omitBlankDefaults(tool.builtInBrowser, tool.name, args);
    if (!object(args) || (!directory && !tool.schema(args))) throw new Error("Tool arguments do not match the advertised input schema; use its required fields and types");
    if (tool.searched && excluded(target(tool, args))) throw new Error("Tool selection excludes this tool");
  };
  const viewTool = (name: string, args: Record<string, unknown>): ChatToolCallView => {
    const tool = registered.get(name);
    const runs = tool ? target(tool, args) : name;
    // Sagax's own Data tools go to Sagax's approval path like any other
    // server (2026-10-16 security review): the person's rules, the safety
    // review and the security keys apply there, and a call that stays in the
    // bot's workspace is answered without a card (sagax-internal-tools.ts).
    if (runs === undefined) return { title: name, input: args, ask: false };
    // The agents server is otherwise pre-allowed. A write to the person's API
    // is not: Ask shows a card, the same as a tool that was not pre-allowed.
    if (tool?.agents) {
      if (openApiWrites.has(runs)) {
        const grant = JSON.stringify([tool.server, tool.launch, runs]);
        const direct = runs === tool.name;
        return {
          title: direct ? name : chatToolName(tool.server, runs),
          input: direct ? args : (object(args.arguments) ? args.arguments : {}),
          ask: true,
          grant,
          mcpTool: `${tool.server}__${runs}`,
        };
      }
      return { title: name, input: args, ask: false };
    }
    // Messages posts its own send card, including under Full access, and
    // reads only after the person turned Use Messages on. A broker card
    // would ask a second time.
    if (tool?.server === "messages") return { title: name, input: args, ask: false, ...(tool ? { mcpTool: `${tool.server}__${tool.name}` } : {}) };
    // "Always allow this session" covers this tool of this server as
    // launched, for this thread and bot only (openai-chat.ts keys the set).
    // The person's own computer has its own descriptor, so its grant is
    // never the sandbox's or another machine's.
    const grant = tool ? JSON.stringify([tool.server, tool.launch, runs]) : undefined;
    if (!tool?.searched || tool.name !== CALL_TOOL) return { title: name, input: args, ask: true, ...(grant ? { grant } : {}), ...(tool ? { mcpTool: `${tool.server}__${tool.name}` } : {}) };
    return { title: chatToolName(tool.server, runs), input: object(args.arguments) ? args.arguments : {}, ask: true, ...(grant ? { grant } : {}), mcpTool: `${tool.server}__${runs}` };
  };
  /** tool_call names a deferred tool: the call it stands for. */
  const deferredCall = (args: unknown): { name: string; args: Record<string, unknown> } => {
    if (!object(args) || typeof args.name !== "string" || !registered.has(args.name)) {
      throw new Error(`Unknown tool name; search with ${searchName} and pass a name it returned`);
    }
    if (args.arguments !== undefined && !object(args.arguments)) throw new Error("arguments must be a JSON object");
    return { name: args.name, args: object(args.arguments) ? args.arguments : {} };
  };
  const search = (args: Record<string, unknown>): ChatToolResult => {
    const query = typeof args.query === "string" ? args.query.trim() : "";
    const count = typeof args.limit === "number" && Number.isInteger(args.limit) ? Math.min(DEFERRED_SEARCH_MAX, Math.max(1, args.limit)) : DEFERRED_SEARCH_DEFAULT;
    const catalog: CatalogTool[] = [...deferred.values()].map(({ function: tool }) => ({ name: tool.name, description: tool.description, inputSchema: tool.parameters }));
    const matches = query ? bm25Ranker(query, catalog, count) as readonly CatalogTool[] : catalog.slice(0, count);
    if (!matches.length) return { ok: true, text: `No tool matches "${oneLine(query, 200)}". Try other words.` };
    const lines = matches.map((tool) => {
      const schema = JSON.stringify(tool.inputSchema);
      const input = schema.length <= DEFERRED_SCHEMA_CHARS ? `input schema: ${schema}` : `input: ${inputSignature(tool.inputSchema)}`;
      return `- ${tool.name}: ${oneLine(tool.description, 300)}\n  ${input}`;
    });
    return { ok: true, text: `Run one with ${callName} { "name": "<tool>", "arguments": { ... } }.\n${lines.join("\n")}` };
  };
  const validate = (name: string, args: unknown) => {
    if (closed || signal.aborted) throw new ChatToolSessionError("MCP session closed");
    if (name === searchName) {
      if (!object(args) || typeof args.query !== "string") throw new Error("Pass a query string");
      return;
    }
    if (name === callName) {
      const call = deferredCall(args);
      return validateTool(call.name, call.args);
    }
    validateTool(name, args);
  };
  const view = (name: string, args: Record<string, unknown>): ChatToolCallView => {
    if (name === searchName) return { title: name, input: args, ask: false };
    if (name === callName && object(args) && typeof args.name === "string" && registered.has(args.name)) {
      return viewTool(args.name, object(args.arguments) ? args.arguments : {});
    }
    return viewTool(name, args);
  };
  return {
    definitions, skipped, validate, view, close,
    async execute(name, args, callSignal) {
      if (name === searchName) { validate(name, args); return search(args); }
      if (name === callName) {
        validate(name, args);
        const call = deferredCall(args);
        name = call.name;
        args = call.args;
      }
      validateTool(name, args);
      if (callSignal.aborted) { await close(); throw aborted(); }
      const tool = registered.get(name)!;
      try {
        const result = await tool.client.call("tools/call", { name: tool.name, arguments: args }, AbortSignal.any([signal, callSignal]), callTimeoutMs);
        if (signal.aborted || callSignal.aborted) throw aborted();
        if (!object(result) || !Array.isArray(result.content) || (result.isError !== undefined && typeof result.isError !== "boolean")) throw new Error("MCP tool returned an invalid result; execution outcome may be uncertain");
        const parts: string[] = [];
        const images: ChatImagePart[] = [];
        let unsupported = 0;
        for (const item of result.content) {
          if (!object(item) || typeof item.type !== "string" || (item.type === "text" && typeof item.text !== "string")) throw new Error("MCP tool returned invalid content; execution outcome may be uncertain");
          if (item.type === "text") parts.push(item.text as string);
          else if (computerUse && item.type === "image") images.push(chatImage(item));
          else unsupported += 1;
        }
        if (result.structuredContent !== undefined) parts.push(JSON.stringify(result.structuredContent));
        if (unsupported) parts.unshift(`[${unsupported} unsupported MCP content item(s) omitted. The operation may have taken effect, but its full result cannot be represented; inspect its state before retrying.]`);
        return { text: boundedText(parts.join("\n") || (images.length ? "Screenshot captured." : "(empty result)")), ok: result.isError !== true && unsupported === 0,
          ...(images.length ? { images } : {}) };
      } catch (error) {
        await close();
        throw new ChatToolSessionError(error instanceof Error ? error.message : "MCP transport failed; execution outcome may be uncertain");
      }
    },
  };
}
