// pi-mcp-extension — the Pi-side half of "hands" for the pi engine.
//
// Pi core deliberately ships no MCP client (see pi's docs: "does not include
// built-in MCP"). This extension is that client: loaded into the per-turn
// `pi --mode rpc --no-session` process via `-e`, it reads a JSON file whose
// path is handed in through SAGAX_MCP_CONFIG and mounts every server described
// there as first-class pi tools (pi.registerTool). Sagax ships this file
// and the pi driver spawns it — the pi repo itself is never touched.
//
// Protocol: the Sagax proxies speak raw JSON-RPC 2.0 over stdio, one
// frame per line (no MCP SDK, no Content-Length framing) — see
// server/mcp/mcp-bridge.ts and server/drivers/agents-proxy.ts. This client matches
// that exactly.
import { Type, type TObjectOptions, type TSchema, type TSchemaOptions } from "typebox";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { allowsTool, canUseMcpServer, parseToolScope, type ToolIdentity } from "../../shared/tool-scope.ts";
import { CALL_TOOL, directoryCallTarget, isDirectoryTool } from "../mcp/mcp-directory.ts";
import { REMOTE_MCP_STARTUP_MS } from "../mcp/mcp-http.ts";

interface McpServerDef {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  /** "local-computer" marks the user's real host desktop: every tool on such
   * a server is gated behind a permission card before it executes, unless
   * the turn runs under Full access. */
  scope?: string;
  /** A URL server behind the remote proxy's tool directory: a big catalog
   * arrives as search_tools, describe_tool and call_tool (mcp-directory.ts). */
  directory?: boolean;
  /** #1276: a catalog searched by the gate, or the agents catalog in a
   * compact prompt: the same three tools, read the same way as a directory's
   * (call_tool is the tool it runs, for the tool scope and the card). */
  searched?: boolean;
}

interface McpConfig {
  mcpServers?: Record<string, McpServerDef>;
  toolScope?: unknown;
  scopeReadyPath?: string;
  approvalMode?: string;
  /** #1276: a compact prompt keeps pi's system prompt the same in every
   * conversation; the conversation's folder rides the turn instead. */
  stableCwd?: boolean;
  /** #1276: where this pi writes the tool lists it mounted, per server, so
   * the thread's next pi (started between turns) can declare them. */
  toolCachePath?: string;
  /** #1276: the lists the previous pi of this thread mounted. A server
   * whose listing fails now (its turn credentials expired with that turn)
   * declares these and connects at its first call, during a live turn. */
  toolCache?: Record<string, McpTool[]>;
  /** #1276: the Sagax prompt's stable part rides its own user message
   * (STABLE_END_MARKER), so a local server can keep its cache there. */
  splitStable?: boolean;
  /** Where this pi writes the request that warms that cache (no credentials). */
  warmPath?: string;
  /** The request a standby pi sends once its session is resumed. */
  warm?: Record<string, unknown>;
}

/** #1276: Sagax writes this between its prompt's stable and volatile parts.
 * The extension cuts the message there: a local server stores its prefix
 * cache only at the end of a message, and a new conversation shares the
 * stable part, never the volatile one. The text never reaches the model. */
export const STABLE_END_MARKER = "\n<!-- sagax:stable-end -->\n";
/** What the model reads between the stable part and the rest of the turn. */
export const STABLE_ACK = "Understood.";

type ChatMessage = { role?: unknown; content?: unknown };

function messageText(content: unknown): string | undefined {
  if (typeof content === "string") return content;
  if (!Array.isArray(content) || !content.every((part) => part && typeof part === "object" && (part as { type?: unknown }).type === "text" && typeof (part as { text?: unknown }).text === "string")) return undefined;
  return content.map((part) => (part as { text: string }).text).join("");
}

/** The provider messages with the first marked user message cut in two
 * around a fixed reply, and the messages that end at the stable part. */
export function splitStableMessages(messages: unknown[]): { messages: unknown[]; stable: unknown[] } | undefined {
  const at = messages.findIndex((message) => (message as ChatMessage)?.role === "user" && messageText((message as ChatMessage).content)?.includes(STABLE_END_MARKER));
  if (at < 0) return undefined;
  const out: unknown[] = [];
  let stable: unknown[] | undefined;
  for (const [index, message] of messages.entries()) {
    const text = (message as ChatMessage)?.role === "user" ? messageText((message as ChatMessage).content) : undefined;
    const cut = text?.indexOf(STABLE_END_MARKER) ?? -1;
    if (text === undefined || cut < 0) { out.push(message); continue; }
    const head = { ...(message as object), content: text.slice(0, cut) };
    if (index === at) stable = [...out, head];
    out.push(head, { role: "assistant", content: STABLE_ACK }, { ...(message as object), content: text.slice(cut + STABLE_END_MARKER.length) });
  }
  return { messages: out, stable: stable! };
}

type WarmContext = {
  model?: { id?: unknown; api?: unknown; baseUrl?: unknown };
  modelRegistry?: { getApiKeyAndHeaders(model: unknown): Promise<{ ok: boolean; apiKey?: string; headers?: Record<string, string | null>; baseUrl?: string }> };
};

/** Send the warm request through the session's own provider settings. Only
 * an OpenAI-compatible local server takes it; anything else is left alone. */
async function sendWarm(warm: Record<string, unknown>, ctx: WarmContext | undefined): Promise<void> {
  const model = ctx?.model;
  if (!model || model.api !== "openai-completions" || !ctx?.modelRegistry) return;
  // The warm request was cut from a local model's own request. A session that
  // resumed on another model (a cloud provider's key would pay for it, and the
  // prompt would reach that provider) gets nothing.
  if (typeof warm.model !== "string" || model.id !== warm.model) return;
  const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
  const base = auth.ok ? auth.baseUrl ?? model.baseUrl : undefined;
  if (typeof base !== "string" || !base) return;
  const headers: Record<string, string> = { "content-type": "application/json" };
  for (const [key, value] of Object.entries(auth.headers ?? {})) if (typeof value === "string") headers[key] = value;
  if (auth.apiKey && !Object.keys(headers).some((key) => key.toLowerCase() === "authorization")) headers.authorization = `Bearer ${auth.apiKey}`;
  const signal = AbortSignal.timeout(120_000);
  const res = await fetch(`${base.replace(/\/+$/, "")}/chat/completions`, { method: "POST", headers, body: JSON.stringify(warm), signal });
  await res.arrayBuffer();
}

/** What pi's cwd section says in a compact prompt (#1276). */
export const STABLE_CWD_NOTE = "this conversation's own folder, given as \"Current working directory\" in the conversation";

/** #1276: pi renders the process cwd into its system prompt, so two new
 * conversations of the same bot diverge there and a local model's prefix
 * cache serves nothing after it. The section names a fixed text; the real
 * folder rides a short message of the turn, at the end of the prompt. pi's
 * own tools keep the process cwd: nothing changes for files. */
export function stableCwdTurn(options: { cwd?: unknown }): { customType: string; content: string; display: boolean } | undefined {
  const real = options.cwd;
  if (typeof real !== "string" || !real || real === STABLE_CWD_NOTE) return undefined;
  options.cwd = STABLE_CWD_NOTE;
  return { customType: "sagax-cwd", content: `Current working directory: ${real}`, display: false };
}

interface McpTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

interface McpTextContent {
  type: "text";
  text: unknown;
}

interface McpImageContent {
  type: "image";
  data: unknown;
  mimeType: unknown;
}

type PiToolContent = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };

interface PiToolContext {
  ui: {
    confirm(title: string, message: string): Promise<boolean>;
  };
}

interface PiToolDefinition {
  name: string;
  label: string;
  description: string;
  parameters: TSchema;
  execute(
    toolCallId: string,
    params: unknown,
    signal: AbortSignal | undefined,
    onUpdate: unknown,
    context: PiToolContext,
  ): Promise<{ content: PiToolContent[]; details: Record<string, never> }>;
}

/** Structural slice of Pi 0.84's ExtensionAPI used by this standalone file.
 * Keeping it local avoids bundling Pi into Sagax; the extension is
 * loaded by the user's installed Pi, which supplies the real implementation. */
interface PiExtensionApi {
  registerTool(definition: PiToolDefinition): void;
  on(event: string, handler: (event?: Record<string, unknown>, context?: { abort?(): void }) => unknown): void;
  getActiveTools?(): string[];
  setActiveTools?(names: string[]): void;
}

const MCP_STARTUP_TIMEOUT_MS = 8_000;
const MCP_TOOL_TIMEOUT_MS = 10 * 60_000;
const MCP_MAX_LIST_PAGES = 100;
const MCP_MAX_FRAME_BYTES = 32 * 1024 * 1024;
const TOOL_OUTPUT_MAX_BYTES = 50 * 1024;
const TOOL_OUTPUT_MAX_LINES = 2_000;
const TOOL_NAME_MAX_LENGTH = 64;

/** A minimal stdio JSON-RPC 2.0 MCP client, matched to Sagax's
 * newline-delimited house protocol. */
export class StdioMcp {
  private child: ChildProcessWithoutNullStreams;
  private buf = "";
  private nextId = 1;
  private disposed = false;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  /** A searched URL server answers over the internet: initialize and its
   * whole tools/list share one longer budget. Others keep 8 s for each. */
  private readonly remote: boolean;
  private listDeadline: number | undefined;
  private catalogVersion = 0;

  toolsVersion(): number { return this.catalogVersion; }

  constructor(def: McpServerDef) {
    this.remote = def.directory === true;
    this.child = spawn(def.command, def.args ?? [], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...def.env },
    });
    this.child.stderr.on("data", () => {
      /* best-effort drain so a chatty server never blocks */
    });
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk: string) => this.onData(chunk));
    this.child.on("error", (err) => this.closeWithError(err));
    // A server that starts and then dies emits `exit`, never `error`; without
    // settling on it, an in-flight init/listTools would hang the extension
    // load for the whole turn.
    this.child.on("exit", (code) => this.closeWithError(new Error(`MCP server exited (code ${code ?? "?"})`)));
    // A write to a dead child errors asynchronously on the stream; an
    // unhandled stream error would kill the pi process (the same hazard
    // spawnCli documents for driver-spawned children in procs.ts).
    this.child.stdin.on("error", () => this.closeWithError(new Error("MCP server stdin closed")));
  }

  private failAll(err: Error): void {
    for (const [, p] of this.pending) p.reject(err);
    this.pending.clear();
  }

  private closeWithError(err: Error): void {
    if (this.disposed) return;
    this.disposed = true;
    this.failAll(err);
    try {
      this.child.kill();
    } catch {
      /* already gone */
    }
  }

  private onData(chunk: string): void {
    this.buf += chunk;
    let nl: number;
    while ((nl = this.buf.indexOf("\n")) !== -1) {
      const line = this.buf.slice(0, nl).trim();
      this.buf = this.buf.slice(nl + 1);
      if (!line) continue;
      if (Buffer.byteLength(line, "utf8") > MCP_MAX_FRAME_BYTES) {
        this.closeWithError(new Error(`MCP frame exceeded ${MCP_MAX_FRAME_BYTES} bytes`));
        return;
      }
      let msg: { id?: unknown; method?: unknown; error?: { message?: string }; result?: unknown };
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (typeof msg.id === "number" && this.pending.has(msg.id)) {
        const p = this.pending.get(msg.id)!;
        this.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(msg.error.message ?? "MCP error"));
        else p.resolve(msg.result);
        continue;
      }
      // This minimal client does not implement server→client requests. Reply
      // explicitly instead of leaving a conforming server waiting forever.
      if (msg.id !== undefined && typeof msg.method === "string") {
        try {
          this.write({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "Client method not supported" } });
        } catch (err) {
          this.closeWithError(err instanceof Error ? err : new Error(String(err)));
          return;
        }
      }
      if (msg.method === "notifications/tools/list_changed") this.catalogVersion += 1;
    }
    if (Buffer.byteLength(this.buf, "utf8") > MCP_MAX_FRAME_BYTES) {
      this.closeWithError(new Error(`MCP frame exceeded ${MCP_MAX_FRAME_BYTES} bytes without a newline`));
    }
  }

  private write(frame: unknown): void {
    if (this.disposed || this.child.stdin.destroyed || !this.child.stdin.writable) {
      throw new Error("MCP server stdin is closed");
    }
    this.child.stdin.write(JSON.stringify(frame) + "\n");
  }

  private call(method: string, params: unknown, timeoutMs: number, signal?: AbortSignal): Promise<unknown> {
    if (this.disposed) return Promise.reject(new Error("MCP client is closed"));
    if (signal?.aborted) return Promise.reject(new Error(`MCP ${method} aborted`));

    const id = this.nextId++;
    return new Promise<unknown>((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
      };
      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        cleanup();
        fn();
      };
      const cancel = (reason: string) => {
        this.pending.delete(id);
        try {
          this.notify("notifications/cancelled", { requestId: id, reason });
        } catch {
          /* the transport may already be gone */
        }
        settle(() => reject(new Error(reason)));
      };
      const onAbort = () => cancel(`MCP ${method} aborted`);
      const timer = setTimeout(() => cancel(`MCP ${method} timed out after ${timeoutMs}ms`), timeoutMs);
      timer.unref?.();
      signal?.addEventListener("abort", onAbort, { once: true });
      this.pending.set(id, {
        resolve: (value) => settle(() => resolve(value)),
        reject: (err) => settle(() => reject(err)),
      });
      try {
        this.write({ jsonrpc: "2.0", id, method, params });
      } catch (err) {
        this.pending.delete(id);
        settle(() => reject(err instanceof Error ? err : new Error(String(err))));
      }
    });
  }

  private notify(method: string, params?: unknown): void {
    this.write({ jsonrpc: "2.0", method, params });
  }

  async init(): Promise<void> {
    const budget = this.remote ? REMOTE_MCP_STARTUP_MS : MCP_STARTUP_TIMEOUT_MS;
    this.listDeadline = this.remote ? Date.now() + budget : undefined;
    await this.call(
      "initialize",
      {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "openmausbot-pi", version: "1" },
      },
      budget,
    );
    this.notify("notifications/initialized");
  }

  async listTools(): Promise<McpTool[]> {
    const tools: McpTool[] = [];
    const seenCursors = new Set<string>();
    const deadline = this.listDeadline ?? Date.now() + (this.remote ? REMOTE_MCP_STARTUP_MS : MCP_STARTUP_TIMEOUT_MS);
    this.listDeadline = undefined;
    let cursor: string | undefined;
    for (let page = 0; page < MCP_MAX_LIST_PAGES; page += 1) {
      const remainingMs = Math.max(1, deadline - Date.now());
      const res = (await this.call(
        "tools/list",
        cursor ? { cursor } : {},
        remainingMs,
      )) as { tools?: unknown; nextCursor?: unknown } | undefined;
      if (!Array.isArray(res?.tools)) throw new Error("MCP tools/list returned no tools array");
      tools.push(...(res.tools as McpTool[]));
      if (typeof res.nextCursor !== "string" || !res.nextCursor) return tools;
      if (seenCursors.has(res.nextCursor)) throw new Error("MCP tools/list repeated a pagination cursor");
      seenCursors.add(res.nextCursor);
      cursor = res.nextCursor;
    }
    throw new Error(`MCP tools/list exceeded ${MCP_MAX_LIST_PAGES} pages`);
  }

  /** tools/call → Pi content, preserving screenshots and bounding text so a
   * remote server cannot flood the model context. */
  async callTool(name: string, args: unknown, signal?: AbortSignal): Promise<{ content: PiToolContent[]; isError: boolean }> {
    const res = (await this.call(
      "tools/call",
      { name, arguments: args ?? {} },
      MCP_TOOL_TIMEOUT_MS,
      signal,
    )) as { content?: unknown; isError?: boolean } | undefined;
    const rawContent = Array.isArray(res?.content) ? res.content : [];
    const text = rawContent
      .filter((c): c is McpTextContent => Boolean(c) && (c as { type?: unknown }).type === "text")
      .map((c) => String(c.text ?? ""))
      .join("\n");
    const images = rawContent
      .filter(
        (c): c is McpImageContent =>
          Boolean(c) &&
          (c as { type?: unknown }).type === "image" &&
          typeof (c as McpImageContent).data === "string" &&
          typeof (c as McpImageContent).mimeType === "string",
      )
      .map((c) => ({ type: "image" as const, data: String(c.data), mimeType: String(c.mimeType) }));
    const unsupported = rawContent.length - rawContent.filter((c) => (c as { type?: unknown })?.type === "text").length - images.length;
    let boundedText = truncateToolText(text || (images.length ? "" : "(empty result)"));
    if (unsupported > 0) boundedText += `${boundedText ? "\n" : ""}[${unsupported} unsupported MCP content item(s) omitted]`;
    return {
      content: [...(boundedText ? [{ type: "text" as const, text: boundedText }] : []), ...images],
      isError: Boolean(res?.isError),
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.failAll(new Error("MCP client disposed"));
    try {
      this.child.kill();
    } catch {
      /* already gone */
    }
  }
}

interface JsonSchema {
  type?: string | string[];
  title?: unknown;
  description?: unknown;
  default?: unknown;
  const?: unknown;
  enum?: unknown[];
  nullable?: unknown;
  anyOf?: unknown[];
  oneOf?: unknown[];
  allOf?: unknown[];
  items?: unknown | unknown[];
  prefixItems?: unknown[];
  properties?: Record<string, unknown>;
  required?: unknown;
  additionalProperties?: unknown;
  minimum?: unknown;
  maximum?: unknown;
  exclusiveMinimum?: unknown;
  exclusiveMaximum?: unknown;
  multipleOf?: unknown;
  minLength?: unknown;
  maxLength?: unknown;
  pattern?: unknown;
  format?: unknown;
  minItems?: unknown;
  maxItems?: unknown;
  uniqueItems?: unknown;
  minProperties?: unknown;
  maxProperties?: unknown;
}

const SCHEMA_OPTION_KEYS = [
  "title",
  "description",
  "default",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minLength",
  "maxLength",
  "pattern",
  "format",
  "minItems",
  "maxItems",
  "uniqueItems",
  "minProperties",
  "maxProperties",
] as const;

function schemaOptions(schema: JsonSchema): TSchemaOptions {
  const options: TSchemaOptions = {};
  for (const key of SCHEMA_OPTION_KEYS) {
    const value = schema[key];
    if (value !== undefined) Reflect.set(options, key, value);
  }
  return options;
}

function isSchemaObject(value: unknown): value is JsonSchema {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function primitiveLiteral(value: unknown): TSchema | null {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return Type.Literal(value);
  }
  if (value === null) return Type.Null();
  return null;
}

function withNullable(schema: TSchema, nullable: unknown): TSchema {
  return nullable === true ? Type.Union([schema, Type.Null()]) : schema;
}

function collectObjectShape(schema: JsonSchema): { properties: Record<string, unknown>; required: Set<string> } {
  const properties: Record<string, unknown> = {};
  const required = new Set<string>();

  const visit = (candidate: unknown, mode: "root" | "all" | "choice") => {
    if (!isSchemaObject(candidate)) return;
    for (const branch of candidate.allOf ?? []) visit(branch, mode === "choice" ? "choice" : "all");
    for (const branch of [...(candidate.anyOf ?? []), ...(candidate.oneOf ?? [])]) visit(branch, "choice");
    for (const [key, value] of Object.entries(candidate.properties ?? {})) {
      // The root declaration is authoritative; branch-only properties are
      // still retained so the model knows which arguments exist.
      if (mode === "root" || properties[key] === undefined) properties[key] = value;
    }
    if (mode !== "choice" && Array.isArray(candidate.required)) {
      for (const key of candidate.required) if (typeof key === "string") required.add(key);
    }
  };

  visit(schema, "root");
  return { properties, required };
}

function objectSchema(schema: JsonSchema, root = false): TSchema {
  const { properties, required } = collectObjectShape(schema);
  const converted: Record<string, TSchema> = {};
  for (const [key, value] of Object.entries(properties)) {
    const nested = nestedTypebox(value);
    converted[key] = required.has(key) ? nested : Type.Optional(nested);
  }
  const options: TObjectOptions = schemaOptions(schema);
  if (typeof schema.additionalProperties === "boolean") {
    options.additionalProperties = schema.additionalProperties;
  } else if (isSchemaObject(schema.additionalProperties)) {
    options.additionalProperties = nestedTypebox(schema.additionalProperties);
  }
  const object = Type.Object(converted, options);
  return root ? object : withNullable(object, schema.nullable);
}

function nestedTypebox(schema: unknown): TSchema {
  if (!isSchemaObject(schema)) return Type.Any();
  const options = schemaOptions(schema);

  const literal = primitiveLiteral(schema.const);
  if (literal) return withNullable(literal, schema.nullable);

  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    if (schema.enum.every((value) => typeof value === "string")) {
      // `{type:"string", enum:[...]}` works across Google/OpenAI/Anthropic;
      // Type.Union(Type.Literal(...)) does not work with Google's tool API.
      return withNullable(Type.String({ ...options, enum: schema.enum }), schema.nullable);
    }
    const literals = schema.enum.map(primitiveLiteral).filter((value): value is TSchema => value !== null);
    if (literals.length === schema.enum.length) {
      const union = literals.length === 1 ? literals[0] : Type.Union(literals, options);
      return withNullable(union, schema.nullable);
    }
  }

  if (Array.isArray(schema.type)) {
    const variants = schema.type.map((type) => nestedTypebox({ ...schema, type, nullable: false }));
    return variants.length === 1 ? variants[0] : Type.Union(variants, options);
  }

  if (schema.type === "object" || schema.properties) return objectSchema(schema);

  const choice = schema.anyOf ?? schema.oneOf;
  if (Array.isArray(choice) && choice.length > 0) {
    const variants = choice.map(nestedTypebox);
    return withNullable(variants.length === 1 ? variants[0] : Type.Union(variants, options), schema.nullable);
  }
  if (Array.isArray(schema.allOf) && schema.allOf.length > 0) {
    const variants = schema.allOf.map(nestedTypebox);
    return withNullable(variants.length === 1 ? variants[0] : Type.Intersect(variants, options), schema.nullable);
  }

  switch (schema.type) {
    case "string":
      return withNullable(Type.String(options), schema.nullable);
    case "number":
      return withNullable(Type.Number(options), schema.nullable);
    case "integer":
      return withNullable(Type.Integer(options), schema.nullable);
    case "boolean":
      return withNullable(Type.Boolean(options), schema.nullable);
    case "null":
      return Type.Null();
    case "array": {
      const tupleItems = schema.prefixItems ?? (Array.isArray(schema.items) ? schema.items : undefined);
      const value = tupleItems
        ? Type.Tuple(tupleItems.map(nestedTypebox), options)
        : Type.Array(schema.items ? nestedTypebox(schema.items) : Type.Any(), options);
      return withNullable(value, schema.nullable);
    }
    default:
      return Type.Any();
  }
}

/** Best-effort JSON Schema → TypeBox. MCP tool parameters must always expose
 * an object at the root; Pi/provider tool serialization rejects a root schema
 * without `type: "object"`. Nested schemas retain unions, nullability and
 * constraints instead of being incorrectly rewritten as objects. */
export function toTypebox(schema: unknown): TSchema {
  return objectSchema(isSchemaObject(schema) ? schema : {}, true);
}

/** pi tool names are lowercase snake identifiers; MCP tool names are not
 * (GMAIL_SEND_EMAIL, browser_navigate, mcp__x…). Normalize and prefix
 * with the server so two servers can never collide. */
function sanitizeToolName(server: string, tool: string): string {
  const raw = `${server}_${tool}`.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
  return raw.slice(0, TOOL_NAME_MAX_LENGTH) || "mcp_tool";
}

export function allocateToolName(server: string, tool: string, used: Set<string>): string {
  const base = sanitizeToolName(server, tool);
  let candidate = base;
  for (let suffixNumber = 2; used.has(candidate); suffixNumber += 1) {
    const suffix = `_${suffixNumber}`;
    candidate = `${base.slice(0, Math.max(1, TOOL_NAME_MAX_LENGTH - suffix.length))}${suffix}`;
  }
  return candidate;
}

export function truncateToolText(text: string): string {
  const lines = text.split("\n");
  const lineLimited = lines.slice(0, TOOL_OUTPUT_MAX_LINES).join("\n");
  const bytes = Buffer.from(lineLimited, "utf8");
  let byteEnd = Math.min(bytes.length, TOOL_OUTPUT_MAX_BYTES);
  // Avoid returning a replacement character when the byte limit lands in the
  // middle of a UTF-8 code point.
  while (byteEnd > 0 && byteEnd < bytes.length && (bytes[byteEnd] & 0xc0) === 0x80) byteEnd -= 1;
  const content = bytes.subarray(0, byteEnd).toString("utf8");
  const truncatedByLines = lines.length > TOOL_OUTPUT_MAX_LINES;
  const truncatedByBytes = bytes.length > TOOL_OUTPUT_MAX_BYTES;
  if (!truncatedByLines && !truncatedByBytes) return content;
  const reasons = [
    ...(truncatedByLines ? [`${TOOL_OUTPUT_MAX_LINES}-line limit`] : []),
    ...(truncatedByBytes ? [`${TOOL_OUTPUT_MAX_BYTES / 1024}KB limit`] : []),
  ];
  return `${content}\n\n[MCP output truncated: ${reasons.join(" and ")}. Refine the request for less output.]`;
}

/** A short human-readable line for the permission card's detail. */
function summarizeParams(params: unknown): string {
  try {
    const s = JSON.stringify(params ?? {});
    return s === "{}" ? "" : s.slice(0, 300);
  } catch {
    return "";
  }
}

export default async function (pi: PiExtensionApi): Promise<void> {
  const configPath = process.env.SAGAX_MCP_CONFIG;
  if (!configPath) return;

  let config: McpConfig;
  try {
    config = JSON.parse(readFileSync(configPath, "utf8")) as McpConfig;
  } catch {
    throw new Error("Sagax Pi MCP configuration could not be read");
  }
  if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error("Sagax Pi MCP configuration is invalid");
  const parsed = parseToolScope(config.toolScope);
  if (!parsed.ok) throw new Error(parsed.error);
  const scope = parsed.scope;
  if (scope !== undefined && (typeof pi.getActiveTools !== "function" || typeof pi.setActiveTools !== "function")) throw new Error("Pi tool selection enforcement APIs are unavailable");

  if (config.splitStable === true) {
    let warmWritten = false;
    pi.on("before_provider_request", (event) => {
      const payload = event?.payload as { messages?: unknown[] } | undefined;
      if (!payload || !Array.isArray(payload.messages)) return undefined;
      const split = splitStableMessages(payload.messages);
      if (!split) return undefined;
      if (config.warmPath && !warmWritten) {
        warmWritten = true;
        const { stream: _stream, stream_options: _options, max_completion_tokens: _max, ...rest } = payload as Record<string, unknown>;
        try { writeFileSync(config.warmPath, JSON.stringify({ ...rest, messages: split.stable, max_tokens: 1, stream: false }), { mode: 0o600 }); } catch { /* no warm then */ }
      }
      return { ...payload, messages: split.messages };
    });
  }
  if (config.warm && typeof config.warm === "object") {
    const warm = config.warm;
    // a standby resumes its session (switch_session): its turn is next, its
    // session idle, so the warm costs no turn anything
    pi.on("session_start", (event, context) => {
      if (event?.reason !== "resume") return;
      // pi may load this extension twice for one session: one warm is enough
      if (config.warmPath) {
        try { writeFileSync(`${config.warmPath}.sent`, "", { flag: "wx", mode: 0o600 }); } catch { return; }
      }
      void sendWarm(warm, context as WarmContext).catch(() => { /* a cold cache only costs time */ });
    });
  }

  if (config.stableCwd === true) {
    pi.on("before_agent_start", (event) => {
      const message = stableCwdTurn(event?.systemPromptOptions ?? {});
      return message ? { message } : undefined;
    });
  }

  const used = new Set<string>();
  const identities = new Map<string, ToolIdentity>();
  /** Registered directory tools and their server. The proxy narrowed their
   * catalog to the selection; call_tool's target is checked when it runs. */
  const directoryTools = new Map<string, string>();
  let enforcementFailed = false;
  const clients: StdioMcp[] = [];
  const turnCatalogs: Array<() => Promise<void>> = [];
  let intersectTools: (() => unknown) | undefined;
  const serverEntries = Object.entries(config.mcpServers ?? {}).filter(([name]) => scope === undefined || canUseMcpServer(scope, name));

  if (scope !== undefined) {
    const allowed = (name: string) => directoryTools.has(name)
      ? canUseMcpServer(scope, directoryTools.get(name)!)
      : allowsTool(scope, identities.get(name) ?? { kind: "native", name });
    const intersect = () => {
      if (enforcementFailed) throw new Error("Pi tool selection enforcement is unavailable");
      try {
        const active = pi.getActiveTools!();
        if (!Array.isArray(active) || active.some((name) => typeof name !== "string")) throw new Error("Pi tool selection enforcement returned an invalid catalog");
        const requested = new Set(active.filter(allowed));
        pi.setActiveTools!([...requested]);
        const selected = pi.getActiveTools!();
        if (!Array.isArray(selected) || selected.some((name) => !requested.has(name))) throw new Error("Pi tool selection enforcement did not apply the active-tool restriction");
        if (config.scopeReadyPath) writeFileSync(config.scopeReadyPath, JSON.stringify({ ok: true, toolScope: scope }), { mode: 0o600 });
        return selected;
      } catch (error) {
        enforcementFailed = true;
        if (config.scopeReadyPath) {
          try { writeFileSync(config.scopeReadyPath, JSON.stringify({ ok: false }), { mode: 0o600 }); } catch { /* A failed receipt cannot grant access. */ }
        }
        throw error;
      }
    };
    intersectTools = intersect;
    for (const event of ["session_start", "session_switch", "model_select", "before_agent_start", "context"]) pi.on(event, () => { intersect(); });
    pi.on("tool_call", (event) => !enforcementFailed && typeof event?.toolName === "string" && allowed(event.toolName) ? undefined : { block: true, reason: "Tool selection excludes this tool" });
    // Providers serialize tools before this hook. Filter that final payload as
    // well, so late package activation cannot restore withheld declarations.
    pi.on("before_provider_request", (event, context) => {
      let selected = new Set<string>();
      try { selected = new Set(intersect()); } catch {
        // Pi catches hook errors. Keep the returned payload empty even when
        // abort is unavailable, and block every subsequent execution.
        try { context?.abort?.(); } catch { /* The deny-all payload still applies. */ }
      }
      const declared = (name: string) => selected.has(name) && allowed(name);
      const payload = event?.payload;
      if (!payload || typeof payload !== "object") return payload;
      const body = payload as { tools?: unknown[] };
      if (Array.isArray(body.tools)) body.tools = body.tools.flatMap((value) => {
        if (!value || typeof value !== "object") return [];
        const tool = value as { name?: string; function?: { name?: string }; functionDeclarations?: Array<{ name?: string }> };
        if (Array.isArray(tool.functionDeclarations)) {
          const functionDeclarations = tool.functionDeclarations.filter((declaration) => typeof declaration.name === "string" && declared(declaration.name));
          return functionDeclarations.length ? [{ ...tool, functionDeclarations }] : [];
        }
        const name = tool.function?.name ?? tool.name;
        return typeof name === "string" && declared(name) ? [tool] : [];
      });
      return payload;
    });
  }

  // Mount independent servers concurrently so one slow integration cannot
  // consume the startup timeout once per server. Registration remains in
  // config order below for deterministic tool names and collision suffixes.
  const mounts = await Promise.all(
    serverEntries.map(async ([serverName, def]): Promise<{ serverName: string; def?: McpServerDef; client?: StdioMcp; tools?: McpTool[] }> => {
      if (!def || typeof def.command !== "string" || !def.command.trim()) return { serverName };
      let client: StdioMcp | undefined;
      try {
        client = new StdioMcp(def);
        await client.init();
        return { serverName, def, client, tools: await client.listTools() };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        client?.dispose();
        const cached = config.toolCache?.[serverName];
        if (Array.isArray(cached) && cached.length) return { serverName, def, tools: cached };
        process.stderr.write(`[openmausbot-pi-mcp] ${serverName}: ${message}\n`);
        return { serverName };
      }
    }),
  );
  if (config.toolCachePath) {
    const listed = Object.fromEntries(mounts.flatMap((mount) => mount.tools ? [[mount.serverName, mount.tools]] : []));
    try { writeFileSync(config.toolCachePath, JSON.stringify(listed), { mode: 0o600 }); } catch { /* the next pi lists its own */ }
  }

  for (const mount of mounts) {
    if (!mount.def || !mount.tools) continue;
    const { serverName, def, tools } = mount;
    // A server declared from the previous pi's list connects at its first call.
    let client = mount.client;
    let connecting: Promise<StdioMcp> | undefined;
    const connected = (): Promise<StdioMcp> => {
      if (client) return Promise.resolve(client);
      connecting ??= (async () => {
        const fresh = new StdioMcp(def);
        try { await fresh.init(); } catch (err) { fresh.dispose(); connecting = undefined; throw err; }
        client = fresh;
        clients.push(fresh);
        return fresh;
      })();
      return connecting;
    };
    // "approval": Sagax's own Browser and Data (pi.ts buildMcpServers), which
    // ask like a custom server so Sagax's approval path decides. The
    // person's own computer asks too, except under Full access, which she
    // chose for her own environment.
    const gated = (def.scope === "local-computer" || def.scope === "custom" || def.scope === "approval") && config.approvalMode !== "full";
    let registered = 0;
    const allocated = new Map<string, string>();
    const signatures = new Map<string, string>();
    let advertised = new Set<string>();
    let listedVersion = client?.toolsVersion() ?? 0;
    let refreshing: Promise<void> | undefined;
    const refreshCatalog = (force = false): Promise<void> => {
      if (!force && client?.toolsVersion() === listedVersion) return Promise.resolve();
      refreshing ??= (async () => {
        const live = await connected();
        const version = live.toolsVersion();
        const next = await live.listTools();
        registerTools(next, true);
        listedVersion = version;
      })().finally(() => { refreshing = undefined; });
      return refreshing;
    };
    const registerTools = (catalog: McpTool[], activate = false): void => {
      const previous = advertised;
      advertised = new Set<string>();
      for (const tool of catalog) {
        if (!tool || typeof tool.name !== "string" || !tool.name.trim()) {
          process.stderr.write(`[openmausbot-pi-mcp] ${serverName}: skipped a tool with no valid name\n`);
          continue;
        }
        const toolName = tool.name;
        const identity: ToolIdentity = { kind: "mcp", server: serverName, name: toolName };
        const directoryTool = (def.directory === true || def.searched === true) && isDirectoryTool(toolName);
        if (scope !== undefined && !directoryTool && !allowsTool(scope, identity)) continue;
        const name = allocated.get(toolName) ?? allocateToolName(serverName, toolName, used);
        try {
          const parameters = toTypebox(tool.inputSchema);
          const definition: PiToolDefinition = {
            name,
            label: `${serverName}:${toolName}`,
            description: typeof tool.description === "string" ? tool.description : `${toolName} (MCP tool from ${serverName})`,
            parameters,
            async execute(_toolCallId, params, signal, _onUpdate, ctx) {
              // The upstream tool this call runs: call_tool's target on a
              // searched server, nothing for its catalog reads.
              const target = directoryTool ? directoryCallTarget(toolName, params) : toolName;
              if (scope !== undefined && (enforcementFailed
                || (target !== undefined && !allowsTool(scope, { kind: "mcp", server: serverName, name: target })))) {
                throw new Error("Tool selection excludes this tool");
              }
              // Host tools ask first, using pi's native permission card
              // (ctx.ui.confirm → extension_ui_request → Allow/Deny card). This
              // mirrors ACP's session/request_permission and Codex's elicitation.
              // Searching a catalog runs no tool, so it asks nothing.
              if (gated && target !== undefined) {
                const shown = target;
                const detail = summarizeParams(directoryTool && toolName === CALL_TOOL ? (params as { arguments?: unknown } | undefined)?.arguments : params);
                const allowed = await ctx.ui.confirm(
                  def.scope === "local-computer" ? `Allow ${shown} on your computer?` : `Allow ${serverName}:${shown}?`,
                  detail || `Run ${serverName}:${shown}`,
                );
                if (!allowed) {
                  return { content: [{ type: "text", text: "Blocked by the user." }], details: {} };
                }
              }
              const res = await (await connected()).callTool(toolName, params, signal);
              // A role switch changes the remote surface before its answer.
              // Register that surface before Pi builds the next model request.
              try { await refreshCatalog(); } catch {
                // Discovery failing after a completed operation must not turn
                // its success into an apparent failure that invites a repeat.
                res.content.push({ type: "text", text: "Tool discovery could not refresh after this call. Its result still applies; do not repeat the operation just to refresh tools." });
              }
              if (res.isError) {
                const message = res.content
                  .filter((item): item is { type: "text"; text: string } => item.type === "text")
                  .map((item) => item.text)
                  .join("\n");
                // Pi marks a custom tool as failed only when execute throws;
                // returning error-looking text incorrectly produces isError=false.
                throw new Error(message || `MCP tool ${serverName}:${toolName} returned an error`);
              }
              return { content: res.content, details: {} };
            },
          };
          const signature = JSON.stringify([tool.description, tool.inputSchema]);
          if (signatures.get(toolName) !== signature) {
            pi.registerTool(definition);
            signatures.set(toolName, signature);
          }
          used.add(name);
          allocated.set(toolName, name);
          advertised.add(name);
          identities.set(name, identity);
          if (directoryTool) directoryTools.set(name, serverName);
          registered += 1;
        } catch (err) {
          // One malformed tool must not dispose the client behind tools that
          // were already registered from the same server.
          const message = err instanceof Error ? err.message : String(err);
          process.stderr.write(`[openmausbot-pi-mcp] ${serverName}:${toolName}: ${message}\n`);
        }
      }
      if (activate && pi.getActiveTools && pi.setActiveTools) {
        const active = pi.getActiveTools().filter((name) => !previous.has(name) || advertised.has(name));
        pi.setActiveTools([...new Set([...active, ...advertised])]);
      }
    };
    registerTools(tools);
    // The main connection starts each generation under the person's default
    // roles, even when Pi keeps its process and tool declarations warm.
    if (serverName === "perspicax") turnCatalogs.push(() => refreshCatalog(true));

    if (mount.client) {
      if (registered > 0) clients.push(mount.client);
      else mount.client.dispose();
    }
  }

  if (turnCatalogs.length) pi.on("before_agent_start", async () => {
    await Promise.all(turnCatalogs.map((refresh) => refresh()));
    intersectTools?.();
  });

  pi.on("session_shutdown", () => {
    for (const c of clients) c.dispose();
    clients.length = 0;
  });
}
