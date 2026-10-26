import { z } from "zod";

import type { McpServerSpec, RemoteMcpSpec, StdioMcpSpec } from "./contracts.ts";

/** One server as kept in config.json `mcpServers`. The shape is the block
 * Claude Code, Cursor and Claude Desktop write, so a pasted entry is a
 * stored entry: a command this machine runs, or a URL to connect to. */
export interface StoredStdioMcpServer extends StdioMcpSpec {
  enabled: boolean;
  /** Characters of one tool result allowed into a model's context; 0 = never
   * trim. Absent = the app default (SAGAX_MCP_RESULT_BUDGET, else 8,000). */
  resultBudget?: number;
  /** Tools of this server bots never see (the Plugins detail page's
   * switches). Absent or empty: every tool. */
  disabledTools?: string[];
  /** The marketplace it was added from (Plugins); absent: added by hand. */
  source?: string;
}
/** An app registered in advance with the server's authorization server,
 * for servers that do not let apps register themselves. The secret is a
 * credential like a header value: kept in config.json, never listed. */
export interface McpOAuthClientConfig {
  clientId: string;
  clientSecret?: string;
  scopes?: string[];
}
export interface StoredRemoteMcpServer extends RemoteMcpSpec {
  enabled: boolean;
  oauth?: McpOAuthClientConfig;
  /** as on StoredStdioMcpServer */
  resultBudget?: number;
  disabledTools?: string[];
  source?: string;
}
export type StoredMcpServer = StoredStdioMcpServer | StoredRemoteMcpServer;

/** What the renderer sees: names of secrets, never their values. */
export interface StdioMcpServerListing {
  name: string;
  command: string;
  args: string[];
  envKeys: string[];
  enabled: boolean;
  resultBudget?: number;
  disabledTools?: string[];
  source?: string;
}
export interface RemoteMcpServerListing {
  name: string;
  type: "http" | "sse";
  url: string;
  headerKeys: string[];
  enabled: boolean;
  resultBudget?: number;
  /** present when a pre-registered sign-in app is set */
  oauth?: { clientId: string; scopes: string[]; clientSecretConfigured: boolean };
  disabledTools?: string[];
  source?: string;
}
export type McpServerListing = StdioMcpServerListing | RemoteMcpServerListing;

/** The two kinds tell apart by shape, as they do on disk and in every
 * client's config: a remote server has a `url`, a local one a `command`. */
export function isRemoteMcpServer(server: McpServerSpec): server is RemoteMcpSpec {
  return "url" in server;
}

export const MAX_MCP_SERVERS = 20;
const MAX_ARGS = 64;
const MAX_ENV = 64;
const MAX_HEADERS = 32;
/** The largest per-server result budget: 2,000,000 characters is ~500k
 * tokens, more than any model's context, so anything above it means "never". */
export const MAX_RESULT_BUDGET = 2_000_000;

const resultBudgetSchema = z.number({ message: "The result size limit must be a whole number of characters." })
  .int("The result size limit must be a whole number of characters.")
  .min(0, "The result size limit cannot be negative.")
  .max(MAX_RESULT_BUDGET, `The result size limit can be at most ${MAX_RESULT_BUDGET.toLocaleString("en-US")} characters; use 0 for no limit.`);
/** One tool selector per disabled tool must fit a tool scope (256). */
export const MAX_DISABLED_TOOLS = 256;
// eslint-disable-next-line no-control-regex
const TOOL_NAME = /^[^*\x00-\x1f\x7f]{1,256}$/;
const disabledToolsSchema = z.array(z.string().regex(TOOL_NAME, "A tool name is one line of text without *."))
  .max(MAX_DISABLED_TOOLS, `Disable at most ${MAX_DISABLED_TOOLS} tools per server.`);

const sourceSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/, "A source is a marketplace name.");

/** The marketplace a server came from: a new one, else the saved one. */
function sourceFor(incoming: string | undefined, existing?: StoredMcpServer): { source?: string } {
  const source = incoming ?? existing?.source;
  return source ? { source } : {};
}

/** The disabled tool list to store: a new one, else the saved one. */
function disabledToolsFor(incoming: string[] | undefined, existing?: StoredMcpServer): { disabledTools?: string[] } {
  const list = [...new Set(incoming ?? existing?.disabledTools ?? [])].sort();
  return list.length ? { disabledTools: list } : {};
}
const MCP_NAME = /^[a-z][a-z0-9_-]{0,31}$/;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** An HTTP header field name: RFC 9110 token characters. */
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/;

/** Names used to route Sagax's built-in MCP proxies and their ephemeral
 * capabilities. Codex exposes MCP env names through one app-server process;
 * a custom server must never request one of these names or it could redirect
 * a built-in proxy or receive that proxy's bearer. */
export function isHarnessOwnedMcpEnvName(name: string): boolean {
  return name === "ELECTRON_RUN_AS_NODE" || name.startsWith("SAGAX_") || name.startsWith("OGB_");
}

/** Port de OpenMausBot #2865 : a server bundled inside an Electron app (its
 * binary as the command) needs ELECTRON_RUN_AS_NODE=1 to run as node. That
 * value is the one the built-in proxies use, so it is accepted; any other
 * value would overwrite what they need. The other harness names stay
 * reserved whatever their value. */
export function isReservedMcpEnvEntry(name: string, value: string): boolean {
  if (name === "ELECTRON_RUN_AS_NODE") return value !== "1";
  return isHarnessOwnedMcpEnvName(name);
}

function environmentEntryError(name: string, value: string): string | null {
  if (!ENV_NAME.test(name)) return `Environment variable “${name}” is not valid.`;
  if (isReservedMcpEnvEntry(name, value)) {
    return name === "ELECTRON_RUN_AS_NODE"
      ? `Environment variable “${name}” is reserved by Sagax; a custom server may set it to “1” only.`
      : `Environment variable “${name}” is reserved by Sagax.`;
  }
  return null;
}

function headerError(name: string, value: string): string | null {
  if (!HEADER_NAME.test(name)) return `Header “${name}” is not a valid header name.`;
  if (/[\r\n]/.test(value)) return `Header “${name}” must be a single line.`;
  return null;
}

/** A remote server's address: a full http(s) URL. Credentials belong in a
 * header, where the app keeps them write-only, not in the address the
 * listing shows. */
function urlError(value: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return "Use a full address, like https://example.com/mcp.";
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return "The address must start with http:// or https://.";
  if (parsed.username || parsed.password) return "Put credentials in a header, not in the address.";
  return null;
}

const RESERVED_MCP_NAMES = new Set([
  "ogb",
  "computer",
  "agents",
  "data",
  "browser",
  "phone",
  "dweb",
  "openmausbot_connectors",
  "openmausbot_phone",
  // 2026-10-16 security review: the person's own environment servers Sagax
  // mounts itself (user-sandbox-routing.ts USER_SANDBOX_MCP_NAME,
  // shared/bot-workplace.ts DESKTOP_BRIDGE_MCP_NAME). Their tools may run
  // without a card in the bot owner's environment (member-environment.ts),
  // so no person's server may take these names.
  "sagax-environment",
  "sagax-desktop",
  // 2026-10-17 (leftovers of #690): a server named `mcp` spells its tool
  // `data__data_sql` as `mcp__data__data_sql` on a chat engine, the name of
  // the built-in Data tool on Claude (sagax-internal-tools.ts).
  "mcp",
]);

/** Name families Sagax mounts itself or reads as a separator: Sagax's own
 * servers (`sagax-computer`, `sagax-flow`...), Perspicax profiles
 * (`perspicax_<slug>`, owner-scoped: index.ts ownerScopedMcpServerFor),
 * claude.ai connectors (`claude_ai_<Service>`) and the legacy app's servers.
 * A double underscore is the separator of `<server>__<tool>` and is refused
 * anywhere in a name. */
const RESERVED_MCP_PREFIX = /^(?:sagax[-_]|perspicax[-_]|claude[-_]ai[-_]|openmausbot[-_])/;

const stdioEntrySchema = z.object({
  command: z.string().trim().min(1).max(1_024),
  args: z.array(z.string().max(4_096)).max(MAX_ARGS).optional(),
  env: z.record(z.string(), z.string().max(16_384)).optional(),
  enabled: z.boolean().optional(),
  resultBudget: resultBudgetSchema.optional(),
  disabledTools: disabledToolsSchema.optional(),
  source: sourceSchema.optional(),
}).strict();

const stdioMutationSchema = stdioEntrySchema.extend({
  env: z.record(z.string(), z.union([z.string().max(16_384), z.literal(true)])).optional(),
});

/** RFC 6749 §A: a client id is visible ASCII; a scope is one token without
 * spaces, quotes or backslashes. */
const CLIENT_ID = /^[\x20-\x7e]+$/;
const SCOPE = /^[\x21\x23-\x5b\x5d-\x7e]+$/;
const CLIENT_SECRET_MAX = 4_096;

const oauthClientSchema = z.object({
  clientId: z.string().trim().min(1, "Enter the client ID of the app registered with this server's sign-in provider.").max(512)
    .regex(CLIENT_ID, "A client ID is printable text on one line."),
  clientSecret: z.string().min(1).max(CLIENT_SECRET_MAX).regex(CLIENT_ID, "A client secret is printable text on one line.").optional(),
  scopes: z.array(z.string().max(256).regex(SCOPE, "Scopes are single words, like offline_access or api://my-app/mcp.read.")).max(32).optional(),
}).strict();

const remoteEntrySchema = z.object({
  /** Streamable HTTP unless the entry says the older SSE transport. */
  type: z.enum(["http", "sse"]).optional(),
  url: z.string().trim().min(1).max(2_048),
  headers: z.record(z.string(), z.string().max(16_384)).optional(),
  oauth: oauthClientSchema.optional(),
  enabled: z.boolean().optional(),
  resultBudget: resultBudgetSchema.optional(),
  disabledTools: disabledToolsSchema.optional(),
  source: sourceSchema.optional(),
}).strict();

const remoteMutationSchema = remoteEntrySchema.extend({
  headers: z.record(z.string(), z.union([z.string().max(16_384), z.literal(true)])).optional(),
  oauth: oauthClientSchema.extend({
    clientSecret: z.union([z.string().min(1).max(CLIENT_SECRET_MAX).regex(CLIENT_ID, "A client secret is printable text on one line."), z.literal(true)]).optional(),
  }).optional(),
});

/** The sign-in app for a mutation: a `true` secret keeps the saved one, but
 * only for the same client ID — a secret never moves to another app. */
function resolveOAuthClient(
  incoming: z.infer<typeof remoteMutationSchema>["oauth"],
  saved: McpOAuthClientConfig | undefined,
): { ok: true; value: McpOAuthClientConfig | undefined } | { ok: false; error: string } {
  if (!incoming) return { ok: true, value: undefined };
  let clientSecret: string | undefined;
  if (incoming.clientSecret === true) {
    if (!saved?.clientSecret || saved.clientId !== incoming.clientId) {
      return { ok: false, error: "No client secret is saved for this client ID. Enter it again, or leave it out for an app without one." };
    }
    clientSecret = saved.clientSecret;
  } else {
    clientSecret = incoming.clientSecret;
  }
  const scopes = [...new Set(incoming.scopes ?? [])];
  return {
    ok: true,
    value: { clientId: incoming.clientId, ...(clientSecret ? { clientSecret } : {}), ...(scopes.length ? { scopes } : {}) },
  };
}

/** Which shape an entry means to be. `url` decides, as it does for every
 * client that reads these blocks; a `type` of http/sse without a url is
 * still a remote entry, so its error talks about the address. */
function looksRemote(raw: unknown): boolean {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const record = raw as Record<string, unknown>;
  return "url" in record || record.type === "http" || record.type === "sse";
}

export function mcpServerNameError(name: string): string | null {
  if (!MCP_NAME.test(name)) {
    return "Use 1–32 lowercase letters, numbers, underscores, or hyphens, starting with a letter.";
  }
  if (RESERVED_MCP_NAMES.has(name) || RESERVED_MCP_PREFIX.test(name) || name.includes("__")) return "That name is reserved by Sagax.";
  return null;
}

/** A well-formed name Sagax reserves (2026-10-17, #695): a server saved
 * under it by an older build is never mounted. */
export function reservedMcpServerName(name: string): boolean {
  return MCP_NAME.test(name) && (RESERVED_MCP_NAMES.has(name) || RESERVED_MCP_PREFIX.test(name) || name.includes("__"));
}

/** A free, allowed name close to a reserved one: the reserved family
 * dropped, `__` folded, then `-server` or a number added. */
export function suggestMcpServerName(name: string, taken: ReadonlySet<string> | readonly string[]): string | undefined {
  const used = new Set(taken);
  const trim = (value: string) => value.slice(0, 32).replace(/[-_]+$/, "");
  let base = name.replace(RESERVED_MCP_PREFIX, "").replace(/_{2,}/g, "_").replace(/^[^a-z]+/, "");
  base = trim(base) || "server";
  const candidates = [base, `${trim(base.slice(0, 25))}-server`];
  for (let index = 2; index < 100; index++) candidates.push(`${trim(base.slice(0, 28))}-${index}`);
  return candidates.find((candidate) => mcpServerNameError(candidate) === null && !used.has(candidate));
}

/** What the MCP settings show about a stored server whose name is now
 * reserved: it is not mounted until it is renamed (or removed). */
export interface ReservedMcpServerListing {
  name: string;
  suggestedName?: string;
}

/** The stored servers whose name is reserved, with a free name to offer. */
export function reservedMcpServers(raw: Record<string, unknown> | undefined): ReservedMcpServerListing[] {
  const names = Object.keys(raw ?? {});
  return names.filter(reservedMcpServerName).map((name) => {
    const suggestedName = suggestMcpServerName(name, names);
    return { name, ...(suggestedName ? { suggestedName } : {}) };
  });
}

/** The log line for a stored server skipped because its name is reserved. */
export function reservedMcpServerLog(name: string): string {
  return `MCP server ${JSON.stringify(name)} is not mounted: its name is reserved by Sagax. Rename or remove it in Settings > Plugins > MCP servers.`;
}

export type McpServerRename =
  | { ok: true; next: Record<string, unknown>; server: StoredMcpServer }
  | { ok: false; status: number; error: string };

/** Move a stored server whose name is reserved to an allowed name. Only a
 * reserved name may move here; the entry is re-read under its new name and
 * saved off, so it never runs again without the person turning it on. */
export function renameReservedMcpServer(current: Record<string, unknown>, from: string, to: unknown): McpServerRename {
  if (!Object.hasOwn(current, from)) return { ok: false, status: 404, error: "MCP server not found." };
  if (!reservedMcpServerName(from)) return { ok: false, status: 400, error: "Only a server whose name is reserved can be renamed here." };
  if (typeof to !== "string") return { ok: false, status: 400, error: "Send the new name as { \"to\": \"name\" }." };
  const nameError = mcpServerNameError(to);
  if (nameError) return { ok: false, status: 400, error: nameError };
  if (Object.hasOwn(current, to)) return { ok: false, status: 409, error: "An MCP server with that name already exists." };
  const parsed = parseStoredMcpServer(to, current[from]);
  if (!parsed.ok) return { ok: false, status: 400, error: parsed.error };
  const server: StoredMcpServer = { ...parsed.server, enabled: false };
  const next: Record<string, unknown> = {};
  // keep the list's order: the renamed entry takes the old one's place
  for (const [name, value] of Object.entries(current)) {
    if (name === from) next[to] = server;
    else next[name] = value;
  }
  return { ok: true, next, server };
}

type Parsed = { ok: true; server: StoredMcpServer } | { ok: false; error: string };

/** Resolve a `true` placeholder ("keep the saved value") against what is
 * stored, or refuse it: a placeholder for a value that was never saved
 * would silently store the literal `true`. */
function resolveSecrets(
  incoming: Record<string, string | true>,
  saved: Record<string, string> | undefined,
): { ok: true; values: Record<string, string> } | { ok: false; error: string } {
  const values: Record<string, string> = {};
  for (const [key, value] of Object.entries(incoming)) {
    if (value === true) {
      const kept = saved?.[key];
      if (kept === undefined) return { ok: false, error: `No saved value exists for ${key}.` };
      values[key] = kept;
    } else {
      values[key] = value;
    }
  }
  return { ok: true, values };
}

function parseStdio(raw: unknown, mutation: boolean, existing?: StoredMcpServer): Parsed {
  const parsed = (mutation ? stdioMutationSchema : stdioEntrySchema).safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid MCP server." };
  }
  const incoming = parsed.data.env ?? {};
  const invalidName = Object.keys(incoming).find((name) => !ENV_NAME.test(name));
  if (invalidName !== undefined) return { ok: false, error: `Environment variable “${invalidName}” is not valid.` };
  if (Object.keys(incoming).length > MAX_ENV) {
    return { ok: false, error: `Use at most ${MAX_ENV} environment variables.` };
  }
  const env = resolveSecrets(incoming, existing && !isRemoteMcpServer(existing) ? existing.env : undefined);
  if (!env.ok) return env;
  // Judged after resolving, so a kept write-only value counts as what would run.
  const invalidEnv = Object.entries(env.values).map(([name, value]) => environmentEntryError(name, value)).find((error) => error !== null);
  if (invalidEnv) return { ok: false, error: invalidEnv };
  return {
    ok: true,
    server: {
      command: parsed.data.command,
      args: parsed.data.args ?? [],
      env: env.values,
      enabled: enabledFor(parsed.data.enabled, mutation, existing),
      ...(parsed.data.resultBudget !== undefined ? { resultBudget: parsed.data.resultBudget } : {}),
      ...disabledToolsFor(parsed.data.disabledTools, existing),
      ...sourceFor(parsed.data.source, existing),
    },
  };
}

function parseRemote(raw: unknown, mutation: boolean, existing?: StoredMcpServer): Parsed {
  const parsed = (mutation ? remoteMutationSchema : remoteEntrySchema).safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid MCP server." };
  }
  const badUrl = urlError(parsed.data.url);
  if (badUrl) return { ok: false, error: badUrl };
  const incoming = parsed.data.headers ?? {};
  if (Object.keys(incoming).length > MAX_HEADERS) {
    return { ok: false, error: `Use at most ${MAX_HEADERS} headers.` };
  }
  const headers = resolveSecrets(incoming, existing && isRemoteMcpServer(existing) ? existing.headers : undefined);
  if (!headers.ok) return headers;
  const invalidHeader = Object.entries(headers.values).map(([name, value]) => headerError(name, value)).find((error) => error !== null);
  if (invalidHeader) return { ok: false, error: invalidHeader };
  const oauth = resolveOAuthClient(parsed.data.oauth, existing && isRemoteMcpServer(existing) ? existing.oauth : undefined);
  if (!oauth.ok) return oauth;
  return {
    ok: true,
    server: {
      type: parsed.data.type ?? "http",
      url: parsed.data.url,
      headers: headers.values,
      ...(oauth.value ? { oauth: oauth.value } : {}),
      enabled: enabledFor(parsed.data.enabled, mutation, existing),
      ...(parsed.data.resultBudget !== undefined ? { resultBudget: parsed.data.resultBudget } : {}),
      ...disabledToolsFor(parsed.data.disabledTools, existing),
      ...sourceFor(parsed.data.source, existing),
    },
  };
}

/** File-authored entries are on unless they say otherwise. A newly added
 * server from the app is inert until explicitly enabled; an edit keeps the
 * current switch unless the mutation moves it. */
function enabledFor(value: boolean | undefined, mutation: boolean, existing?: StoredMcpServer): boolean {
  if (!mutation) return value !== false;
  return existing ? (value ?? existing.enabled) : false;
}

export function parseStoredMcpServer(name: string, raw: unknown): Parsed {
  const nameError = mcpServerNameError(name);
  if (nameError) return { ok: false, error: nameError };
  return looksRemote(raw) ? parseRemote(raw, false) : parseStdio(raw, false);
}

/** Parse a renderer mutation. `true` is a write-only placeholder meaning
 * “keep this already stored value”; it is never accepted for a new key. */
export function parseMcpServerMutation(
  name: string,
  raw: unknown,
  existing?: StoredMcpServer,
): Parsed {
  const nameError = mcpServerNameError(name);
  if (nameError) return { ok: false, error: nameError };
  return looksRemote(raw) ? parseRemote(raw, true, existing) : parseStdio(raw, true, existing);
}

/** The fields POST /api/mcp/servers keeps (`mcpServerBody` in server/index.ts),
 * minus `enabled`. A bot is not allowed to send that switch at all. */
// No resultBudget: a bot never lifts the trim on a server it adds; the person sets it in the editor.
const BOT_MCP_SERVER_KEYS = ["command", "args", "env", "type", "url", "headers", "oauth"] as const;

function pickMcpServerFields(record: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of BOT_MCP_SERVER_KEYS) if (record[key] !== undefined) out[key] = record[key];
  return out;
}

export type DisabledMcpServerAdd =
  | { ok: true; name: string; server: StoredMcpServer; next: Record<string, unknown> }
  | { ok: false; status: number; error: string };

const BOT_CANNOT_SWITCH = "A bot cannot change the on/off switch. The server is saved off, and only the user can turn it on in MCP server settings.";

/** File one new MCP server as a disabled row. Does not probe, does not
 * launch, and does not touch a server that is already stored. The caller
 * still applies organisation policy before writing the returned map. */
export function addDisabledMcpServer(current: Record<string, unknown>, body: unknown): DisabledMcpServerAdd {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, status: 400, error: "Expected an MCP server object with a name." };
  }
  const record = body as Record<string, unknown>;
  if (Object.hasOwn(record, "enabled")) return { ok: false, status: 400, error: BOT_CANNOT_SWITCH };
  const name = typeof record.name === "string" ? record.name : "";
  if (name && Object.hasOwn(current, name)) {
    return { ok: false, status: 409, error: "An MCP server with that name already exists." };
  }
  if (Object.keys(current).length >= MAX_MCP_SERVERS) {
    return { ok: false, status: 400, error: `You can add at most ${MAX_MCP_SERVERS} MCP servers.` };
  }
  const parsed = parseMcpServerMutation(name, pickMcpServerFields(record));
  if (!parsed.ok) return { ok: false, status: 400, error: parsed.error };
  if (parsed.server.enabled !== false) return { ok: false, status: 400, error: BOT_CANNOT_SWITCH };
  return { ok: true, name, server: parsed.server, next: { ...current, [name]: parsed.server } };
}

export function listMcpServers(raw: Record<string, unknown> | undefined): McpServerListing[] {
  return Object.entries(raw ?? {}).flatMap(([name, value]): McpServerListing[] => {
    const parsed = parseStoredMcpServer(name, value);
    if (!parsed.ok) return [];
    const { server } = parsed;
    if (isRemoteMcpServer(server)) {
      return [{
        name,
        type: server.type,
        url: server.url,
        headerKeys: Object.keys(server.headers).sort(),
        enabled: server.enabled,
        ...(server.resultBudget !== undefined ? { resultBudget: server.resultBudget } : {}),
        ...(server.oauth ? {
          oauth: { clientId: server.oauth.clientId, scopes: server.oauth.scopes ?? [], clientSecretConfigured: Boolean(server.oauth.clientSecret) },
        } : {}),
        ...(server.disabledTools?.length ? { disabledTools: server.disabledTools } : {}),
        ...(server.source ? { source: server.source } : {}),
      }];
    }
    return [{
      name,
      command: server.command,
      args: server.args,
      envKeys: Object.keys(server.env).sort(),
      enabled: server.enabled,
      ...(server.resultBudget !== undefined ? { resultBudget: server.resultBudget } : {}),
      ...(server.disabledTools?.length ? { disabledTools: server.disabledTools } : {}),
        ...(server.source ? { source: server.source } : {}),
    }];
  });
}

/** Only the keys a stored entry may carry, and only when the pasted block
 * set them: a strict schema must not see `command: undefined` on a remote
 * entry or `url: undefined` on a local one. */
function pickEntry(record: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of keys) if (record[key] !== undefined) out[key] = record[key];
  return out;
}

/**
 * Turn a pasted config block into servers this registry can store. Accepts
 * the {"mcpServers": {...}} shape Claude Code, Cursor and Claude Desktop
 * write, a bare {name: entry} map, or a single {name, command|url, ...} entry.
 * Names are slugged into the registry's format; every entry goes through the
 * same rules as the form and lands disabled until explicitly enabled.
 */
export function parseMcpServersImport(
  text: string,
): { ok: true; servers: Record<string, StoredMcpServer> } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: "That is not valid JSON." };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: 'Expected an object like {"mcpServers": {"name": {"command": "npx", "args": [...]}}}.' };
  }
  const root = parsed as Record<string, unknown>;
  let entries: Record<string, unknown>;
  if (root.mcpServers && typeof root.mcpServers === "object" && !Array.isArray(root.mcpServers)) {
    entries = root.mcpServers as Record<string, unknown>;
  } else if (typeof root.command === "string" || typeof root.url === "string") {
    const name = typeof root.name === "string" ? root.name : "";
    if (!name) return { ok: false, error: 'A single server needs a "name".' };
    const { name: _omit, ...rest } = root;
    entries = { [name]: rest };
  } else {
    entries = root;
  }
  const names = Object.keys(entries);
  if (names.length === 0) return { ok: false, error: "No servers found in that JSON." };
  if (names.length > MAX_MCP_SERVERS) {
    return { ok: false, error: `Import at most ${MAX_MCP_SERVERS} servers at once.` };
  }
  const servers: Record<string, StoredMcpServer> = {};
  for (const rawName of names) {
    const entry = entries[rawName];
    const name = slugMcpName(rawName);
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return { ok: false, error: `"${rawName}" is not a server entry.` };
    }
    const record = entry as Record<string, unknown>;
    if (Object.hasOwn(servers, name)) return { ok: false, error: `"${rawName}" appears twice.` };
    // The command is an executable path, not a shell line; spaces are valid
    // in paths on every supported platform. The probe reports missing files.
    // A remote entry keeps its transport and headers; `enabled` from the
    // paste is deliberately dropped so nothing runs before it was tested.
    const result = parseMcpServerMutation(name, looksRemote(record)
      ? pickEntry(record, ["type", "url", "headers", "resultBudget"])
      : pickEntry(record, ["command", "args", "env", "resultBudget"]));
    if (!result.ok) return { ok: false, error: `"${rawName}": ${result.error}` };
    servers[name] = result.server;
  }
  return { ok: true, servers };
}

function slugMcpName(raw: string): string {
  const slug = raw.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32);
  return /^[a-z]/.test(slug) ? slug : slug ? `mcp-${slug}`.slice(0, 32) : "";
}
