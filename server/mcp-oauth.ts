// OAuth sign-in for remote MCP servers the user adds (config.json
// `mcpServers`). Implements the client side of the MCP authorization spec
// (2025-06-18 and 2025-11-25) as an OAuth 2.1 public client:
//
//   probe       an unauthenticated request to the server; a 401 carries
//               WWW-Authenticate (resource_metadata, scope)
//   discovery   Protected Resource Metadata (RFC 9728), then Authorization
//               Server metadata (RFC 8414, OpenID Connect Discovery fallback)
//   client      Dynamic Client Registration (RFC 7591) when the server has a
//               registration endpoint, otherwise a client id the user enters
//   sign-in     authorization code + PKCE S256, `resource` (RFC 8707), and a
//               single-use `state` bound to one pending flow for 10 minutes
//   tokens      kept in an encrypted vault beside config.json, never in it,
//               refreshed before expiry and after a 401
//
// Nothing here logs or returns a token, a client secret, a code or a
// verifier. Public errors are fixed sentences plus, at most, an OAuth error
// code that is checked against a strict pattern.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { closeSync, mkdirSync, openSync, readFileSync, rmSync, unlinkSync, writeSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";

import { writeFileAtomic } from "./atomic.ts";
import type { McpServerSpec, RemoteMcpSpec } from "./contracts.ts";
import { guardedFetch } from "./public-fetch.ts";
import type { VaultKeySource } from "./vault-key-source.ts";

export type { VaultKeySource };

export type McpAuthState = "none" | "required" | "connected" | "expired" | "error";
/** How the app gets a client id at this authorization server. */
export type McpAuthClient = "dynamic" | "manual" | "needed";

export interface McpAuthStatus {
  auth: McpAuthState;
  /** A public sentence for an `error` state, or for a failed last attempt. */
  authError?: string;
  authClient?: McpAuthClient;
  /** The authorization server's host, so the user knows where they sign in. */
  authIssuer?: string;
}

export const PENDING_FLOW_TTL_MS = 10 * 60_000;
const MAX_PENDING_FLOWS = 20;
/** Refresh when the access token has less than this left. Engine turns can
 * last about 16 minutes and keep the Authorization header for the whole turn,
 * so the margin covers one expected turn (20 minutes). */
export const REFRESH_MARGIN_MS = 20 * 60_000;
/** Backoff between refresh retries when the authorization server answers a
 * transient status (5xx, 429, 408) or the network fails. */
const REFRESH_BACKOFF_MS = [250, 750, 2_000] as const;
/** How long one process waits for another's refresh lock before giving up
 * (tokens stay; the next attempt tries again). */
const REFRESH_LOCK_WAIT_MS = 30_000;
const REFRESH_LOCK_POLL_MS = 50;
const DEFAULT_TIMEOUT_MS = 8_000;
const MAX_METADATA_BYTES = 256 * 1024;
const PROTOCOL_VERSION = "2025-06-18";
const VAULT_FILE = "mcp-oauth.enc";
const KEY_FILE = "mcp-oauth.key";
const HEX_KEY = /^[0-9a-f]{64}$/;
const OAUTH_ERROR_CODE = /^[a-z_]{1,64}$/;
/** OAuth error codes that mean this grant or client is gone for good. */
const CLEAR_TOKEN_ERRORS = new Set(["invalid_grant", "invalid_client"]);
/** HTTP statuses treated as transient: keep tokens and retry with backoff. */
const TRANSIENT_HTTP = new Set([408, 429, 500, 502, 503, 504]);

// ── vault ────────────────────────────────────────────────────────────────

/** Everything this module remembers about one server's sign-in. */
const recordSchema = z.object({
  /** The MCP URL this record belongs to; a changed URL invalidates it. */
  serverUrl: z.string(),
  resource: z.string(),
  issuer: z.string(),
  authorizationEndpoint: z.string(),
  tokenEndpoint: z.string(),
  registrationEndpoint: z.string().optional(),
  revocationEndpoint: z.string().optional(),
  tokenAuthMethods: z.array(z.string()).optional(),
  scope: z.string().optional(),
  client: z.object({
    id: z.string(),
    secret: z.string().optional(),
    kind: z.enum(["dynamic", "manual"]),
    redirectUri: z.string(),
    authMethod: z.enum(["none", "client_secret_post", "client_secret_basic"]),
  }).optional(),
  tokens: z.object({
    access: z.string().optional(),
    refresh: z.string().optional(),
    expiresAt: z.number().optional(),
    scope: z.string().optional(),
  }).optional(),
  /** Set when a refresh was refused or a token stopped working. */
  expired: z.boolean().optional(),
  lastError: z.string().optional(),
  /** The name the person gave an account other than the first. */
  label: z.string().optional(),
});
export type McpOAuthRecord = z.infer<typeof recordSchema>;

/** The account every server starts with; a single sign-in from before
 * accounts existed is this one. */
export const DEFAULT_MCP_ACCOUNT = "default";
export const MAX_MCP_ACCOUNTS = 10;
const ACCOUNT_ID = /^(?:default|acct-[a-z0-9]{6,16})$/;
export const isMcpAccountId = (value: unknown): value is string => typeof value === "string" && ACCOUNT_ID.test(value);

const SERVER_NAME = /^[a-z][a-z0-9_-]{0,31}$/;
const MAX_ACCOUNT_CHOICES = 64;

/** A bot's account per server, from a PATCH body: null clears it, a
 * default choice is left out (absent means the default account). */
export function parseMcpAccountChoices(value: unknown): { ok: true; choices: Record<string, string> | undefined } | { ok: false; error: string } {
  if (value === null) return { ok: true, choices: undefined };
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, error: "mcpAccounts must map server names to accounts, or be null" };
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > MAX_ACCOUNT_CHOICES) return { ok: false, error: `Choose accounts for at most ${MAX_ACCOUNT_CHOICES} servers.` };
  const choices: Record<string, string> = {};
  for (const [name, account] of entries) {
    if (!SERVER_NAME.test(name) || !isMcpAccountId(account)) return { ok: false, error: "mcpAccounts must map server names to accounts, or be null" };
    if (account !== DEFAULT_MCP_ACCOUNT) choices[name] = account;
  }
  return { ok: true, choices: Object.keys(choices).length ? choices : undefined };
}

const legacyVaultSchema = z.object({ version: z.literal(1), records: z.record(z.string(), recordSchema) });
const vaultSchema = z.object({
  version: z.literal(2),
  servers: z.record(z.string(), z.record(z.string().regex(ACCOUNT_ID), recordSchema)),
});
type VaultDocument = z.infer<typeof vaultSchema>;

/** A vault written before accounts: each server's one sign-in becomes its
 * default account. */
function migrateVault(raw: unknown): VaultDocument | null {
  const current = vaultSchema.safeParse(raw);
  if (current.success) return current.data;
  const legacy = legacyVaultSchema.safeParse(raw);
  if (!legacy.success) return null;
  const servers: VaultDocument["servers"] = {};
  for (const [name, record] of Object.entries(legacy.data.records)) servers[name] = { [DEFAULT_MCP_ACCOUNT]: record };
  return { version: 2, servers };
}

/** Where the vault key comes from. The desktop shell keeps it in the
 * OS-encrypted credential store (credentials.bin) and hands it over as
 * SAGAX_MCP_OAUTH_KEY; a desktop child without it must not invent a second
 * key. A headless server keeps a 0600 key file beside its data, the same
 * treatment as the browser engine's session key. */
export function resolveVaultKey(dataDir: string, env: NodeJS.ProcessEnv = process.env): VaultKeySource {
  const fromEnv = env.SAGAX_MCP_OAUTH_KEY?.trim().toLowerCase();
  if (fromEnv && HEX_KEY.test(fromEnv)) return { kind: "key", key: Buffer.from(fromEnv, "hex") };
  if (env.SAGAX_DESKTOP_PARENT === "1") {
    return { kind: "unavailable", reason: "The encrypted credential store could not be read on this launch." };
  }
  const file = join(dataDir, KEY_FILE);
  try {
    const existing = readFileSync(file, "utf8").trim();
    if (HEX_KEY.test(existing)) return { kind: "key", key: Buffer.from(existing, "hex") };
  } catch {
    // first run
  }
  try {
    const key = randomBytes(32).toString("hex");
    mkdirSync(dataDir, { recursive: true });
    writeFileAtomic(file, `${key}\n`, { mode: 0o600 });
    return { kind: "key", key: Buffer.from(key, "hex") };
  } catch {
    return { kind: "unavailable", reason: "The sign-in store could not be created." };
  }
}

export class McpOAuthVault {
  private readonly file: string;
  private readonly keySource: () => VaultKeySource;
  private cached: VaultDocument | null = null;
  private unreadable: string | null = null;

  constructor(dataDir: string, keySource: () => VaultKeySource) {
    this.file = join(dataDir, VAULT_FILE);
    this.keySource = keySource;
  }

  /** Null when the store cannot be read; never an empty document in its
   * place, so a bad key can never overwrite saved sign-ins. */
  private load(): VaultDocument | null {
    if (this.cached) return this.cached;
    const source = this.keySource();
    if (source.kind === "unavailable") {
      this.unreadable = source.reason;
      return null;
    }
    let raw: string;
    try {
      raw = readFileSync(this.file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        this.cached = { version: 2, servers: {} };
        this.unreadable = null;
        return this.cached;
      }
      this.unreadable = "The sign-in store could not be read.";
      return null;
    }
    try {
      const envelope = JSON.parse(raw) as { v?: unknown; iv?: unknown; tag?: unknown; data?: unknown };
      if (envelope.v !== 1 || typeof envelope.iv !== "string" || typeof envelope.tag !== "string" || typeof envelope.data !== "string") {
        throw new Error("format");
      }
      const decipher = createDecipheriv("aes-256-gcm", source.key, Buffer.from(envelope.iv, "base64"));
      decipher.setAAD(Buffer.from("pulsa-bot mcp-oauth v1"));
      decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
      const plain = Buffer.concat([decipher.update(Buffer.from(envelope.data, "base64")), decipher.final()]).toString("utf8");
      const parsed = JSON.parse(plain) as { version?: unknown };
      const document = migrateVault(parsed);
      if (!document) throw new Error("schema");
      this.cached = document;
      this.unreadable = null;
      if (parsed.version !== 2) {
        try {
          this.persist(document);
        } catch {
          // read again as version 1 next launch; nothing is lost
        }
      }
      return this.cached;
    } catch {
      this.unreadable = "Saved MCP sign-ins could not be decrypted on this launch.";
      return null;
    }
  }

  unavailableReason(): string | null {
    this.load();
    return this.unreadable;
  }

  get(name: string, account: string = DEFAULT_MCP_ACCOUNT): McpOAuthRecord | undefined {
    const record = this.load()?.servers[name]?.[account];
    return record ? structuredClone(record) : undefined;
  }

  /** Servers with at least one saved account. */
  names(): string[] {
    return Object.keys(this.load()?.servers ?? {});
  }

  /** The accounts saved for a server, the default one first. */
  accounts(name: string): string[] {
    const ids = Object.keys(this.load()?.servers[name] ?? {});
    return [...ids.filter((id) => id === DEFAULT_MCP_ACCOUNT), ...ids.filter((id) => id !== DEFAULT_MCP_ACCOUNT).sort()];
  }

  set(name: string, record: McpOAuthRecord | undefined, account: string = DEFAULT_MCP_ACCOUNT): void {
    const document = this.load();
    if (!document) throw new McpOAuthError(this.unreadable ?? "The sign-in store is unavailable.");
    const accounts = { ...document.servers[name] };
    if (record) accounts[account] = structuredClone(record);
    else delete accounts[account];
    const servers = { ...document.servers, [name]: accounts };
    if (Object.keys(accounts).length === 0) delete servers[name];
    this.write({ version: 2, servers });
  }

  /** Drop the in-memory copy so the next get reads the file again (another
   * process may have rotated tokens under the refresh lock). */
  invalidate(): void {
    this.cached = null;
  }

  /** Path of the exclusive lock that serializes refresh across processes that
   * share this vault file. */
  refreshLockPath(): string {
    return `${this.file}.refresh.lock`;
  }

  /** Forget every account of a server. */
  drop(name: string): void {
    const document = this.load();
    if (!document) throw new McpOAuthError(this.unreadable ?? "The sign-in store is unavailable.");
    if (!document.servers[name]) return;
    const servers = { ...document.servers };
    delete servers[name];
    this.write({ version: 2, servers });
  }

  private write(next: VaultDocument): void {
    this.persist(next);
    this.cached = next;
  }

  private persist(document: VaultDocument): void {
    const source = this.keySource();
    if (source.kind === "unavailable") throw new McpOAuthError(source.reason);
    if (Object.keys(document.servers).length === 0) {
      rmSync(this.file, { force: true });
      return;
    }
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", source.key, iv);
    cipher.setAAD(Buffer.from("pulsa-bot mcp-oauth v1"));
    const data = Buffer.concat([cipher.update(JSON.stringify(document), "utf8"), cipher.final()]);
    const envelope = { v: 1, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64") };
    mkdirSync(join(this.file, ".."), { recursive: true });
    writeFileAtomic(this.file, JSON.stringify(envelope), { mode: 0o600 });
  }
}

// ── helpers ──────────────────────────────────────────────────────────────

export class McpOAuthError extends Error {
  readonly code: string | undefined;
  constructor(message: string, code?: string) {
    super(message);
    this.name = "McpOAuthError";
    this.code = code;
  }
}

function base64url(buffer: Buffer): string {
  return buffer.toString("base64url");
}

export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

function isLoopbackHostname(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return host === "localhost" || host.startsWith("127.") || host === "::1";
}

/** An endpoint a token may be sent to: https, or http on this machine. */
export function safeEndpoint(value: unknown): string | undefined {
  if (typeof value !== "string" || !value) return undefined;
  try {
    const url = new URL(value);
    if (url.username || url.password || url.hash) return undefined;
    if (url.protocol === "https:") return url.toString();
    if (url.protocol === "http:" && isLoopbackHostname(url.hostname)) return url.toString();
    return undefined;
  } catch {
    return undefined;
  }
}

/** The canonical resource URI for an MCP server URL (RFC 8707 / MCP spec):
 * scheme and host lowercase, no fragment, no trailing slash on the root. */
export function canonicalResource(serverUrl: string): string {
  const url = new URL(serverUrl);
  url.hash = "";
  const text = url.toString();
  return url.pathname === "/" && !url.search ? text.replace(/\/$/, "") : text;
}

/** Parse the parameters of a `Bearer` WWW-Authenticate challenge. */
export function parseBearerChallenge(header: string | null): Record<string, string> | null {
  if (!header) return null;
  const match = /(?:^|,\s*)Bearer\b(.*)$/i.exec(header);
  if (!match) return null;
  const params: Record<string, string> = {};
  const pattern = /([A-Za-z0-9_-]+)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^\s,]+))/g;
  for (const part of match[1].matchAll(pattern)) {
    const key = part[1].toLowerCase();
    if (!(key in params)) params[key] = (part[2] ?? part[3] ?? "").replace(/\\(.)/g, "$1");
  }
  return params;
}

export async function readBounded(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_METADATA_BYTES) {
      await reader.cancel().catch(() => {});
      throw new McpOAuthError("The authorization server sent a response that is too large.");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function fetchJson(fetcher: typeof fetch, url: string, signal: AbortSignal): Promise<Record<string, unknown> | null> {
  let response: Response;
  try {
    response = await fetcher(url, { headers: { accept: "application/json", "MCP-Protocol-Version": PROTOCOL_VERSION }, signal, redirect: "error" });
  } catch {
    return null;
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(await readBounded(response));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function stringList(value: unknown): string[] | undefined {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : undefined;
}

/** Well-known URLs for the Protected Resource Metadata of `serverUrl`, the
 * path-aware one first (RFC 9728 section 3.1). */
export function protectedResourceMetadataUrls(serverUrl: string): string[] {
  const url = new URL(serverUrl);
  const path = url.pathname.replace(/\/$/, "");
  const urls = [];
  if (path) urls.push(`${url.origin}/.well-known/oauth-protected-resource${path}`);
  urls.push(`${url.origin}/.well-known/oauth-protected-resource`);
  return urls;
}

/** Well-known URLs for an authorization server's metadata, in the order the
 * MCP spec (2025-11-25) lists: RFC 8414 then OpenID Connect Discovery. */
export function authorizationServerMetadataUrls(issuer: string): string[] {
  const url = new URL(issuer);
  const path = url.pathname.replace(/\/$/, "");
  if (!path) {
    return [`${url.origin}/.well-known/oauth-authorization-server`, `${url.origin}/.well-known/openid-configuration`];
  }
  return [
    `${url.origin}/.well-known/oauth-authorization-server${path}`,
    `${url.origin}/.well-known/openid-configuration${path}`,
    `${url.origin}${path}/.well-known/openid-configuration`,
  ];
}

export interface DiscoveredAuth {
  resource: string;
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint?: string;
  revocationEndpoint?: string;
  tokenAuthMethods?: string[];
  scope?: string;
}

export type ProbeOutcome =
  | { kind: "open" }
  | { kind: "oauth"; discovered: DiscoveredAuth }
  | { kind: "unauthorized"; error: string }
  | { kind: "unreachable"; error: string };

// ── manager ──────────────────────────────────────────────────────────────

export interface McpOAuthOptions {
  vault: McpOAuthVault;
  fetch?: typeof fetch;
  now?: () => number;
  clientName?: string;
  timeoutMs?: number;
  /** Injectable delay for refresh backoff (tests). */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

interface PendingFlow {
  name: string;
  account: string;
  serverUrl: string;
  verifier: string;
  redirectUri: string;
  createdAt: number;
  /** A phone's sign-in sheet (ASWebAuthenticationSession) waits for this
   * address; the callback redirects there instead of showing a page. */
  returnTo?: string;
}

/** `account` only for an account other than the default one. */
export type CallbackResult =
  | { ok: true; name: string; account?: string; returnTo?: string }
  | { ok: false; name?: string; account?: string; error: string; returnTo?: string };

/** One saved sign-in of a server, as the listing shows it. */
export interface McpAccountStatus extends McpAuthStatus {
  id: string;
  label?: string;
}

/** Which account each server uses for one turn (a bot's choice); a server
 * it names nothing for uses the default account. */
export type McpAccountChooser = (name: string) => string | undefined;

/** The app return addresses a sign-in may end on: the phone's custom scheme
 * by default, plus any listed in SAGAX_PHONE_OAUTH_RETURNS (comma separated,
 * custom schemes or https universal links), compared exactly. */
export function phoneOAuthReturns(env: NodeJS.ProcessEnv = process.env): string[] {
  const extra = (env.SAGAX_PHONE_OAUTH_RETURNS ?? "").split(",").map((value) => value.trim()).filter((value) => {
    try {
      const url = new URL(value);
      return !url.username && !url.password && !url.hash && (url.protocol === "https:" || /^[a-z][a-z0-9+.-]*:$/.test(url.protocol) && !["http:", "javascript:", "vbscript:", "data:", "file:", "blob:"].includes(url.protocol));
    } catch { return false; }
  });
  return ["sagax://oauth-done", ...extra];
}

/** Where the phone's sheet is sent when the sign-in ends: the return
 * address with `status` (ok or error), `server` and, on error, `error` (a
 * short message; never a code or token). */
export function phoneReturnLocation(result: CallbackResult): string | null {
  if (!result.returnTo) return null;
  const url = new URL(result.returnTo);
  url.searchParams.set("status", result.ok ? "ok" : "error");
  if (result.name) url.searchParams.set("server", result.name);
  if (!result.ok) url.searchParams.set("error", result.error.slice(0, 200));
  return url.toString();
}

/** One transient answer about a server that needs no sign-in, or that could
 * not be reached: kept in memory only, keyed by a hash of URL and headers. */
interface ProbeMemo {
  fingerprint: string;
  status: McpAuthStatus;
  at: number;
}
const PROBE_MEMO_TTL_MS = 10 * 60_000;
const PROBE_ERROR_TTL_MS = 5 * 60_000;

export class McpOAuthManager {
  readonly vault: McpOAuthVault;
  private readonly fetcher: typeof fetch;
  private readonly now: () => number;
  private readonly clientName: string;
  private readonly timeoutMs: number;
  private readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  private readonly pending = new Map<string, PendingFlow>();
  private readonly refreshing = new Map<string, Promise<boolean>>();
  private readonly probing = new Map<string, Promise<McpAuthStatus>>();
  private readonly memo = new Map<string, ProbeMemo>();

  constructor(options: McpOAuthOptions) {
    this.vault = options.vault;
    this.fetcher = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
    this.clientName = options.clientName ?? "Sagax";
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.sleep = options.sleep ?? sleepMs;
  }

  private signal(outer?: AbortSignal): AbortSignal {
    const timeout = AbortSignal.timeout(this.timeoutMs);
    return outer ? AbortSignal.any([outer, timeout]) : timeout;
  }

  private record(name: string, server: RemoteMcpSpec, account: string = DEFAULT_MCP_ACCOUNT): McpOAuthRecord | undefined {
    const record = this.vault.get(name, account);
    return record && record.serverUrl === server.url ? record : undefined;
  }

  // ── status ─────────────────────────────────────────────────────────────

  /** What the listing shows. Synchronous: it never touches the network. */
  status(name: string, server: RemoteMcpSpec, account: string = DEFAULT_MCP_ACCOUNT): McpAuthStatus | undefined {
    const unavailable = this.vault.unavailableReason();
    const record = unavailable ? undefined : this.record(name, server, account);
    if (!record) {
      if (unavailable) return { auth: "error", authError: unavailable };
      if (account !== DEFAULT_MCP_ACCOUNT) return undefined;
      const memo = this.memo.get(name);
      if (memo && memo.fingerprint === fingerprint(server) && this.now() - memo.at < (memo.status.auth === "none" ? PROBE_MEMO_TTL_MS : PROBE_ERROR_TTL_MS)) {
        return memo.status;
      }
      return undefined;
    }
    const base: McpAuthStatus = {
      auth: "required",
      authClient: record.client?.kind ?? (record.registrationEndpoint ? "dynamic" : "needed"),
      authIssuer: hostOf(record.issuer),
      ...(record.lastError ? { authError: record.lastError } : {}),
    };
    const tokens = record.tokens;
    if (tokens?.access || tokens?.refresh) {
      const live = tokens.access && (tokens.expiresAt === undefined || tokens.expiresAt > this.now());
      if (!record.expired && (live || tokens.refresh)) return { ...base, auth: "connected" };
      return { ...base, auth: "expired" };
    }
    if (record.expired) return { ...base, auth: "expired" };
    return base;
  }

  /** Every account saved for this server (the default one first, even
   * before its sign-in), with its state. */
  accounts(name: string, server: RemoteMcpSpec): McpAccountStatus[] {
    if (this.vault.unavailableReason()) return [];
    return this.vault.accounts(name).flatMap((id): McpAccountStatus[] => {
      const record = this.record(name, server, id);
      const status = record ? this.status(name, server, id) : undefined;
      return status ? [{ id, ...(record?.label ? { label: record.label } : {}), ...status }] : [];
    });
  }

  /** Probe every listed remote server whose state is not known yet, in
   * parallel and bounded by the manager's timeout. */
  async probeUnknown(servers: Record<string, RemoteMcpSpec>, options: { force?: boolean; signal?: AbortSignal } = {}): Promise<void> {
    if (options.force) {
      for (const name of Object.keys(servers)) this.memo.delete(name);
    }
    await Promise.all(Object.entries(servers).map(async ([name, server]) => {
      if (!options.force && this.status(name, server)) return;
      await this.probe(name, server, options.signal).catch(() => undefined);
    }));
  }

  /** Ask the server whether it wants a sign-in, and remember what the
   * discovery chain found. Deduplicated per server. */
  probe(name: string, server: RemoteMcpSpec, outer?: AbortSignal): Promise<McpAuthStatus> {
    const inflight = this.probing.get(name);
    if (inflight) return inflight;
    const work = (async (): Promise<McpAuthStatus> => {
      const signal = this.signal(outer);
      const record = this.record(name, server);
      const outcome = await probeServer(this.fetcher, server, signal, this.bearerFor(record));
      if (outcome.kind === "open") {
        if (record?.tokens) {
          // Our token worked: keep the record, clear any stale failure.
          if (record.expired || record.lastError) this.vault.set(name, { ...record, expired: false, lastError: undefined });
          return this.status(name, server)!;
        }
        // The server answers without a sign-in (or stopped asking for one).
        if (record) this.vault.set(name, undefined);
        return this.remember(name, server, { auth: "none" });
      }
      if (outcome.kind === "unreachable" || outcome.kind === "unauthorized") {
        if (record) {
          if (outcome.kind === "unauthorized" && record.tokens) {
            // A token the server refuses: try one refresh before giving up.
            if (await this.refresh(name, server, true)) return this.status(name, server)!;
          }
          return this.status(name, server)!;
        }
        return this.remember(name, server, { auth: "error", authError: outcome.error });
      }
      const discovered = outcome.discovered;
      const next: McpOAuthRecord = {
        ...record,
        serverUrl: server.url,
        resource: discovered.resource,
        issuer: discovered.issuer,
        authorizationEndpoint: discovered.authorizationEndpoint,
        tokenEndpoint: discovered.tokenEndpoint,
        registrationEndpoint: discovered.registrationEndpoint,
        revocationEndpoint: discovered.revocationEndpoint,
        tokenAuthMethods: discovered.tokenAuthMethods,
        scope: discovered.scope,
        lastError: undefined,
      };
      // A client registered at a different authorization server is useless.
      if (record && record.issuer !== discovered.issuer) {
        delete next.client;
        delete next.tokens;
      }
      if (record?.tokens && record.issuer === discovered.issuer) {
        // The server refused our token (probe sent it): refresh or expire.
        this.vault.set(name, next);
        if (!(await this.refresh(name, server, true))) return this.status(name, server)!;
        return this.status(name, server)!;
      }
      this.vault.set(name, next);
      this.memo.delete(name);
      return this.status(name, server)!;
    })().finally(() => this.probing.delete(name));
    this.probing.set(name, work);
    return work;
  }

  private remember(name: string, server: RemoteMcpSpec, status: McpAuthStatus): McpAuthStatus {
    this.memo.set(name, { fingerprint: fingerprint(server), status, at: this.now() });
    return status;
  }

  private bearerFor(record: McpOAuthRecord | undefined): string | undefined {
    const access = record?.tokens?.access;
    if (!access || record?.expired) return undefined;
    return access;
  }

  // ── sign-in ────────────────────────────────────────────────────────────

  /** Start a sign-in and return the authorization URL to open. A client id
   * (and optional secret) is needed only when the server offers no dynamic
   * registration; one given here replaces any saved client. */
  async start(
    name: string,
    server: RemoteMcpSpec,
    input: { redirectUri: string; clientId?: string; clientSecret?: string; returnTo?: string; account?: string; label?: string },
    outer?: AbortSignal,
  ): Promise<{ authorizationUrl: string }> {
    const account = input.account ?? DEFAULT_MCP_ACCOUNT;
    let base = this.record(name, server);
    if (!base) {
      await this.probe(name, server, outer);
      base = this.record(name, server);
    }
    if (!base) {
      const status = this.status(name, server);
      if (status?.auth === "none") throw new McpOAuthError("This server does not ask for a sign-in.", "not_required");
      throw new McpOAuthError(status?.authError ?? "This server does not offer OAuth sign-in.", "not_supported");
    }
    let record = base;
    if (account !== DEFAULT_MCP_ACCOUNT) {
      const saved = this.record(name, server, account);
      if (saved) {
        record = input.label ? { ...saved, label: input.label } : saved;
      } else {
        if (this.vault.accounts(name).filter((id) => id !== account).length >= MAX_MCP_ACCOUNTS) {
          throw new McpOAuthError(`A server keeps at most ${MAX_MCP_ACCOUNTS} accounts.`, "too_many_accounts");
        }
        // Another account at the same authorization server: its discovery
        // and app, never the first account's tokens.
        const { tokens: _tokens, expired: _expired, lastError: _lastError, label: _label, ...discovery } = base;
        record = { ...discovery, ...(input.label ? { label: input.label } : {}) };
      }
    }
    const signal = this.signal(outer);
    let client = record.client;
    if (input.clientId) {
      const secret = input.clientSecret || undefined;
      client = {
        id: input.clientId,
        ...(secret ? { secret } : {}),
        kind: "manual",
        redirectUri: input.redirectUri,
        authMethod: secret ? chooseSecretMethod(record.tokenAuthMethods) : "none",
      };
    } else if (client?.kind === "manual") {
      client = { ...client, redirectUri: input.redirectUri };
    } else if (!client || client.redirectUri !== input.redirectUri) {
      if (!record.registrationEndpoint) {
        throw new McpOAuthError("This server needs a client ID. Register an app with the provider, then enter its client ID.", "client_required");
      }
      client = await this.register(record, input.redirectUri, signal);
    }
    this.vault.set(name, { ...record, client, lastError: undefined }, account);

    this.sweep();
    if (this.pending.size >= MAX_PENDING_FLOWS) {
      const oldest = [...this.pending.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt)[0];
      if (oldest) this.pending.delete(oldest[0]);
    }
    // One pending flow per account: a second click replaces the first.
    for (const [key, flow] of this.pending) if (flow.name === name && flow.account === account) this.pending.delete(key);
    const state = base64url(randomBytes(32));
    const { verifier, challenge } = pkcePair();
    this.pending.set(state, { name, account, serverUrl: server.url, verifier, redirectUri: client.redirectUri, createdAt: this.now(), ...(input.returnTo ? { returnTo: input.returnTo } : {}) });

    const url = new URL(record.authorizationEndpoint);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", client.id);
    url.searchParams.set("redirect_uri", client.redirectUri);
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("state", state);
    url.searchParams.set("resource", record.resource);
    if (record.scope) url.searchParams.set("scope", record.scope);
    return { authorizationUrl: url.toString() };
  }

  private async register(record: McpOAuthRecord, redirectUri: string, signal: AbortSignal): Promise<NonNullable<McpOAuthRecord["client"]>> {
    let response: Response;
    try {
      response = await this.fetcher(record.registrationEndpoint!, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          client_name: this.clientName,
          redirect_uris: [redirectUri],
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
          token_endpoint_auth_method: "none",
          ...(record.scope ? { scope: record.scope } : {}),
        }),
        signal,
        redirect: "error",
      });
    } catch {
      throw new McpOAuthError("Could not reach the authorization server to register Sagax.");
    }
    const body = await readJsonBody(response);
    if (!response.ok || typeof body?.client_id !== "string" || !body.client_id) {
      throw new McpOAuthError(`The authorization server refused to register Sagax${oauthErrorSuffix(body)}.`, "registration_failed");
    }
    const secret = typeof body.client_secret === "string" && body.client_secret ? body.client_secret : undefined;
    const declared = body.token_endpoint_auth_method;
    const authMethod = !secret ? "none"
      : declared === "client_secret_post" || declared === "client_secret_basic" ? declared
        : "client_secret_basic";
    return { id: body.client_id, ...(secret ? { secret } : {}), kind: "dynamic", redirectUri, authMethod };
  }

  /** Finish a sign-in from the redirect. The state is consumed whatever the
   * outcome, so a replayed or late callback can never redeem a code. */
  async callback(query: URLSearchParams, outer?: AbortSignal): Promise<CallbackResult> {
    const state = query.get("state") ?? "";
    this.sweep();
    const flow = state ? this.pending.get(state) : undefined;
    if (state) this.pending.delete(state);
    if (!flow) return { ok: false, error: "This sign-in link has expired or was already used. Start the sign-in again from Sagax." };
    const result = await this.finish(flow, query, outer);
    return flow.returnTo ? { ...result, returnTo: flow.returnTo } : result;
  }

  private async finish(flow: PendingFlow, query: URLSearchParams, outer?: AbortSignal): Promise<CallbackResult> {
    const named = { name: flow.name, ...(flow.account !== DEFAULT_MCP_ACCOUNT ? { account: flow.account } : {}) };
    const record = this.vault.get(flow.name, flow.account);
    if (!record || record.serverUrl !== flow.serverUrl || !record.client) {
      return { ok: false, ...named, error: "This MCP server changed while signing in. Start the sign-in again." };
    }
    const save = (next: McpOAuthRecord) => this.vault.set(flow.name, next, flow.account);
    const denied = query.get("error");
    if (denied) {
      const code = OAUTH_ERROR_CODE.test(denied) ? denied : "error";
      const error = code === "access_denied" ? "The sign-in was cancelled." : `The authorization server returned an error (${code}).`;
      save({ ...record, lastError: error });
      return { ok: false, ...named, error };
    }
    const code = query.get("code");
    if (!code) return { ok: false, ...named, error: "The authorization server did not return a code." };
    // RFC 9207: when the server names itself, it must be the one we asked.
    const iss = query.get("iss");
    if (iss && iss.replace(/\/$/, "") !== record.issuer.replace(/\/$/, "")) {
      const error = "The sign-in came back from an unexpected authorization server.";
      save({ ...record, lastError: error });
      return { ok: false, ...named, error };
    }
    try {
      const tokens = await this.tokenRequest(record, {
        grant_type: "authorization_code",
        code,
        redirect_uri: flow.redirectUri,
        code_verifier: flow.verifier,
      }, this.signal(outer));
      save({ ...record, tokens, expired: false, lastError: undefined });
      this.memo.delete(flow.name);
      return { ok: true, ...named };
    } catch (error) {
      const message = error instanceof McpOAuthError ? error.message : "The sign-in could not be completed.";
      save({ ...record, lastError: message });
      return { ok: false, ...named, error: message };
    }
  }

  /** Whether this manager started the sign-in this callback `state` names
   * (one manager per person on an organization server). */
  ownsState(state: string): boolean {
    this.sweep();
    return Boolean(state) && this.pending.has(state);
  }

  /** True while a flow for `name` (one account, or any) is waiting for
   * its redirect. */
  pendingFor(name: string, account?: string): boolean {
    this.sweep();
    return [...this.pending.values()].some((flow) => flow.name === name && (account === undefined || flow.account === account));
  }

  private sweep(): void {
    const now = this.now();
    for (const [key, flow] of this.pending) {
      if (now - flow.createdAt > PENDING_FLOW_TTL_MS) this.pending.delete(key);
    }
  }

  private async tokenRequest(
    record: McpOAuthRecord,
    params: Record<string, string>,
    signal: AbortSignal,
  ): Promise<NonNullable<McpOAuthRecord["tokens"]>> {
    const client = record.client!;
    const form = new URLSearchParams({ ...params, resource: record.resource });
    const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded", accept: "application/json" };
    if (client.authMethod === "client_secret_basic" && client.secret) {
      headers.authorization = `Basic ${Buffer.from(`${encodeURIComponent(client.id)}:${encodeURIComponent(client.secret)}`).toString("base64")}`;
    } else {
      form.set("client_id", client.id);
      if (client.authMethod === "client_secret_post" && client.secret) form.set("client_secret", client.secret);
    }
    let response: Response;
    try {
      response = await this.fetcher(record.tokenEndpoint, { method: "POST", headers, body: form.toString(), signal, redirect: "error" });
    } catch {
      throw new McpOAuthError("Could not reach the authorization server.", "network");
    }
    const body = await readJsonBody(response);
    if (!response.ok || !body) {
      const code = typeof body?.error === "string" && OAUTH_ERROR_CODE.test(body.error) ? body.error : undefined;
      if (TRANSIENT_HTTP.has(response.status)) {
        throw new McpOAuthError(`The authorization server is temporarily unavailable${oauthErrorSuffix(body)}.`, "transient");
      }
      throw new McpOAuthError(`The authorization server refused the request${oauthErrorSuffix(body)}.`, code ?? "token_failed");
    }
    const access = body.access_token;
    const type = body.token_type;
    if (typeof access !== "string" || !access || /[\r\n]/.test(access) || typeof type !== "string" || type.toLowerCase() !== "bearer") {
      throw new McpOAuthError("The authorization server returned an unusable token.", "token_failed");
    }
    const expiresIn = typeof body.expires_in === "number" && Number.isFinite(body.expires_in) && body.expires_in > 0
      ? body.expires_in
      : typeof body.expires_in === "string" && /^\d+$/.test(body.expires_in) ? Number(body.expires_in) : undefined;
    return {
      access,
      ...(typeof body.refresh_token === "string" && body.refresh_token
        ? { refresh: body.refresh_token }
        : params.grant_type === "refresh_token" ? { refresh: params.refresh_token } : {}),
      ...(expiresIn ? { expiresAt: this.now() + expiresIn * 1000 } : {}),
      ...(typeof body.scope === "string" ? { scope: body.scope } : {}),
    };
  }

  // ── tokens for engines ─────────────────────────────────────────────────

  /** Refresh the access token when it expires soon (or `force`). Resolves
   * true when a usable token is in the vault afterwards. */
  refresh(name: string, server: RemoteMcpSpec, force = false, outer?: AbortSignal, account: string = DEFAULT_MCP_ACCOUNT): Promise<boolean> {
    const key = `${name}\0${account}`;
    const inflight = this.refreshing.get(key);
    if (inflight) return inflight;
    const work = (async () => {
      // Serialize rotation across processes that share the vault file so two
      // workers never spend the same refresh token at once.
      return withRefreshLock(this.vault.refreshLockPath(), async () => {
        this.vault.invalidate();
        const record = this.record(name, server, account);
        const tokens = record?.tokens;
        if (!record || !tokens || !record.client) return false;
        const save = (next: McpOAuthRecord) => this.vault.set(name, next, account);
        const due = force || !tokens.access || (tokens.expiresAt !== undefined && tokens.expiresAt - this.now() < REFRESH_MARGIN_MS);
        if (!due) return !record.expired;
        if (!tokens.refresh) {
          if (tokens.access) save({ ...record, tokens: { ...tokens, access: undefined }, expired: true });
          return false;
        }
        const accessStillUsable = () => Boolean(tokens.access) && (tokens.expiresAt === undefined || tokens.expiresAt > this.now()) && !force;
        for (let attempt = 0; ; attempt += 1) {
          try {
            const next = await this.tokenRequest(record, { grant_type: "refresh_token", refresh_token: tokens.refresh }, this.signal(outer));
            save({ ...record, tokens: next, expired: false, lastError: undefined });
            return true;
          } catch (error) {
            const code = error instanceof McpOAuthError ? error.code : undefined;
            if (code === "network" || code === "transient") {
              const delay = REFRESH_BACKOFF_MS[attempt];
              if (delay !== undefined && !outer?.aborted) {
                try {
                  await this.sleep(delay, outer);
                  continue;
                } catch {
                  return accessStillUsable();
                }
              }
              // Keep tokens: a deploy's 502/503/429 must not wipe a valid sign-in.
              return accessStillUsable();
            }
            if (code && CLEAR_TOKEN_ERRORS.has(code)) {
              save({ ...record, tokens: undefined, expired: true, lastError: "The sign-in expired. Sign in again." });
              return false;
            }
            // Other refusals keep the grant; the next turn may succeed.
            const message = error instanceof McpOAuthError ? error.message : "The sign-in could not be refreshed.";
            save({ ...record, lastError: message });
            return accessStillUsable();
          }
        }
      }).catch(() => {
        // Lock busy or unavailable: keep tokens; do not clear the sign-in.
        this.vault.invalidate();
        const record = this.record(name, server, account);
        const tokens = record?.tokens;
        if (!tokens?.access) return false;
        return (tokens.expiresAt === undefined || tokens.expiresAt > this.now()) && !force;
      });
    })().finally(() => this.refreshing.delete(key));
    this.refreshing.set(key, work);
    return work;
  }

  /** Refresh every signed-in server in `servers` whose token is due, on the
   * account `accountFor` names. Failures only mark the account expired;
   * the turn still starts. */
  async refreshDue(servers: Record<string, McpServerSpec>, signal?: AbortSignal, accountFor?: McpAccountChooser): Promise<void> {
    await Promise.all(Object.entries(servers).map(async ([name, server]) => {
      if (!("url" in server)) return;
      const account = accountFor?.(name) ?? DEFAULT_MCP_ACCOUNT;
      if (!this.record(name, server, account)?.tokens) return;
      await this.refresh(name, server, false, signal, account).catch(() => false);
    }));
  }

  /** The servers with `Authorization: Bearer …` for every signed-in remote
   * server whose token is still valid. Any Authorization header the user
   * typed is replaced for those servers only. Pure: never touches the
   * network, so it is safe on every path that lists mounts. An account
   * `accountFor` names that is not signed in sends no token: never the
   * default account's in its place. */
  withAuthHeaders<T extends Record<string, McpServerSpec>>(servers: T, accountFor?: McpAccountChooser): T {
    if (this.vault.unavailableReason()) return servers;
    const out: Record<string, McpServerSpec> = {};
    for (const [name, server] of Object.entries(servers)) {
      out[name] = server;
      if (!("url" in server)) continue;
      const record = this.record(name, server, accountFor?.(name) ?? DEFAULT_MCP_ACCOUNT);
      const access = this.bearerFor(record);
      const expiresAt = record?.tokens?.expiresAt;
      if (!access || (expiresAt !== undefined && expiresAt <= this.now())) continue;
      const headers: Record<string, string> = {};
      for (const [key, value] of Object.entries(server.headers)) {
        if (key.toLowerCase() !== "authorization") headers[key] = value;
      }
      headers.Authorization = `Bearer ${access}`;
      out[name] = { ...server, headers };
    }
    return out as T;
  }

  // ── sign-out ───────────────────────────────────────────────────────────

  /** Revoke what the server lets us revoke, then forget the tokens. The
   * discovery and a dynamic client stay, so signing in again is one click. */
  async disconnect(name: string, server: RemoteMcpSpec, outer?: AbortSignal, account: string = DEFAULT_MCP_ACCOUNT): Promise<void> {
    const record = this.record(name, server, account);
    if (!record) return;
    for (const [key, flow] of this.pending) if (flow.name === name && flow.account === account) this.pending.delete(key);
    await this.revoke(record, outer);
    // Another account is removed whole; the default one keeps its place.
    if (account !== DEFAULT_MCP_ACCOUNT) this.vault.set(name, undefined, account);
    else this.vault.set(name, { ...record, tokens: undefined, expired: false, lastError: undefined });
  }

  /** The server was removed or its address changed: forget every account. */
  async forget(name: string, outer?: AbortSignal): Promise<void> {
    this.memo.delete(name);
    for (const [key, flow] of this.pending) if (flow.name === name) this.pending.delete(key);
    const records = this.vault.accounts(name).map((account) => this.vault.get(name, account)).filter((record) => record !== undefined);
    if (!records.length) return;
    for (const record of records) await this.revoke(record, outer);
    this.vault.drop(name);
  }

  private async revoke(record: McpOAuthRecord, outer?: AbortSignal): Promise<void> {
    if (!record.revocationEndpoint || !record.client || !record.tokens) return;
    const signal = this.signal(outer);
    for (const [token, hint] of [[record.tokens.refresh, "refresh_token"], [record.tokens.access, "access_token"]] as const) {
      if (!token) continue;
      const form = new URLSearchParams({ token, token_type_hint: hint });
      const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded" };
      if (record.client.authMethod === "client_secret_basic" && record.client.secret) {
        headers.authorization = `Basic ${Buffer.from(`${encodeURIComponent(record.client.id)}:${encodeURIComponent(record.client.secret)}`).toString("base64")}`;
      } else {
        form.set("client_id", record.client.id);
        if (record.client.authMethod === "client_secret_post" && record.client.secret) form.set("client_secret", record.client.secret);
      }
      try {
        const response = await this.fetcher(record.revocationEndpoint, { method: "POST", headers, body: form.toString(), signal, redirect: "error" });
        await response.body?.cancel().catch(() => {});
      } catch {
        // Best effort: the local copy is deleted either way.
      }
    }
  }
}

function chooseSecretMethod(supported: string[] | undefined): "client_secret_post" | "client_secret_basic" {
  // RFC 8414: an absent list means client_secret_basic.
  if (!supported) return "client_secret_basic";
  if (supported.includes("client_secret_basic")) return "client_secret_basic";
  return "client_secret_post";
}

function hostOf(value: string): string | undefined {
  try {
    return new URL(value).host;
  } catch {
    return undefined;
  }
}

function fingerprint(server: RemoteMcpSpec): string {
  const headers = Object.entries(server.headers).sort(([a], [b]) => a.localeCompare(b));
  return createHash("sha256").update(JSON.stringify([server.type, server.url, headers])).digest("hex");
}

async function readJsonBody(response: Response): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = JSON.parse(await readBounded(response));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function oauthErrorSuffix(body: Record<string, unknown> | null): string {
  const code = body?.error;
  return typeof code === "string" && OAUTH_ERROR_CODE.test(code) ? ` (${code})` : "";
}

async function sleepMs(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return;
  if (signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError");
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("The operation was aborted.", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Exclusive file lock so two processes that share a vault never rotate the
 * same refresh token concurrently. Fail closed on an abandoned lock after
 * REFRESH_LOCK_WAIT_MS: the caller keeps tokens and tries again later. */
async function withRefreshLock<T>(path: string, work: () => Promise<T>): Promise<T> {
  mkdirSync(dirname(path), { recursive: true });
  const deadline = Date.now() + REFRESH_LOCK_WAIT_MS;
  let fd: number | undefined;
  while (fd === undefined) {
    try {
      fd = openSync(path, "wx", 0o600);
      writeSync(fd, String(process.pid));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (Date.now() >= deadline) throw new Error("refresh lock busy");
      await sleepMs(REFRESH_LOCK_POLL_MS);
    }
  }
  try {
    return await work();
  } finally {
    closeSync(fd);
    try {
      unlinkSync(path);
    } catch {
      /* already gone */
    }
  }
}

// ── probe and discovery ──────────────────────────────────────────────────

/** One unauthenticated (or bearer) request to the server: `initialize` over
 * streamable HTTP, or the GET that opens an SSE stream. */
export async function probeServer(
  fetcher: typeof fetch,
  server: RemoteMcpSpec,
  signal: AbortSignal,
  bearer?: string,
): Promise<ProbeOutcome> {
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(server.headers)) {
    if (bearer && key.toLowerCase() === "authorization") continue;
    headers[key] = value;
  }
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  let response: Response;
  try {
    response = server.type === "sse"
      ? await guardedFetch(server.url, { method: "GET", headers: { ...headers, accept: "text/event-stream" }, signal }, fetcher)
      : await guardedFetch(server.url, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json", accept: "application/json, text/event-stream", "MCP-Protocol-Version": PROTOCOL_VERSION },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "Sagax", version: "1" } },
        }),
        signal,
      }, fetcher);
  } catch {
    return { kind: "unreachable", error: "Could not reach this address. Check the URL and your network." };
  }
  await response.body?.cancel().catch(() => {});
  if (response.status !== 401 && response.status !== 403) return { kind: "open" };
  if (response.status === 403) {
    // 403 insufficient_scope still names the metadata; anything else is a
    // refusal a sign-in would not fix.
    const challenge = parseBearerChallenge(response.headers.get("www-authenticate"));
    if (!challenge) return { kind: "unauthorized", error: "The server answered HTTP 403. Check the address and headers." };
  }
  const challenge = parseBearerChallenge(response.headers.get("www-authenticate"));
  const discovered = await discover(fetcher, server.url, challenge, signal);
  if (!discovered) {
    return { kind: "unauthorized", error: `The server answered HTTP ${response.status} and does not offer OAuth sign-in. Check the headers.` };
  }
  return { kind: "oauth", discovered };
}

/** RFC 9728 then RFC 8414 / OIDC Discovery, as the MCP spec orders them.
 * Falls back to the 2025-03-26 behaviour (authorization server metadata at
 * the MCP server's own origin) when no resource metadata is published. */
export async function discover(
  fetcher: typeof fetch,
  serverUrl: string,
  challenge: Record<string, string> | null,
  signal: AbortSignal,
): Promise<DiscoveredAuth | null> {
  const server = new URL(serverUrl);
  const candidates: string[] = [];
  const hinted = safeEndpoint(challenge?.resource_metadata);
  if (hinted) candidates.push(hinted);
  for (const url of protectedResourceMetadataUrls(serverUrl)) if (!candidates.includes(url)) candidates.push(url);

  let resource = canonicalResource(serverUrl);
  let issuers: string[] = [];
  let scopes: string[] | undefined;
  for (const url of candidates) {
    const metadata = await fetchJson(fetcher, url, signal);
    if (!metadata) continue;
    const servers = stringList(metadata.authorization_servers)?.map(safeEndpoint).filter((entry): entry is string => Boolean(entry));
    if (!servers?.length) continue;
    // The metadata must describe this server, not some other resource a
    // token could then be minted for.
    if (typeof metadata.resource === "string") {
      try {
        const declared = new URL(metadata.resource);
        if (declared.origin !== server.origin) continue;
        resource = canonicalResource(metadata.resource);
      } catch {
        continue;
      }
    }
    issuers = servers;
    scopes = stringList(metadata.scopes_supported);
    break;
  }
  if (!issuers.length) issuers = [server.origin];

  for (const issuer of issuers) {
    for (const url of authorizationServerMetadataUrls(issuer)) {
      const metadata = await fetchJson(fetcher, url, signal);
      if (!metadata) continue;
      const authorizationEndpoint = safeEndpoint(metadata.authorization_endpoint);
      const tokenEndpoint = safeEndpoint(metadata.token_endpoint);
      if (!authorizationEndpoint || !tokenEndpoint) continue;
      const methods = stringList(metadata.code_challenge_methods_supported);
      // PKCE S256 is mandatory; a server that lists methods without it
      // cannot be signed in to safely.
      if (methods && !methods.includes("S256")) continue;
      const responseTypes = stringList(metadata.response_types_supported);
      if (responseTypes && !responseTypes.includes("code")) continue;
      const scope = challenge?.scope?.trim() || (scopes?.length ? scopes.join(" ") : undefined);
      return {
        resource,
        issuer: typeof metadata.issuer === "string" && safeEndpoint(metadata.issuer) ? metadata.issuer : issuer,
        authorizationEndpoint,
        tokenEndpoint,
        ...(safeEndpoint(metadata.registration_endpoint) ? { registrationEndpoint: safeEndpoint(metadata.registration_endpoint) } : {}),
        ...(safeEndpoint(metadata.revocation_endpoint) ? { revocationEndpoint: safeEndpoint(metadata.revocation_endpoint) } : {}),
        ...(stringList(metadata.token_endpoint_auth_methods_supported) ? { tokenAuthMethods: stringList(metadata.token_endpoint_auth_methods_supported) } : {}),
        ...(scope ? { scope } : {}),
      };
    }
  }
  return null;
}

// ── callback page ────────────────────────────────────────────────────────

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[char]!);
}

/** The small page the browser lands on. It tells same-origin app windows
 * the outcome (BroadcastChannel), then tries to close itself. */
export function callbackPage(result: CallbackResult, acceptLanguage: string | undefined): { html: string; nonce: string } {
  const french = /^\s*fr\b/i.test(acceptLanguage ?? "");
  const title = result.ok
    ? (french ? "Connexion terminée" : "Sign-in complete")
    : (french ? "La connexion a échoué" : "Sign-in failed");
  const body = result.ok
    ? (french ? "Connexion terminée, vous pouvez fermer cet onglet." : "Sign-in complete. You can close this tab.")
    : result.error;
  const nonce = base64url(randomBytes(16));
  const message = JSON.stringify({ type: "mcp-oauth", ok: result.ok, name: result.name ?? null }).replace(/</g, "\\u003c");
  const html = `<!doctype html>
<html lang="${french ? "fr" : "en"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>body{font:15px/1.5 system-ui,sans-serif;margin:0;display:grid;place-items:center;min-height:100vh;background:#f7f7f5;color:#1f1f1f}
@media (prefers-color-scheme:dark){body{background:#1b1b1b;color:#ececec}}main{max-width:420px;padding:24px;text-align:center}h1{font-size:18px;margin:0 0 8px}</style>
</head><body><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(body)}</p></main>
<script nonce="${nonce}">try{new BroadcastChannel("pulsa-mcp-oauth").postMessage(${message})}catch(e){}${result.ok ? "setTimeout(function(){window.close()},1200);" : ""}</script>
</body></html>`;
  return { html, nonce };
}
