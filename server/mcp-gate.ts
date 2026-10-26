// A pass-through MCP server that keeps one tool result from eating a
// conversation.
//
// The provider CLI mounts this instead of the bot's real MCP server. Every
// JSON-RPC frame is relayed in both directions. With a tool selection, discovery
// is filtered and excluded calls are rejected before upstream execution.
// An oversized `tools/call` result is cut to a budget (mcp-trim.ts), the
// untrimmed text is written to a file, and the model is told in the result
// where that file is so it can read or grep the rest with its ordinary tools.
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
import { allowsTool, parseToolScope, type ToolScope } from "../shared/tool-scope.ts";

import { resolveCliSpawn } from "./env-path.ts";
import { directoryCallTarget, isDirectoryTool } from "./mcp-directory.ts";
import { DEFAULT_RESULT_BUDGET, trimResultText, trimStructured } from "./mcp-trim.ts";
import { ToolNameAliases } from "./mcp-tool-names.ts";
import { killCliTree } from "./procs.ts";
import { misuseGateBlockText } from "../shared/misuse-guardrails.ts";
import { gateArgsSummary, gateDeclinedText, type GateAnswer, type GateAsk } from "./mcp-gate-approval.ts";

type Json = Record<string, unknown>;

/** Codex imports env variables from one shared app-server environment. Each
 * mount names its own private record; only the variable name reaches argv. */
function gateEnvironment(): NodeJS.ProcessEnv {
  if (process.argv.length === 2) return process.env;
  try {
    const key = process.argv[3];
    if (process.argv.length !== 4 || process.argv[2] !== "--config-env" || !key || !/^SAGAX_GATE_CONFIG_[a-f0-9]{64}$/.test(key)) throw new Error();
    const value = JSON.parse(process.env[key] ?? "");
    if (!value || typeof value !== "object" || Array.isArray(value)
      || !["SAGAX_GATE_NAME", "SAGAX_GATE_UPSTREAM", "SAGAX_GATE_TOOL_SCOPE"].every(name => typeof value[name] === "string")
      || !Object.entries(value).every(([name, setting]) => GATE_ENV_KEYS.includes(name) && typeof setting === "string")) throw new Error();
    return value;
  } catch {
    process.stderr.write("mcp-gate: invalid private configuration\n"); process.exit(1);
  }
}
/** The gate's own settings never reach the upstream server's environment. */
const GATE_ENV_KEYS = ["SAGAX_GATE_NAME", "SAGAX_GATE_SPILL_DIR", "SAGAX_GATE_BUDGET", "SAGAX_GATE_UPSTREAM", "SAGAX_GATE_SPILL_HINT", "SAGAX_GATE_TOOL_SCOPE", "SAGAX_GATE_DIRECTORY", "SAGAX_GATE_TOOL_NAMES", "SAGAX_GATE_REPORT_DIR", "SAGAX_GATE_APPROVAL_SOCKET", "SAGAX_GATE_APPROVAL_TOKEN", "SAGAX_GATE_READ_ONLY", "SAGAX_GATE_MISUSE_MODE"];
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
/** `grok`: the engine skips tool names it cannot qualify (mcp-tool-names.ts).
 * The gate registers every tool under an admissible name and maps calls
 * back through an explicit alias map. Never a silent drop: every rename and
 * any tool still unregistrable is logged loudly and written to the report. */
const ALIASES = gateEnv.SAGAX_GATE_TOOL_NAMES === "grok" ? new ToolNameAliases(NAME) : undefined;
const REPORT_DIR = gateEnv.SAGAX_GATE_REPORT_DIR || "";
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
  if (!/^[a-z][a-z0-9_-]{0,31}$/.test(NAME)) fail("invalid MCP server identity for tool selection");
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

/** Whether `text` is `value` serialized: the same data, object key order
 * aside (a server may build the two copies differently); array order counts. */
function sameJson(text: string, value: unknown): boolean {
  try {
    return sameValue(JSON.parse(text), value, 0);
  } catch {
    return false;
  }
}

function sameValue(a: unknown, b: unknown, depth: number): boolean {
  if (a === b) return true;
  if (depth > 200 || !a || !b || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, i) => sameValue(item, b[i], depth + 1));
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length
    && keys.every((key) => Object.hasOwn(right, key) && sameValue(left[key], right[key], depth + 1));
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
  // The usual shape: one text block that is structuredContent serialized.
  const structuredIsText = textBlocks.length === 1 && Boolean(result.structuredContent) && typeof result.structuredContent === "object"
    && sameJson(textBlocks[0]!.text, result.structuredContent);
  let trimmed = false;
  let keptValue: unknown;
  for (const block of textBlocks) {
    const outcome = trimResultText({ text: block.text, budget: share, spillPath: path, spillHint: SPILL_HINT, toolName: tool });
    if (!outcome.trimmed) continue;
    block.text = outcome.text;
    keptValue = outcome.value;
    trimmed = true;
  }

  // A tool that also answers with structuredContent would otherwise hand the
  // provider a second, full copy of everything just cut. When it is the same
  // data as the text, it keeps exactly the records the text kept; otherwise
  // it is trimmed the same way on its own, structurally only so it stays
  // valid against the tool's output schema, and left untouched when it
  // cannot be cut without mangling it.
  if (trimmed && result.structuredContent && typeof result.structuredContent === "object") {
    if (structuredIsText && keptValue && typeof keptValue === "object") {
      result.structuredContent = keptValue as Json;
    } else {
      const structured = trimStructured(result.structuredContent, BUDGET);
      if (structured) result.structuredContent = structured.value as Json;
    }
  }
  return trimmed;
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
  void killCliTree(child);
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
  return DIRECTORY ? directoryCallTarget(name, args) : name;
}
/** JSON-RPC string and numeric IDs are separate, even when their text is equal. */
const pending = new Map<string, Pending>();

// client -> server: verbatim, but remember which ids are tool calls
createInterface({ input: process.stdin }).on("line", (line) => {
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
  // An alias resolves through the map, before any check sees the name.
  if (ALIASES && message?.method === "tools/call" && params && typeof params.name === "string") {
    const upstream = ALIASES.upstream(params.name);
    if (upstream !== params.name) {
      params.name = upstream;
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
    if (target !== undefined && !READ_ONLY.has(target)) {
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
});

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
  if (id && typeof message?.method === "string") {
    if (scope && pending.has(id)) fail("duplicate request ID on a restricted connection");
    if (message.method === "tools/call") {
      const name = typeof params?.name === "string" ? params.name : "tool";
      const target = callTarget(name, params?.arguments);
      pending.set(id, { kind: "call", tool: target ?? name, trim: target !== undefined });
    } else if (scope || (ALIASES && message.method === "tools/list")) {
      pending.set(id, { kind: message.method === "tools/list" ? "list" : "other" });
    }
  }
  child.stdin.write(`${line}\n`);
}
process.stdin.on("end", () => {
  void Promise.allSettled(heldCalls).then(() => child.stdin.end());
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
  const request = id === undefined ? undefined : pending.get(id);
  if (scope && id !== undefined && !request) fail("unrequested upstream response on a restricted connection");
  if (id !== undefined) pending.delete(id);
  const result = message.result;
  if (scope && request?.kind === "list" && message.error === undefined) {
    if (!isRecord(result) || !Array.isArray(result.tools)
      || !result.tools.every((tool: unknown) => isRecord(tool) && typeof tool.name === "string" && tool.name.trim().length > 0)
      || (result.nextCursor !== undefined && typeof result.nextCursor !== "string")) {
      return rejectRequest(message.id, -32603, "Invalid tool catalog on a restricted connection");
    }
    result.tools = result.tools.filter((tool: Json) => (DIRECTORY && isDirectoryTool(tool.name))
      || allowsTool(scope, { kind: "mcp", server: NAME, name: tool.name as string }));
  }
  if (ALIASES && request?.kind === "list" && message.error === undefined && isRecord(result) && Array.isArray(result.tools)) {
    const tools = result.tools.filter((tool: unknown): tool is Json & { name: string } => isRecord(tool) && typeof tool.name === "string" && tool.name.length > 0);
    const outcome = ALIASES.catalog(tools);
    result.tools = outcome.tools;
    reportToolNames(tools.map((tool) => tool.name), outcome);
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
