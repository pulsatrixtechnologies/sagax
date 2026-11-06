// A pass-through MCP server that keeps one tool result from eating a
// conversation.
//
// The provider CLI mounts this instead of the bot's real MCP server. Every
// JSON-RPC frame is relayed in both directions. With a tool selection, discovery
// is filtered and excluded calls are rejected before upstream execution.
// An oversized `tools/call` result is cut to a budget (mcp-trim.ts) and the
// untrimmed text is written to a file. A JSON result is shaped instead of cut
// blind: the gate holds the whole payload in this process, shows the model its
// shape and first records, and lists one read-only tool of its own,
// `query_result` (mcp-shape.ts), that runs a JMESPath query over a held result.
// That tool never reaches the upstream server, reads no file and opens no
// connection: it only sees what this gate process holds, which is what this
// server returned on this one MCP connection.
//
// Why here and not in the driver: on every vendor-CLI engine the tool call and
// its result never pass through the harness at all. The CLI runs the server
// itself and appends the raw answer to the session it owns. Standing between
// the two processes is the only place the harness can see, or shrink, what a
// tool puts into the model's context.
//
// stdout is the MCP transport. Never log there.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { connect, type Socket } from "node:net";
import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { allowsTool, MCP_SERVER_NAME, parseToolScope, type ToolScope } from "../shared/tool-scope.ts";

import { resolveCliSpawn } from "./env-path.ts";
import { DESCRIBE_TOOL, SEARCH_TOOL, ToolDirectory, directoryCallTarget, isDirectoryTool, type CatalogTool, type DirectoryContext } from "./mcp/mcp-directory.ts";
import { lenientToolValidator, schemaProblems } from "./mcp/mcp-schema-validator.ts";
import { parseGateSearch, pinnedToolNames, searchedCatalog } from "./mcp/mcp-gate-search.ts";
import { QUERY_TOOL, QUERY_TOOL_NAME, ResultStore, answerQuery, describeShape, exampleQuery } from "./mcp/mcp-shape.ts";
import { DEFAULT_RESULT_BUDGET, type HeldResult, trimResultText } from "./mcp/mcp-trim.ts";
import { ToolNameAliases, mapJsonStrings } from "./mcp/mcp-tool-names.ts";
import { parseAgentsWithhold, resolvedServerLog } from "./mcp/agents-tool-priority.ts";
import { fitToolList } from "./mcp/mcp-tool-schema.ts";
import { killCliTree } from "./procs.ts";
import { toolSchemaProfileFromEnv } from "./tool-schema-profile.ts";
import { misuseGateBlockText } from "../shared/misuse-guardrails.ts";
import { BRIDGE_FIND_TOOL, BRIDGE_SERVER, readBridgeCall } from "../shared/searched-tool-call.ts";
import { gateArgsSummary, gateDeclinedText, type GateAnswer, type GateAsk } from "./approvals/mcp-gate-approval.ts";
import { reportBackgroundError } from "./background-error.ts";

type Json = Record<string, unknown>;

/** Codex imports env variables from one shared app-server environment. Each
 * mount names its own private record; only the variable name reaches argv. */
function gateEnvironment(): NodeJS.ProcessEnv {
  if (process.argv.length === 2) return process.env;
  try {
    const key = process.argv[3];
    if (process.argv.length !== 4 || process.argv[2] !== "--config-env" || !key || !/^SAGAX_GATE_CONFIG_[a-f0-9]{64}$/.test(key)) throw new Error();
    const value = JSON.parse(process.env[key] ?? "");
    const scoped = typeof value?.SAGAX_GATE_TOOL_SCOPE === "string" && value.SAGAX_GATE_TOOL_SCOPE.length > 0;
    const searched = typeof value?.SAGAX_GATE_SEARCH === "string" && value.SAGAX_GATE_SEARCH.length > 0;
    const withheld = typeof value?.SAGAX_GATE_WITHHOLD === "string" && value.SAGAX_GATE_WITHHOLD.length > 0;
    if (!value || typeof value !== "object" || Array.isArray(value)
      || !["SAGAX_GATE_NAME", "SAGAX_GATE_UPSTREAM"].every(name => typeof value[name] === "string")
      || (!scoped && !searched && !withheld)
      || !Object.entries(value).every(([name, setting]) => GATE_ENV_KEYS.includes(name) && typeof setting === "string")) throw new Error();
    return value;
  } catch {
    process.stderr.write("mcp-gate: invalid private configuration\n"); process.exit(1);
  }
}
/** The gate's own settings never reach the upstream server's environment. */
const GATE_ENV_KEYS = ["SAGAX_GATE_NAME", "SAGAX_GATE_SPILL_DIR", "SAGAX_GATE_BUDGET", "SAGAX_GATE_UPSTREAM", "SAGAX_GATE_SPILL_HINT", "SAGAX_GATE_TOOL_SCOPE", "SAGAX_GATE_DIRECTORY", "SAGAX_GATE_TOOL_NAMES", "SAGAX_GATE_REPORT_DIR", "SAGAX_GATE_APPROVAL_SOCKET", "SAGAX_GATE_APPROVAL_TOKEN", "SAGAX_GATE_READ_ONLY", "SAGAX_GATE_MISUSE_MODE", "SAGAX_GATE_SEARCH", "SAGAX_GATE_WITHHOLD"];
const gateEnv = gateEnvironment();
const NAME = gateEnv.SAGAX_GATE_NAME || "mcp";
const SPILL_DIR = gateEnv.SAGAX_GATE_SPILL_DIR || "";
const rawBudget = Number(gateEnv.SAGAX_GATE_BUDGET);
const BUDGET = Number.isFinite(rawBudget) && rawBudget >= 0 ? rawBudget : DEFAULT_RESULT_BUDGET;
/** Spilled results older than this are swept at startup: they exist for the
 * turn that produced them, not forever. */
const SPILL_MAX_AGE_MS = 24 * 60 * 60_000;
/** Whether the model is told where the untrimmed result was saved. Off by
 * default: offering the path measured WORSE than no trimming, because the
 * model reads the file back in. See TrimInput.spillHint. */
const SPILL_HINT = gateEnv.SAGAX_GATE_SPILL_HINT === "1";
/** The upstream is the remote proxy with its tool directory on
 * (mcp-directory.ts). Its search_tools and describe_tool only read a catalog
 * the proxy has already narrowed to this selection, so they pass, untrimmed:
 * the directory bounds them itself, and a schema cut short is no schema.
 * call_tool is checked, and trimmed, as the tool it runs; one naming no tool
 * runs nothing and is answered by the directory. The proxy guarantees those
 * three names mean nothing else. */
const DIRECTORY = gateEnv.SAGAX_GATE_DIRECTORY === "1";
const SCHEMA_PROFILE = toolSchemaProfileFromEnv(process.env);
/** #1276, a compact prompt for a local model: the gate itself searches this
 * server's catalog (mcp-directory.ts) when it is big, whatever the upstream
 * (a stdio server or the remote proxy), and lists whole only the pinned
 * tools: the ones this bot uses. Every other tool stays reachable through
 * search_tools, describe_tool and call_tool, and call_tool is checked,
 * approved and trimmed as the tool it runs. */
const SEARCH = parseGateSearch(gateEnv.SAGAX_GATE_SEARCH, (message) => fail(message));
/** `grok`: the engine skips tool names it cannot qualify (mcp-tool-names.ts).
 * The gate registers every tool under an admissible name and maps calls
 * back through an explicit alias map. Never a silent drop: every rename and
 * any tool still unregistrable is logged loudly and written to the report. */
const ALIASES = gateEnv.SAGAX_GATE_TOOL_NAMES === "grok" ? new ToolNameAliases(NAME) : undefined;
const REPORT_DIR = gateEnv.SAGAX_GATE_REPORT_DIR || "";
/** #2189: bare names the agents server already owns for this turn. Left out
 * of tools/list and refused on tools/call so the model uses agents. */
const WITHHOLD = parseAgentsWithhold(gateEnv.SAGAX_GATE_WITHHOLD);
/** Sagax gates this server's calls itself (mcp-gate-approval.ts): every
 * `tools/call` not on READ_ONLY waits for an approval from the server over
 * this socket. Fail closed throughout. */
const APPROVAL_SOCKET = gateEnv.SAGAX_GATE_APPROVAL_SOCKET || "";
const APPROVAL_TOKEN = gateEnv.SAGAX_GATE_APPROVAL_TOKEN || "";

function fail(message: string): never {
  process.stderr.write(`mcp-gate(${NAME}): ${message}\n`);
  process.exit(1);
}

function toolScope(): ToolScope | undefined {
  const raw = gateEnv.SAGAX_GATE_TOOL_SCOPE;
  if (raw === undefined) return;
  let value: unknown;
  try { value = JSON.parse(raw); } catch { fail("invalid tool selection JSON"); }
  const parsed = parseToolScope(value);
  if (!parsed.ok || parsed.scope === undefined) fail("invalid tool selection; check the bot's Access settings");
  if (!MCP_SERVER_NAME.test(NAME)) fail("invalid MCP server identity for tool selection");
  return parsed.scope;
}

/** The reviewed read-only tools of this server (upstream names): the only
 * calls that run without an approval when the approval gate is on. */
function readOnlyTools(): ReadonlySet<string> {
  if (!APPROVAL_SOCKET) return new Set();
  if (!APPROVAL_TOKEN) fail("approval gate without a token");
  const raw = gateEnv.SAGAX_GATE_READ_ONLY ?? "[]";
  let value: unknown;
  try { value = JSON.parse(raw); } catch { fail("invalid read-only tool list"); }
  if (!Array.isArray(value) || !value.every((name) => typeof name === "string" && name.length > 0)) fail("invalid read-only tool list");
  return new Set(value as string[]);
}

let approvalConn: Socket | undefined;
let approvalDead = false;
let approvalBuf = "";
const approvalWaiting = new Map<string, (answer: { behavior: "allow" | "deny"; note?: string }) => void>();

function approvalFailAll(): void {
  approvalDead = true;
  for (const resolve of approvalWaiting.values()) resolve({ behavior: "deny" });
  approvalWaiting.clear();
}

/** Ask the Sagax server whether this one call may run. Resolves "deny" on
 * any failure: an unreachable server never becomes an approval. A note, when
 * the server sends one, is the safer path or the refusal the model reads. */
function askApproval(server: string, tool: string, args: unknown): Promise<{ behavior: "allow" | "deny"; note?: string }> {
  if (approvalDead) return Promise.resolve({ behavior: "deny" });
  if (!approvalConn) {
    approvalConn = connect(APPROVAL_SOCKET);
    approvalConn.setEncoding("utf8");
    approvalConn.on("error", (error) => {
      process.stderr.write(`mcp-gate(${NAME}): approval channel failed (${String(error)}); declining\n`);
      approvalFailAll();
    });
    approvalConn.on("close", approvalFailAll);
    approvalConn.on("data", (chunk: string) => {
      approvalBuf += chunk;
      let nl;
      while ((nl = approvalBuf.indexOf("\n")) !== -1) {
        const line = approvalBuf.slice(0, nl);
        approvalBuf = approvalBuf.slice(nl + 1);
        let answer: Partial<GateAnswer> | undefined;
        try { answer = JSON.parse(line); } catch { continue; }
        if (answer?.t !== "answer" || typeof answer.id !== "string") continue;
        const resolve = approvalWaiting.get(answer.id);
        if (!resolve) continue;
        approvalWaiting.delete(answer.id);
        const note = typeof answer.note === "string" ? answer.note.trim() : "";
        resolve(answer.behavior === "allow" ? { behavior: "allow" } : { behavior: "deny", ...(note ? { note } : {}) });
      }
    });
    approvalConn.unref();
  }
  const conn = approvalConn;
  return new Promise((resolve) => {
    const ask: GateAsk = {
      t: "ask", id: randomUUID(), token: APPROVAL_TOKEN, server, tool,
      summary: gateArgsSummary(args), review: gateArgsSummary(args, 2000),
    };
    approvalWaiting.set(ask.id, resolve);
    conn.write(`${JSON.stringify(ask)}\n`);
  });
}

function isRecord(value: unknown): value is Json {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function requestKey(id: unknown): string | undefined {
  return typeof id === "string" || (typeof id === "number" && Number.isFinite(id))
    ? `${typeof id}:${id}` : undefined;
}

function rejectRequest(id: unknown, code: number, message: string): void {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: requestKey(id) ? id : null, error: { code, message } })}\n`);
}

interface Upstream {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

function upstreamSpec(): Upstream {
  let parsed: unknown;
  try {
    parsed = JSON.parse(gateEnv.SAGAX_GATE_UPSTREAM ?? "");
  } catch {
    fail("SAGAX_GATE_UPSTREAM is not valid JSON");
  }
  const spec = parsed as Upstream | null;
  if (!spec || typeof spec !== "object" || typeof spec.command !== "string" || !spec.command) {
    fail("SAGAX_GATE_UPSTREAM needs a command");
  }
  return spec;
}

/** Delete spilled results older than SPILL_MAX_AGE_MS. Best effort: a sweep
 * that fails must never stop the bot's tools from working. */
function sweepSpill(dir: string): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  const cutoff = Date.now() - SPILL_MAX_AGE_MS;
  for (const entry of entries) {
    try {
      const path = join(dir, entry);
      if (statSync(path).mtimeMs < cutoff) rmSync(path, { force: true });
    } catch {
      /* another gate may be sweeping the same directory */
    }
  }
}

let spilled = 0;
/** Whole results the model can query instead of re-reading: one gate, one MCP connection, one session. */
const heldResults = new ResultStore({ server: NAME });

/** Keep the parsed payload for query_result; only a JSON object or array can be queried, text is cut as before. */
function hold(tool: string, text: string): HeldResult | undefined {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (value === null || typeof value !== "object") return undefined;
  const handle = heldResults.put(tool, value, text.length);
  return { handle, shape: describeShape(value), example: exampleQuery(value) };
}

/** Save the untrimmed text and return its path, or undefined when there is
 * nowhere to put it — the trim still happens, the model is just told the rest
 * was discarded rather than where to find it. */
function spill(tool: string, text: string): string | undefined {
  if (!SPILL_DIR) return undefined;
  const safeTool = tool.replace(/[^A-Za-z0-9_.-]/g, "-").slice(0, 60) || "tool";
  const path = join(SPILL_DIR, `${Date.now()}-${process.pid}-${spilled++}-${safeTool}.json`);
  try {
    mkdirSync(SPILL_DIR, { recursive: true, mode: 0o700 });
    writeFileSync(path, text, { mode: 0o600 });
    return path;
  } catch (error) {
    process.stderr.write(`mcp-gate(${NAME}): could not save the full result: ${String(error)}\n`);
    return undefined;
  }
}

/** Rewrite one `tools/call` result in place. Returns true when anything was
 * actually trimmed, so the caller can report it on stderr. */
function trimCallResult(result: Json, tool: string): boolean {
  if (BUDGET === 0) return false;
  const content = result.content;
  if (!Array.isArray(content)) return false;

  // The text blocks are what a provider puts in the model's context, and a
  // server that answers with several is answering with one payload split up,
  // so they share the budget rather than each getting it.
  const textBlocks = content.filter(
    (block): block is Json & { text: string } =>
      Boolean(block) && typeof block === "object" && (block as Json).type === "text" && typeof (block as Json).text === "string",
  );
  const total = textBlocks.reduce((sum, block) => sum + block.text.length, 0);
  if (!textBlocks.length || total <= BUDGET) return false;

  const share = Math.floor(BUDGET / textBlocks.length);
  const path = spill(tool, textBlocks.map((block) => block.text).join("\n"));
  const held = textBlocks.length === 1 ? hold(tool, textBlocks[0]!.text) : undefined;
  let trimmed = false;
  for (const block of textBlocks) {
    const outcome = trimResultText({ text: block.text, budget: share, spillPath: path, spillHint: SPILL_HINT, toolName: tool, held });
    if (!outcome.trimmed) continue;
    block.text = outcome.text;
    trimmed = true;
  }

  // A tool that also answers with structuredContent is dropped to the text
  // alone once that text was cut. Measured 2026-11-05 (Claude Code 2.1.288
  // in production, 2.1.318 locally): when a result carries structuredContent
  // the engine hands the model that value serialized INSTEAD of the text
  // blocks, so a trimmed copy kept beside the text either put the whole
  // payload back in context (a document, which has no array to cut) or hid
  // the banner that says the result is incomplete. Every bot's flow_run read
  // came back whole, 40 KB a call, with the gate "on". The text block is the
  // one copy every engine shows, banner included, and the whole value stays
  // held for query_result. A tool's outputSchema is stripped from the catalog
  // (withoutOutputSchema) so no client refuses the result for lacking it.
  if (trimmed && result.structuredContent !== undefined) delete result.structuredContent;
  return trimmed;
}

/** The catalog a trimming gate shows never declares an outputSchema: a
 * trimmed result has no structuredContent (trimCallResult), and an MCP
 * client that saw the schema would reject the result for lacking one. */
function withoutOutputSchema(tools: Json[]): Json[] {
  if (BUDGET === 0) return tools;
  return tools.map((tool) => {
    if (!isRecord(tool) || tool.outputSchema === undefined) return tool;
    const { outputSchema: _dropped, ...rest } = tool;
    return rest as Json;
  });
}

/** The connector status the harness and Settings read: what the server
 * advertised, what the engine registers, and every rename or failure. */
function reportToolNames(advertised: string[], outcome: ReturnType<ToolNameAliases["catalog"]>): void {
  for (const entry of outcome.renamed) {
    process.stderr.write(`mcp-gate(${NAME}): WARNING tool "${entry.upstream}" is registered for Grok as "${entry.registered}" (${entry.reason}); calls are mapped back\n`);
  }
  for (const entry of outcome.unregistrable) {
    process.stderr.write(`mcp-gate(${NAME}): ERROR tool "${entry.upstream}" cannot be registered for Grok (${entry.reason}); it is NOT available to the bot\n`);
  }
  for (const problem of outcome.parity) process.stderr.write(`mcp-gate(${NAME}): ERROR tool parity: ${problem}\n`);
  for (const problem of outcome.predictionMismatches) process.stderr.write(`mcp-gate(${NAME}): WARNING tool name in the instructions: ${problem}\n`);
  if (!REPORT_DIR) return;
  try {
    mkdirSync(REPORT_DIR, { recursive: true, mode: 0o700 });
    const safe = NAME.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 80) || "server";
    writeFileSync(join(REPORT_DIR, `${safe}.json`), JSON.stringify({
      server: NAME, engine: "grok", at: new Date().toISOString(), advertised: advertised.length,
      registered: advertised.length - outcome.unregistrable.length, renamed: outcome.renamed,
      unregistrable: outcome.unregistrable, parity: outcome.parity,
      status: outcome.unregistrable.length || outcome.parity.length ? "mismatch" : outcome.renamed.length ? "renamed" : "ok",
    }, null, 2), { mode: 0o600 });
  } catch (error) {
    process.stderr.write(`mcp-gate(${NAME}): could not write the tool-name report: ${String(error)}\n`);
  }
}

// Validate before starting a process: corrupt policy must never become pass-through.
const scope = toolScope();
const READ_ONLY = readOnlyTools();
const spec = upstreamSpec();
if (SPILL_DIR) sweepSpill(SPILL_DIR);

const childEnv: NodeJS.ProcessEnv = { ...process.env, ...spec.env };
for (const key of Object.keys(childEnv)) if (key.startsWith("SAGAX_GATE_")) delete childEnv[key];

// The CLI used to spawn this server itself, on every platform, so the gate
// has to spawn it exactly as well. On Windows CreateProcess cannot exec an
// npm .cmd shim or a node-shebang script, which is what `npx -y mcp-remote`
// is — resolveCliSpawn rewrites it to the real executable without a shell, so
// quoting-sensitive JSON argv survives. A shell here would re-interpret the
// server's own arguments.
const resolved = resolveCliSpawn(spec.command, spec.args ?? []);
const child = spawn(resolved.command, resolved.args, {
  stdio: ["pipe", "pipe", "pipe"],
  env: childEnv,
  shell: false,
  // a console app spawned from the desktop shell flashes a window otherwise
  ...(process.platform === "win32" ? { windowsHide: true } : {}),
});

// The gate owns this process. If the gate is killed rather than closed —
// the CLI reaping its MCP servers at the end of a turn — the real server
// must not be left behind, and on Windows only taskkill /T reaps a tree.
let reaping = false;
const reapChild = () => {
  if (reaping) return;
  reaping = true;
  void killCliTree(child).catch(reportBackgroundError);
};
process.on("SIGTERM", () => {
  reapChild();
  process.exit(0);
});
process.on("SIGINT", () => {
  reapChild();
  process.exit(0);
});
process.on("exit", reapChild);

child.on("error", (error) => {
  process.stderr.write(`mcp-gate(${NAME}): could not start ${resolved.command}: ${String(error)}\n`);
  process.exit(1);
});
child.stderr.pipe(process.stderr);

type Pending = { kind: "call"; tool: string; trim: boolean } | { kind: "list" | "other" };

/** The upstream tool one call runs: its own name or call_tool's target, or
 * undefined when the directory answers the call itself. */
function callTarget(name: string, args: unknown): string | undefined {
  // #1374: the agents bridge's find_tool runs nothing (its use_tool is
  // rewritten to the call it runs before any check, in routeLine)
  if (NAME === BRIDGE_SERVER && name === BRIDGE_FIND_TOOL) return undefined;
  return DIRECTORY ? directoryCallTarget(name, args) : name;
}
/** JSON-RPC string and numeric IDs are separate, even when their text is equal. */
const pending = new Map<string, Pending>();
/** initialize requests in flight, read for the search context (#1276). */
const initializeIds = new Set<string>();

// ── #1276: the gate's own tool search (SAGAX_GATE_SEARCH, mcp-gate-search.ts) ──
const searchContext: DirectoryContext = { server: NAME };
interface SearchCatalog { directory: ToolDirectory; searched: boolean }
let searchCatalog: SearchCatalog | undefined;
let searchLoading: Promise<SearchCatalog> | undefined;
let searchGeneration = 0;
/** Once searched, always searched in this process: the engine was handed
 * call_tool, and a tool it found must stay reachable through it. */
let searchedOnce = false;
let internalSeq = 0;
/** The gate's own requests to the upstream (its catalog), by request key. */
const internal = new Map<string, (message: Json) => void>();
const SEARCH_CATALOG_MS = 120_000;

function upstreamRequest(method: string, params: Json): Promise<Json> {
  const id = `sagax-gate-${process.pid}-${++internalSeq}`;
  const key = requestKey(id)!;
  return new Promise<Json>((resolve, reject) => {
    const timer = setTimeout(() => { internal.delete(key); reject(new Error("the server did not list its tools in time")); }, SEARCH_CATALOG_MS);
    timer.unref?.();
    internal.set(key, (message) => { clearTimeout(timer); resolve(message); });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });
}

async function readUpstreamCatalog(): Promise<CatalogTool[]> {
  const tools: CatalogTool[] = [];
  const cursors = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < 100; page += 1) {
    const reply = await upstreamRequest("tools/list", cursor === undefined ? {} : { cursor });
    if (reply.error !== undefined) throw new Error("the server refused to list its tools");
    const result = reply.result;
    if (!isRecord(result) || !Array.isArray(result.tools)) throw new Error("invalid tool catalog");
    for (const tool of result.tools) if (isRecord(tool) && typeof tool.name === "string" && tool.name.trim()) tools.push(tool as CatalogTool);
    const next = result.nextCursor;
    if (next === undefined || next === null || next === "") return tools;
    if (typeof next !== "string" || cursors.has(next)) throw new Error("invalid catalog cursor");
    cursors.add(next);
    cursor = next;
  }
  throw new Error("tool catalog has too many pages");
}

const searchValidators = new WeakMap<CatalogTool, ReturnType<typeof lenientToolValidator>>();
function argumentProblems(tool: CatalogTool, args: Json): string[] | undefined {
  let validate = searchValidators.get(tool);
  if (validate === undefined) {
    validate = lenientToolValidator(tool.inputSchema);
    searchValidators.set(tool, validate);
  }
  if (!validate) return undefined;
  try { return validate(args) ? undefined : schemaProblems(validate.errors); } catch { return undefined; }
}

function loadSearch(): Promise<SearchCatalog> {
  if (searchCatalog) return Promise.resolve(searchCatalog);
  if (!searchLoading) {
    const started = searchGeneration;
    const read = readUpstreamCatalog().then((upstream) => {
      const allowed = (name: string) => !WITHHOLD.has(name) && (!scope || allowsTool(scope, { kind: "mcp", server: NAME, name }));
      const directory = new ToolDirectory(upstream.filter((tool) => allowed(tool.name)), {
        withheld: upstream.filter((tool) => !allowed(tool.name)).map((tool) => tool.name),
        check: argumentProblems,
      });
      searchedOnce ||= searchedCatalog(directory.tools, SEARCH!);
      const built = { directory, searched: searchedOnce };
      if (searchGeneration === started) searchCatalog = built;
      return built;
    });
    searchLoading = read;
    void read.catch(reportBackgroundError).finally(() => { if (searchLoading === read) searchLoading = undefined; }).catch(reportBackgroundError);
  }
  return searchLoading;
}

function reply(id: unknown, result: unknown): void {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
}

/** tools/list and the three directory tools, answered by the gate; a
 * call_tool that names a tool continues as that tool's own call. */
async function searchRoute(line: string, message: Json): Promise<void> {
  const id = requestKey(message.id);
  const params = isRecord(message.params) ? message.params : undefined;
  try {
    if (message.method === "tools/list") {
      if (!id) return rejectRequest(message.id, -32600, "Tool listing needs a request ID");
      if (params?.cursor !== undefined) return rejectRequest(message.id, -32602, "Invalid cursor");
      const { directory, searched } = await loadSearch();
      let tools: Json[] = searched ? [...directory.pinned(pinnedToolNames(directory.tools, SEARCH!)), ...directory.listed(searchContext)] : [...directory.tools];
      if (SCHEMA_PROFILE) tools = fitToolList(tools, SCHEMA_PROFILE, (note) => process.stderr.write(`mcp-gate(${NAME}): ${note}\n`)) as Json[];
      return reply(message.id, { tools: BUDGET > 0 ? [...withoutOutputSchema(tools.filter((tool) => tool.name !== QUERY_TOOL_NAME)), QUERY_TOOL] : tools });
    }
    const { directory, searched } = await loadSearch();
    const name = params?.name;
    if (!searched || typeof name !== "string" || !isDirectoryTool(name)) return routeLine(line);
    if (!id) return;
    if (name === SEARCH_TOOL) return reply(message.id, await directory.search(params!.arguments));
    if (name === DESCRIBE_TOOL) return reply(message.id, directory.describe(params!.arguments));
    const call = directory.call(params!.arguments);
    if ("answer" in call) return reply(message.id, call.answer);
    const upstream = { ...message, params: { ...(isRecord(params!._meta) ? { _meta: params!._meta } : {}), name: call.name, arguments: call.arguments } };
    return routeLine(JSON.stringify(upstream));
  } catch (error) {
    process.stderr.write(`mcp-gate(${NAME}): tool search failed: ${String(error)}\n`);
    return rejectRequest(message.id, -32603, "This server's tools could not be listed. Try again.");
  }
}

// client -> server: verbatim, but remember which ids are tool calls
createInterface({ input: process.stdin }).on("line", (line) => {
  if (SEARCH && !ALIASES && line.trim()) {
    let parsed: unknown;
    try { parsed = JSON.parse(line); } catch { /* routeLine refuses or relays it */ }
    if (isRecord(parsed) && parsed.jsonrpc === "2.0" && (parsed.method === "tools/list" || (parsed.method === "tools/call" && isRecord(parsed.params) && isDirectoryTool(parsed.params.name)))) {
      const pendingSearch = searchRoute(line, parsed).finally(() => heldCalls.delete(pendingSearch));
      heldCalls.add(pendingSearch);
      return;
    }
  }
  routeLine(line);
});

function routeLine(line: string): void {
  let message: Json | undefined;
  if (line.trim()) {
    try {
      const parsed: unknown = JSON.parse(line);
      if (isRecord(parsed)) message = parsed;
    } catch {
      if (scope || APPROVAL_SOCKET) return rejectRequest(null, -32700, "Invalid JSON-RPC frame");
    }
    // A batch or a frame the gate cannot read could carry a call past the
    // selection or the approval check: refused on a gated connection.
    if ((scope || APPROVAL_SOCKET) && (!message || message.jsonrpc !== "2.0")) return rejectRequest(message?.id, -32600, "Invalid JSON-RPC frame");
  }
  const id = requestKey(message?.id);
  const params = isRecord(message?.params) ? message.params : undefined;
  // The gate's own read-only tool: it reads a result this process holds and
  // never reaches upstream, so no selection, alias or approval applies.
  if (BUDGET > 0 && message?.method === "tools/call" && params?.name === QUERY_TOOL_NAME) {
    if (!id) return;
    process.stderr.write(resolvedServerLog(NAME, QUERY_TOOL_NAME));
    process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: message.id, result: answerQuery(heldResults, params.arguments, BUDGET) })}\n`);
    return;
  }
  // #2189: a name agents already owns is not served here.
  if (WITHHOLD.size && message?.method === "tools/call" && typeof params?.name === "string") {
    const called = callTarget(params.name, params.arguments) ?? params.name;
    if (WITHHOLD.has(called) || WITHHOLD.has(params.name)) {
      process.stderr.write(resolvedServerLog("agents", called));
      if (id) {
        process.stdout.write(`${JSON.stringify({
          jsonrpc: "2.0",
          id: message.id,
          result: {
            content: [{ type: "text", text: `Tool "${called}" is served by the agents server on this turn, not by "${NAME}". Call it on agents.` }],
            isError: true,
          },
        })}\n`);
      }
      return;
    }
  }
  // An alias resolves through the map, before any check sees the name.
  if (ALIASES && message?.method === "tools/call" && params && typeof params.name === "string") {
    const upstream = ALIASES.upstream(params.name);
    const args = params.arguments === undefined ? undefined : ALIASES.argumentsToUpstream(params.arguments);
    if (upstream !== params.name || args !== params.arguments) {
      params.name = upstream;
      if (args !== undefined) params.arguments = args as Json;
      line = JSON.stringify(message);
    }
  }
  // #1374: Sagax's own agents server. A use_tool becomes the call it runs,
  // name and arguments, before the selection, the misuse guardrails and the
  // approval read it, and that same call is what reaches the server. One
  // that names no tool, or another meta tool, is refused here.
  if (NAME === BRIDGE_SERVER && message?.method === "tools/call" && params && typeof params.name === "string") {
    const bridged = readBridgeCall(params.name, params.arguments);
    if (bridged?.kind === "refused") {
      if (id) process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { content: [{ type: "text", text: bridged.reason }], isError: true } })}\n`);
      return;
    }
    if (bridged?.kind === "call") {
      params.name = bridged.tool;
      params.arguments = bridged.arguments;
      line = JSON.stringify(message);
    }
  }
  if (scope && message?.method === "tools/call") {
    if (!id || typeof params?.name !== "string"
      || (params.arguments !== undefined && !isRecord(params.arguments))) {
      return rejectRequest(message.id, -32602, "Invalid tool call");
    }
    const target = callTarget(params.name, params.arguments);
    if (target !== undefined && !allowsTool(scope, { kind: "mcp", server: NAME, name: target })) {
      return rejectRequest(message.id, -32602, "Tool selection excludes this tool. Check the bot's Access settings.");
    }
  }
  if (scope && message?.method === "tools/list" && !id) {
    return rejectRequest(message.id, -32600, "Tool listing needs a request ID");
  }
  if (message?.method === "tools/call" && misuseGateRefusal(params)) {
    const reason = misuseGateRefusal(params)!;
    process.stderr.write(`mcp-gate(${NAME}): misuse blocked\n`);
    if (id) process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { content: [{ type: "text", text: reason }], isError: true } })}\n`);
    return;
  }
  if (APPROVAL_SOCKET && message?.method === "tools/call") {
    if (!id || typeof params?.name !== "string") return rejectRequest(message.id, -32602, "Invalid tool call");
    const target = callTarget(params.name, params.arguments);
    // The directory answers a call naming no tool itself; nothing runs.
    // A reviewed name is listed with one `_` (cw_psa_query); an earlier
    // Perspicax serves the same tool as cw_psa__query.
    if (target !== undefined && !READ_ONLY.has(target) && !READ_ONLY.has(target.replace(/_{2,}/g, "_"))) {
      const callId = message.id;
      const held = askApproval(NAME, target, params.arguments)
        .then((decision) => {
          if (decision.behavior === "allow") return forward(line, message, id, params);
          process.stderr.write(`mcp-gate(${NAME}): ${target} not approved; not run\n`);
          const text = decision.note?.trim() || gateDeclinedText(NAME, target);
          process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: callId, result: { content: [{ type: "text", text }], isError: true } })}\n`);
        })
        .finally(() => heldCalls.delete(held));
      heldCalls.add(held);
      return;
    }
  }
  forward(line, message, id, params);
}

/** Calls waiting for an approval: the upstream's stdin closes only after them. */
const heldCalls = new Set<Promise<void>>();

/** Hard misuse categories, in enforce mode only. Defensive security work
 * stays on the approval path. Shadow (the default) does not refuse. */
function misuseGateRefusal(params: Json | undefined): string | null {
  const mode = gateEnv.SAGAX_GATE_MISUSE_MODE || process.env.SAGAX_MISUSE_GUARDRAILS || "shadow";
  const name = typeof params?.name === "string" ? params.name : "";
  const args = params?.arguments === undefined ? "" : JSON.stringify(params.arguments);
  return misuseGateBlockText(`${name}\n${args}`, mode);
}

function forward(line: string, message: Json | undefined, id: string | undefined, params: Json | undefined): void {
  if ((SEARCH || ALIASES) && id && message?.method === "initialize") initializeIds.add(id);
  if (id && typeof message?.method === "string") {
    if (scope && pending.has(id)) fail("duplicate request ID on a restricted connection");
    if (message.method === "tools/call") {
      const name = typeof params?.name === "string" ? params.name : "tool";
      const target = callTarget(name, params?.arguments);
      pending.set(id, { kind: "call", tool: target ?? name, trim: target !== undefined });
      process.stderr.write(resolvedServerLog(NAME, target ?? name));
    } else if (scope || WITHHOLD.size || ((ALIASES || BUDGET > 0 || SCHEMA_PROFILE) && message.method === "tools/list")) {
      pending.set(id, { kind: message.method === "tools/list" ? "list" : "other" });
    }
  }
  child.stdin.write(`${line}\n`);
}
process.stdin.on("end", () => {
  void Promise.allSettled(heldCalls).then(() => child.stdin.end()).catch(reportBackgroundError);
});

// server -> client: the one direction that gets rewritten
createInterface({ input: child.stdout }).on("line", (line) => {
  if (!line.trim()) return;
  let message: Json | undefined;
  try {
    const parsed: unknown = JSON.parse(line);
    if (isRecord(parsed)) message = parsed;
  } catch {
    // Not JSON the gate understands. Relay it exactly as it came: a frame the
    // gate cannot read is still the upstream server's answer to give.
    if (scope) fail("unreadable upstream frame on a restricted connection");
  }
  if (!message || (scope && message.jsonrpc !== "2.0")) {
    if (scope) fail("invalid upstream frame on a restricted connection");
    process.stdout.write(`${line}\n`);
    return;
  }
  const id = typeof message.method === "string" ? undefined : requestKey(message.id);
  // The gate's own catalog requests (tool search) are never relayed.
  if (id !== undefined && internal.has(id)) {
    const resolve = internal.get(id)!;
    internal.delete(id);
    resolve(message);
    return;
  }
  if (SEARCH && message.method === "notifications/tools/list_changed") {
    searchGeneration += 1;
    searchCatalog = undefined;
    searchLoading = undefined;
  }
  const request = id === undefined ? undefined : pending.get(id);
  if (scope && id !== undefined && !request) fail("unrequested upstream response on a restricted connection");
  if (id !== undefined) pending.delete(id);
  const result = message.result;
  // Who the server is, for the directory tools' own descriptions.
  if (id !== undefined && initializeIds.delete(id) && isRecord(result)) {
    const info = isRecord(result.serverInfo) ? result.serverInfo : {};
    const title = typeof info.title === "string" ? info.title : typeof info.name === "string" ? info.name : undefined;
    if (title) searchContext.title = title;
    if (ALIASES && typeof result.instructions === "string") result.instructions = ALIASES.instructionsToAliases(result.instructions);
    if (typeof result.instructions === "string") searchContext.instructions = result.instructions;
  }
  if (scope && request?.kind === "list" && message.error === undefined) {
    if (!isRecord(result) || !Array.isArray(result.tools)
      || !result.tools.every((tool: unknown) => isRecord(tool) && typeof tool.name === "string" && tool.name.trim().length > 0)
      || (result.nextCursor !== undefined && typeof result.nextCursor !== "string")) {
      return rejectRequest(message.id, -32603, "Invalid tool catalog on a restricted connection");
    }
    result.tools = result.tools.filter((tool: Json) => (DIRECTORY && isDirectoryTool(tool.name))
      || allowsTool(scope, { kind: "mcp", server: NAME, name: tool.name as string }));
  }
  // #2189: drop connector tools whose bare name agents already owns.
  if (WITHHOLD.size && request?.kind === "list" && message.error === undefined && isRecord(result) && Array.isArray(result.tools)) {
    result.tools = result.tools.filter((tool: unknown) => !isRecord(tool) || typeof tool.name !== "string" || !WITHHOLD.has(tool.name));
  }
  if (ALIASES && request?.kind === "list" && message.error === undefined && isRecord(result) && Array.isArray(result.tools)) {
    const tools = result.tools.filter((tool: unknown): tool is Json & { name: string } => isRecord(tool) && typeof tool.name === "string" && tool.name.length > 0);
    const outcome = ALIASES.catalog(tools);
    result.tools = outcome.tools;
    reportToolNames(tools.map((tool) => tool.name), outcome);
  }
  if (SCHEMA_PROFILE && request?.kind === "list" && message.error === undefined && isRecord(result) && Array.isArray(result.tools)) {
    result.tools = fitToolList(result.tools, SCHEMA_PROFILE, (note) => process.stderr.write(`mcp-gate(${NAME}): ${note}\n`));
  }
  // query_result rides the last page of the catalog, in place of any upstream
  // tool of that name; no page keeps an outputSchema (see trimCallResult).
  if (BUDGET > 0 && request?.kind === "list" && message.error === undefined && isRecord(result) && Array.isArray(result.tools)) {
    const tools = withoutOutputSchema(result.tools.filter((tool: unknown) => !isRecord(tool) || tool.name !== QUERY_TOOL_NAME));
    result.tools = result.nextCursor === undefined ? [...tools, QUERY_TOOL] : tools;
  }
  // 2026-11-02: a connector name Grok cannot call never reaches the bot:
  // the gateway's own tools (api_search, api_describe, api_list, flow...,
  // no `__` in their name) and every error name tools by the connector's
  // name. Product tools' results are vendor data and stay as they came.
  if (ALIASES && request?.kind === "call") {
    if (isRecord(message.error) && typeof message.error.message === "string") message.error.message = ALIASES.toAliases(message.error.message);
    if (isRecord(result) && (!request.tool.includes("__") || result.isError === true)) {
      if (Array.isArray(result.content)) result.content = mapJsonStrings(result.content, (text) => ALIASES.toAliases(text)) as Json[];
      if (result.structuredContent !== undefined) result.structuredContent = mapJsonStrings(result.structuredContent, (text) => ALIASES.toAliases(text)) as Json;
    }
  }
  if (request?.kind === "call" && request.trim && isRecord(result)) {
    try {
      if (trimCallResult(result, request.tool)) {
        process.stderr.write(`mcp-gate(${NAME}): trimmed ${request.tool} to ${BUDGET} chars\n`);
      }
    } catch (error) {
      // A result the trimmer chokes on is relayed whole. Costing context is
      // recoverable; dropping a tool answer is not.
      process.stderr.write(`mcp-gate(${NAME}): could not trim ${request.tool}: ${String(error)}\n`);
      process.stdout.write(`${line}\n`);
      return;
    }
  }
  process.stdout.write(`${JSON.stringify(message)}\n`);
});

child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
