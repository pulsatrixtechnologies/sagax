// A person's own capabilities: plugins, library references, MCP servers and
// their GitHub account. One encrypted file per person
// (DATA_DIR/principals/<pid>/capabilities.enc, AES-256-GCM with the
// server's vault key, the one mcp-oauth.enc uses), never shared with another
// person, never listed with a secret (a token or an env value only reads as
// configured). OAuth sign-ins of their remote servers live in their own
// mcp-oauth.enc beside it (server/mcp-oauth.ts, one manager per person).
//
// Where a personal server runs: a remote one is reached by the engine like
// any remote MCP server; a local command runs in the person's server
// environment (server/sandbox-stdio-mcp.ts), never on the Sagax host.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { LookupAddress } from "node:dns";
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

import { writeFileAtomic } from "./atomic.ts";
import { capabilityPluginStateSchema, capabilityPluginValuesSchema, type CapabilityPluginState, type CapabilityPluginValues } from "./capability-plugin-state.ts";
import { isPublicDomainAddress } from "./custom-domain.ts";
import { isReservedMcpEnvEntry, mcpServerNameError } from "./mcp-registry.ts";
import type { VaultKeySource } from "./vault-key-source.ts";

export const MAX_PERSONAL_MCP_SERVERS = 20;
const AAD = Buffer.from("sagax person-capabilities v2");
const LEGACY_AAD = Buffer.from("sagax person-connections v1");
const FILE = "capabilities.enc";
const LEGACY_FILE = "connections.enc";
const PRINCIPAL_ID = /^[A-Za-z0-9_.:-]{1,120}$/;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/;

/** How a remote personal server proves who the person is. */
export const PERSONAL_MCP_AUTH = ["none", "token", "oauth", "github"] as const;
export type PersonalMcpAuth = (typeof PERSONAL_MCP_AUTH)[number];

const remoteSchema = z.object({
  kind: z.literal("remote"),
  type: z.enum(["http", "sse"]),
  url: z.string().min(1).max(2_048),
  auth: z.enum(PERSONAL_MCP_AUTH),
  /** The header a token goes in (auth "token"); Authorization by default. */
  headerName: z.string().regex(HEADER_NAME).optional(),
  /** The token (auth "token"): sent as `Bearer <token>` in Authorization,
   * as is in any other header. */
  token: z.string().min(1).max(16_384).optional(),
  enabled: z.boolean(),
  addedAt: z.number(),
}).strict();

const stdioSchema = z.object({
  kind: z.literal("stdio"),
  command: z.string().min(1).max(1_024),
  args: z.array(z.string().max(4_096)).max(64),
  env: z.record(z.string(), z.string().max(16_384)),
  /** Where the command runs: the person's server environment. */
  runsIn: z.literal("environment"),
  enabled: z.boolean(),
  addedAt: z.number(),
}).strict();

const serverSchema = z.discriminatedUnion("kind", [remoteSchema, stdioSchema]);

const githubSchema = z.object({
  token: z.string().min(1).max(4_096),
  login: z.string().min(1).max(100),
  name: z.string().max(200).optional(),
  scopes: z.array(z.string().max(100)).max(50).optional(),
  via: z.enum(["device", "token"]),
  connectedAt: z.number(),
}).strict();

const legacyDocumentSchema = z.object({
  version: z.literal(1),
  mcpServers: z.record(z.string(), serverSchema),
  github: githubSchema.optional(),
}).strict();

const documentSchema = z.object({
  version: z.literal(2),
  mcpServers: z.record(z.string(), serverSchema),
  github: githubSchema.optional(),
  plugins: capabilityPluginStateSchema,
  pluginValues: capabilityPluginValuesSchema,
  assignedSkills: z.array(z.string()),
  /** Capabilities lot 4: the organization's offered declarations this person
   * turned on (true) or off (false), by Perspicax declaration id. Absent:
   * none chosen (offered stays off). Imposed ones never read it. */
  orgCapabilities: z.record(z.string().max(128), z.boolean()).optional(),
}).strict();

export type PersonalRemoteMcpServer = z.infer<typeof remoteSchema>;
export type PersonalStdioMcpServer = z.infer<typeof stdioSchema>;
export type PersonalMcpServer = z.infer<typeof serverSchema>;
export type GithubConnection = z.infer<typeof githubSchema>;
export type PersonCapabilitiesDocument = z.infer<typeof documentSchema>;
const emptyDocument = (): PersonCapabilitiesDocument => ({ version: 2, mcpServers: {}, plugins: { version: 2, plugins: {} }, pluginValues: {}, assignedSkills: [] });

/** What the person's own screen sees: names of secrets, never values. */
export type PersonalMcpListing =
  | { name: string; kind: "remote"; type: "http" | "sse"; url: string; domain: string; auth: PersonalMcpAuth; headerName?: string; tokenConfigured: boolean; enabled: boolean; addedAt: number }
  | { name: string; kind: "stdio"; command: string; args: string[]; envKeys: string[]; runsIn: "environment"; enabled: boolean; addedAt: number };

export class PersonConnectionsError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(message: string, code: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/** The folder of one person's own files (engine logins live there too). */
export function principalDir(dataDir: string, principalId: string): string {
  if (!PRINCIPAL_ID.test(principalId) || principalId === "." || principalId === "..") throw new PersonConnectionsError("invalid person", "invalid_person");
  return join(dataDir, "principals", principalId);
}

/** A lab or a test only (SAGAX_PERSONAL_MCP_ALLOW_PRIVATE=1): a personal
 * server may then be http and on a private or loopback address. Never on a
 * shared server: the engine connects from the Sagax host, so a private
 * address would reach the host's own neighbours. */
export function personalMcpPrivateAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SAGAX_PERSONAL_MCP_ALLOW_PRIVATE === "1";
}

/** Why the engine must not connect to this address from the Sagax host
 * (a private, loopback, link-local or reserved destination), or null. */
export async function personalMcpHostRefusal(
  url: string,
  options: { allowPrivate?: boolean; lookup?: (hostname: string) => Promise<LookupAddress[]> } = {},
): Promise<string | null> {
  if (options.allowPrivate) return null;
  let hostname: string;
  try { hostname = new URL(url).hostname.replace(/^\[|\]$/g, ""); } catch { return "That address is not valid."; }
  let addresses: string[];
  if (isIP(hostname)) addresses = [hostname];
  else {
    try {
      addresses = (await (options.lookup ?? ((name) => dnsLookup(name, { all: true, verbatim: true })))(hostname)).map((entry) => entry.address);
    } catch {
      return `The name ${hostname} could not be resolved from the server.`;
    }
  }
  if (!addresses.length || addresses.some((address) => !isPublicDomainAddress(address))) {
    return "A personal MCP server must be on the public internet: this address is private to the server's network.";
  }
  return null;
}

function urlError(value: string, allowPrivate = false): string | null {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return "Use a full address, like https://example.com/mcp.";
  }
  if (parsed.protocol !== "https:" && !(allowPrivate && parsed.protocol === "http:")) return "A personal MCP server must use https://.";
  if (parsed.username || parsed.password) return "Put credentials in the token, not in the address.";
  return null;
}

/** A new personal server from the person's form. */
export const personalMcpInputSchema = z.union([
  z.object({
    name: z.string(),
    url: z.string().trim().min(1).max(2_048),
    type: z.enum(["http", "sse"]).optional(),
    auth: z.enum(PERSONAL_MCP_AUTH).optional(),
    headerName: z.string().trim().max(128).optional(),
    token: z.string().trim().max(16_384).optional(),
  }).strict(),
  z.object({
    name: z.string(),
    command: z.string().trim().min(1).max(1_024),
    args: z.array(z.string().max(4_096)).max(64).optional(),
    env: z.record(z.string(), z.string().max(16_384)).optional(),
    runsIn: z.literal("environment").optional(),
  }).strict(),
]);
export type PersonalMcpInput = z.infer<typeof personalMcpInputSchema>;

/** 2026-10-28: an add_mcp_server call (agents-catalog.ts) as the person's
 * own server (Settings > Connections), never the server's shared list. A
 * remote URL with no header, one header (its token), or OAuth with dynamic
 * sign-in; or a command, which runs in the person's own environment. Pure:
 * parsePersonalMcpInput still validates what this returns. A string says
 * why it cannot be one. */
export function personalMcpInputFromAgent(body: unknown): PersonalMcpInput | string {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "Send name with a url or a command.";
  const value = body as Record<string, unknown>;
  const name = typeof value.name === "string" ? value.name : "";
  if (typeof value.url === "string" && value.command === undefined) {
    const headers = value.headers && typeof value.headers === "object" && !Array.isArray(value.headers)
      ? Object.entries(value.headers as Record<string, unknown>) : [];
    if (headers.length > 1) return "Your own servers take one header (a token). Add this one in Settings > Connections, where you can name its header.";
    if (headers.some(([, header]) => typeof header !== "string")) return "Header values must be text.";
    const oauth = value.oauth && typeof value.oauth === "object" ? value.oauth as Record<string, unknown> : undefined;
    if (oauth && (oauth.clientId !== undefined || oauth.clientSecret !== undefined)) {
      return "Your own servers sign in without a pre-registered app. Add this one without oauth, then sign in from Settings > Connections.";
    }
    const type = value.type === "sse" ? "sse" as const : value.type === undefined || value.type === "http" ? "http" as const : null;
    if (!type) return "type is http or sse.";
    if (oauth) return { name, url: value.url, type, auth: "oauth" };
    const [header] = headers;
    return header
      ? { name, url: value.url, type, auth: "token", headerName: header[0], token: String(header[1]) }
      : { name, url: value.url, type, auth: "none" };
  }
  if (typeof value.command === "string" && value.url === undefined) {
    const args = Array.isArray(value.args) && value.args.every((arg) => typeof arg === "string") ? value.args as string[] : value.args === undefined ? [] : null;
    if (!args) return "args is a list of text values.";
    const env = value.env && typeof value.env === "object" && !Array.isArray(value.env) ? value.env as Record<string, string> : value.env === undefined ? {} : null;
    if (!env) return "env maps names to text values.";
    return { name, command: value.command, args, env, runsIn: "environment" };
  }
  return "Send a remote url or a local command, not both.";
}

/** Validate one new personal server, or say why not. */
export function parsePersonalMcpInput(input: unknown, now = Date.now(), allowPrivate = false): { name: string; server: PersonalMcpServer } {
  const parsed = personalMcpInputSchema.safeParse(input);
  if (!parsed.success) throw new PersonConnectionsError("Send { name, url, auth } for a remote server or { name, command, args } for a command.", "invalid_server");
  const value = parsed.data;
  const nameError = mcpServerNameError(value.name);
  if (nameError) throw new PersonConnectionsError(nameError, "invalid_name");
  if ("url" in value) {
    const bad = urlError(value.url, allowPrivate);
    if (bad) throw new PersonConnectionsError(bad, "invalid_url");
    const auth = value.auth ?? (value.token ? "token" : "none");
    const headerName = value.headerName || undefined;
    if (headerName && !HEADER_NAME.test(headerName)) throw new PersonConnectionsError(`Header “${headerName}” is not a valid header name.`, "invalid_header");
    if (auth === "token" && !value.token) throw new PersonConnectionsError("Paste the token this server expects.", "token_required");
    if (value.token && /[\r\n]/.test(value.token)) throw new PersonConnectionsError("The token must be a single line.", "invalid_token");
    return {
      name: value.name,
      server: {
        kind: "remote", type: value.type ?? "http", url: value.url, auth,
        ...(auth === "token" && headerName ? { headerName } : {}),
        ...(auth === "token" ? { token: value.token } : {}),
        enabled: true, addedAt: now,
      },
    };
  }
  const env = value.env ?? {};
  if (Object.keys(env).length > 64) throw new PersonConnectionsError("Use at most 64 environment variables.", "invalid_env");
  for (const [key, val] of Object.entries(env)) {
    if (!ENV_NAME.test(key)) throw new PersonConnectionsError(`Environment variable “${key}” is not valid.`, "invalid_env");
    if (isReservedMcpEnvEntry(key, String(val))) throw new PersonConnectionsError(`Environment variable “${key}” is reserved by Sagax.`, "invalid_env");
  }
  return { name: value.name, server: { kind: "stdio", command: value.command, args: value.args ?? [], env, runsIn: "environment", enabled: true, addedAt: now } };
}

export function listingOf(name: string, server: PersonalMcpServer): PersonalMcpListing {
  if (server.kind === "stdio") {
    return { name, kind: "stdio", command: server.command, args: server.args, envKeys: Object.keys(server.env).sort(), runsIn: "environment", enabled: server.enabled, addedAt: server.addedAt };
  }
  return {
    name, kind: "remote", type: server.type, url: server.url, domain: new URL(server.url).hostname, auth: server.auth,
    ...(server.headerName ? { headerName: server.headerName } : {}),
    tokenConfigured: Boolean(server.token), enabled: server.enabled, addedAt: server.addedAt,
  };
}

/** The header a remote personal server is sent for a token or a GitHub
 * connection. OAuth headers come from the person's sign-in manager. */
export function personalAuthHeaders(server: PersonalRemoteMcpServer, github: GithubConnection | undefined): Record<string, string> | null {
  if (server.auth === "none" || server.auth === "oauth") return {};
  if (server.auth === "github") return github ? { Authorization: `Bearer ${github.token}` } : null;
  if (!server.token) return null;
  const header = server.headerName ?? "Authorization";
  return { [header]: header.toLowerCase() === "authorization" && !/^\w+\s/.test(server.token) ? `Bearer ${server.token}` : server.token };
}

/** One encrypted file per person. Read through a small cache; a file that
 * cannot be decrypted is never overwritten with an empty one. */
export class PersonConnections {
  private readonly dataDir: string;
  private readonly keySource: () => VaultKeySource;
  private readonly cache = new Map<string, PersonCapabilitiesDocument>();

  constructor(dataDir: string, keySource: () => VaultKeySource) {
    this.dataDir = dataDir;
    this.keySource = keySource;
  }

  private file(principalId: string): string {
    return join(principalDir(this.dataDir, principalId), FILE);
  }

  private key(): Buffer {
    const source = this.keySource();
    if (source.kind === "unavailable") throw new PersonConnectionsError(source.reason, "store_unavailable", 503);
    return source.key;
  }

  read(principalId: string): PersonCapabilitiesDocument {
    const cached = this.cache.get(principalId);
    if (cached) return structuredClone(cached);
    const file = this.file(principalId);
    let raw: string;
    let legacy = false;
    try {
      raw = readFileSync(file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new PersonConnectionsError("Your capabilities could not be read.", "store_unavailable", 503);
      try {
        raw = readFileSync(join(principalDir(this.dataDir, principalId), LEGACY_FILE), "utf8");
        legacy = true;
      } catch (oldError) {
        if ((oldError as NodeJS.ErrnoException).code === "ENOENT") return emptyDocument();
        throw new PersonConnectionsError("Your saved connections could not be read.", "store_unavailable", 503);
      }
    }
    try {
      const envelope = JSON.parse(raw) as { v?: unknown; iv?: unknown; tag?: unknown; data?: unknown };
      if (envelope.v !== 1 || typeof envelope.iv !== "string" || typeof envelope.tag !== "string" || typeof envelope.data !== "string") throw new Error("format");
      const decipher = createDecipheriv("aes-256-gcm", this.key(), Buffer.from(envelope.iv, "base64"));
      decipher.setAAD(legacy ? LEGACY_AAD : AAD);
      decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
      const plain = Buffer.concat([decipher.update(Buffer.from(envelope.data, "base64")), decipher.final()]).toString("utf8");
      const document = legacy
        ? (() => {
          const old = legacyDocumentSchema.parse(JSON.parse(plain));
          return { ...emptyDocument(), mcpServers: old.mcpServers, ...(old.github ? { github: old.github } : {}) };
        })()
        : documentSchema.parse(JSON.parse(plain));
      // First successful legacy read writes the new store atomically. Keep
      // the original for recovery; the new file always takes precedence.
      if (legacy) this.write(principalId, document);
      this.cache.set(principalId, document);
      return structuredClone(document);
    } catch (error) {
      if (error instanceof PersonConnectionsError) throw error;
      throw new PersonConnectionsError("Your saved connections could not be decrypted on this launch.", "store_unavailable", 503);
    }
  }

  private write(principalId: string, document: PersonCapabilitiesDocument): void {
    const parsed = documentSchema.parse(document);
    const file = this.file(principalId);
    // Keep even an empty document: deleting it would resurrect an older
    // connections.enc at the next read after the person removed everything.
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key(), iv);
    cipher.setAAD(AAD);
    const data = Buffer.concat([cipher.update(JSON.stringify(parsed), "utf8"), cipher.final()]);
    mkdirSync(principalDir(this.dataDir, principalId), { recursive: true, mode: 0o700 });
    writeFileAtomic(file, JSON.stringify({ v: 1, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64") }), { mode: 0o600 });
    this.cache.set(principalId, parsed);
  }

  // ── MCP servers ────────────────────────────────────────────────────────

  servers(principalId: string): Record<string, PersonalMcpServer> {
    return this.read(principalId).mcpServers;
  }

  list(principalId: string): PersonalMcpListing[] {
    return Object.entries(this.servers(principalId)).map(([name, server]) => listingOf(name, server)).sort((a, b) => a.name.localeCompare(b.name));
  }

  add(principalId: string, name: string, server: PersonalMcpServer): void {
    const document = this.read(principalId);
    if (Object.hasOwn(document.mcpServers, name)) throw new PersonConnectionsError("You already have a server with that name.", "name_taken", 409);
    if (Object.keys(document.mcpServers).length >= MAX_PERSONAL_MCP_SERVERS) throw new PersonConnectionsError(`You can add at most ${MAX_PERSONAL_MCP_SERVERS} servers.`, "too_many", 400);
    document.mcpServers[name] = server;
    this.write(principalId, document);
  }

  setEnabled(principalId: string, name: string, enabled: boolean): void {
    const document = this.read(principalId);
    const server = document.mcpServers[name];
    if (!server) throw new PersonConnectionsError("No server with that name.", "not_found", 404);
    document.mcpServers[name] = { ...server, enabled };
    this.write(principalId, document);
  }

  remove(principalId: string, name: string): boolean {
    const document = this.read(principalId);
    if (!Object.hasOwn(document.mcpServers, name)) return false;
    delete document.mcpServers[name];
    this.write(principalId, document);
    return true;
  }

  // ── GitHub ─────────────────────────────────────────────────────────────

  github(principalId: string): GithubConnection | undefined {
    return this.read(principalId).github;
  }

  setGithub(principalId: string, connection: GithubConnection | undefined): void {
    const document = this.read(principalId);
    if (connection) document.github = connection;
    else delete document.github;
    this.write(principalId, document);
  }

  pluginState(principalId: string): CapabilityPluginState {
    return this.read(principalId).plugins;
  }

  setPluginState(principalId: string, state: CapabilityPluginState): void {
    const document = this.read(principalId);
    document.plugins = capabilityPluginStateSchema.parse(state);
    this.write(principalId, document);
  }

  pluginValues(principalId: string): CapabilityPluginValues {
    return this.read(principalId).pluginValues;
  }

  setPluginValues(principalId: string, values: CapabilityPluginValues): void {
    const document = this.read(principalId);
    document.pluginValues = capabilityPluginValuesSchema.parse(values);
    this.write(principalId, document);
  }

  assignedSkills(principalId: string): string[] {
    return this.read(principalId).assignedSkills;
  }

  setAssignedSkills(principalId: string, names: readonly string[]): void {
    const document = this.read(principalId);
    document.assignedSkills = [...new Set(names)].sort();
    this.write(principalId, document);
  }

  // ── the organization's offered capabilities (lot 4) ───────────────────

  /** The offered declarations this person turned on or off, by id. */
  orgCapabilityChoices(principalId: string): Record<string, boolean> {
    return { ...this.read(principalId).orgCapabilities };
  }

  /** Turn one offered declaration on or off for this person (all their
   * bots). Only their own state: never another person's, never global. */
  setOrgCapability(principalId: string, id: string, enabled: boolean): void {
    const document = this.read(principalId);
    document.orgCapabilities = { ...document.orgCapabilities, [id]: enabled };
    this.write(principalId, document);
  }
}

/** Existing connection routes keep their class name while reading the one
 * personal capabilities store. */
export { PersonConnections as PersonCapabilities };
