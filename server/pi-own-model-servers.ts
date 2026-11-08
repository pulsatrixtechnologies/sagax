// #2983: a person's own model servers for pi, kept by Sagax itself. Each is
// an OpenAI-compatible endpoint (oMLX, Ollama, LM Studio on this machine, or
// a remote one) with an optional key and the models it answered with at its
// last test. A server becomes the pi provider `px-own-<id>` exactly as a
// Perspicax personal server does (drivers/pi-model-servers.ts): models.json
// names it, its key rides the turn's environment only.
//
// Solo keeps them in DATA_DIR; on an organization server each member keeps
// their own under principals/<id>, sealed like the provider keys, so one
// person's servers and keys never reach another's turn or picker.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { writeFileAtomic } from "./atomic.ts";
import { resolveVaultKey, type VaultKeySource } from "./mcp/mcp-oauth.ts";
import {
  MODEL_SERVER_DEFAULT_CONTEXT,
  MODEL_SERVER_DEFAULT_MAX_TOKENS,
  modelServerProvider,
  type ModelServer,
} from "./drivers/pi-model-servers.ts";

export const PI_OWN_MODEL_SERVERS_FILE = "pi-model-servers.enc";
const AAD = "sagax pi-model-servers v1";
const PRINCIPAL = /^[a-z0-9][a-z0-9_-]{0,80}$/;
const ID = /^sx-[a-f0-9]{10}$/;
const MODEL_ID = /^[^\s\p{Cc}]{1,200}$/u;
export const MAX_OWN_SERVERS = 16;
const MAX_MODELS = 256;
const PROBE_TIMEOUT_MS = 8000;

export interface OwnModel {
  id: string;
  /** What the server reported, when it did (vLLM max_model_len, LM Studio, oMLX). */
  contextWindow?: number;
}

export interface OwnModelServer {
  id: string;
  name: string;
  url: string;
  key?: string;
  models: OwnModel[];
  /** ISO time of the last successful test. */
  checkedAt?: string;
}

/** What the person's browser sees: never the key, only whether one is saved. */
export interface OwnModelServerView {
  id: string;
  name: string;
  url: string;
  configured: boolean;
  models: OwnModel[];
  checkedAt?: string;
  /** The pi provider id the picker rows start with (advanced detail). */
  provider: string;
}

export type OwnServerScope = { principalId?: string };

export class PiOwnModelServersError extends Error {
  readonly status = 503;
  constructor() { super("Your model servers could not be saved. Try again."); }
}

function positiveInt(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 100_000_000 ? value : undefined;
}

function parseModels(raw: unknown): OwnModel[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: OwnModel[] = [];
  for (const row of raw) {
    const id = row && typeof row === "object" ? (row as Record<string, unknown>).id : undefined;
    if (typeof id !== "string" || !MODEL_ID.test(id) || seen.has(id)) continue;
    seen.add(id);
    const contextWindow = positiveInt((row as Record<string, unknown>).contextWindow);
    out.push({ id, ...(contextWindow ? { contextWindow } : {}) });
    if (out.length >= MAX_MODELS) break;
  }
  return out;
}

function parseRecord(raw: unknown): OwnModelServer | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  if (typeof row.id !== "string" || !ID.test(row.id) || typeof row.name !== "string" || typeof row.url !== "string") return null;
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    ...(typeof row.key === "string" && row.key ? { key: row.key } : {}),
    models: parseModels(row.models),
    ...(typeof row.checkedAt === "string" ? { checkedAt: row.checkedAt } : {}),
  };
}

export function newOwnServerId(): string {
  return `sx-${randomBytes(5).toString("hex")}`;
}

export function isOwnServerId(id: string): boolean {
  return ID.test(id);
}

export class PiOwnModelServersStore {
  private readonly dataDir: string;
  private readonly source: () => VaultKeySource;
  private readonly cache = new Map<string, OwnModelServer[]>();
  constructor(dataDir: string, source: () => VaultKeySource = () => resolveVaultKey(dataDir)) {
    this.dataDir = dataDir;
    this.source = source;
  }

  private path(scope: OwnServerScope): string {
    if (scope.principalId === undefined) return join(this.dataDir, PI_OWN_MODEL_SERVERS_FILE);
    if (!PRINCIPAL.test(scope.principalId)) throw new PiOwnModelServersError();
    return join(this.dataDir, "principals", scope.principalId, PI_OWN_MODEL_SERVERS_FILE);
  }

  private key(): Buffer {
    const source = this.source();
    if (source.kind !== "key") throw new PiOwnModelServersError();
    return source.key;
  }

  /** The person's servers, keys included (server side only). */
  list(scope: OwnServerScope): OwnModelServer[] {
    const path = this.path(scope);
    const cached = this.cache.get(path);
    if (cached) return cached;
    let servers: OwnModelServer[] = [];
    try {
      if (lstatSync(path).isSymbolicLink()) throw new PiOwnModelServersError();
      const raw = JSON.parse(readFileSync(path, "utf8"));
      if (raw.v !== 1 || typeof raw.iv !== "string" || typeof raw.tag !== "string" || typeof raw.data !== "string") throw new PiOwnModelServersError();
      const decipher = createDecipheriv("aes-256-gcm", this.key(), Buffer.from(raw.iv, "base64"));
      decipher.setAAD(Buffer.from(AAD));
      decipher.setAuthTag(Buffer.from(raw.tag, "base64"));
      const parsed = JSON.parse(Buffer.concat([decipher.update(Buffer.from(raw.data, "base64")), decipher.final()]).toString("utf8"));
      if (parsed.version !== 1 || !Array.isArray(parsed.servers)) throw new PiOwnModelServersError();
      servers = parsed.servers.map(parseRecord).filter((server: OwnModelServer | null): server is OwnModelServer => server !== null);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new PiOwnModelServersError();
    }
    this.cache.set(path, servers);
    return servers;
  }

  save(scope: OwnServerScope, servers: OwnModelServer[]): void {
    const path = this.path(scope);
    try {
      if (lstatSync(path).isSymbolicLink()) throw new PiOwnModelServersError();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new PiOwnModelServersError();
    }
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key(), iv);
    cipher.setAAD(Buffer.from(AAD));
    const data = Buffer.concat([cipher.update(JSON.stringify({ version: 1, servers }), "utf8"), cipher.final()]);
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileAtomic(path, JSON.stringify({ v: 1, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64") }), { mode: 0o600 });
    this.cache.set(path, servers);
  }
}

export function ownServerProvider(id: string): string {
  return modelServerProvider({ instanceId: id, scope: "personal" });
}

export function ownServerView(server: OwnModelServer): OwnModelServerView {
  return {
    id: server.id,
    name: server.name,
    url: server.url,
    configured: Boolean(server.key),
    models: server.models,
    ...(server.checkedAt ? { checkedAt: server.checkedAt } : {}),
    provider: ownServerProvider(server.id),
  };
}

/** The servers as pi model servers (scope personal: `px-own-<id>`). A
 * server whose test found no model offers nothing yet and is left out. */
export function ownModelServers(servers: readonly OwnModelServer[]): ModelServer[] {
  return servers.filter((server) => server.models.length > 0).map((server) => ({
    instanceId: server.id,
    name: server.name,
    url: server.url,
    protocol: "openai" as const,
    scope: "personal" as const,
    apiKey: server.key ?? "",
    models: server.models.map((model) => ({
      id: model.id,
      label: model.id,
      contextWindow: model.contextWindow ?? MODEL_SERVER_DEFAULT_CONTEXT,
      maxTokens: MODEL_SERVER_DEFAULT_MAX_TOKENS,
      reasoning: true,
      input: ["text" as const],
    })),
  }));
}

/** Perspicax's servers first; one of ours with the same pi provider id is
 * dropped, so a provider is never written twice. */
export function mergeModelServers(first: readonly ModelServer[], second: readonly ModelServer[]): ModelServer[] {
  const seen = new Set(first.map((server) => modelServerProvider(server)));
  return [...first, ...second.filter((server) => !seen.has(modelServerProvider(server)))];
}

export type ProbeResult = { ok: true; models: OwnModel[] } | { ok: false; error: string };

/** Ask an OpenAI-compatible server for its models (GET <url>/models). */
export async function probeModelServer(url: string, key: string | undefined, fetchImpl: typeof fetch = fetch): Promise<ProbeResult> {
  const base = url.replace(/\/+$/, "");
  let response: Response;
  try {
    response = await fetchImpl(`${base}/models`, {
      headers: { accept: "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) },
      redirect: "error",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
  } catch (error) {
    const name = (error as Error)?.name;
    return { ok: false, error: name === "TimeoutError" || name === "AbortError" ? "The server did not answer in time." : "The server could not be reached at this address." };
  }
  if (response.status === 401 || response.status === 403) return { ok: false, error: "The server refused the key." };
  if (!response.ok) return { ok: false, error: `The server answered ${response.status}. Check that the address ends with /v1.` };
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, error: "The server did not answer with a model list. Check that the address ends with /v1." };
  }
  const rows = body && typeof body === "object" && Array.isArray((body as Record<string, unknown>).data) ? (body as { data: unknown[] }).data : null;
  if (!rows) return { ok: false, error: "The server did not answer with a model list. Check that the address ends with /v1." };
  const models = parseModels(rows.map((row) => {
    if (!row || typeof row !== "object") return null;
    const entry = row as Record<string, unknown>;
    const contextWindow = positiveInt(entry.context_length) ?? positiveInt(entry.max_model_len) ?? positiveInt(entry.context_window) ?? positiveInt(entry.max_context_length);
    return { id: entry.id, ...(contextWindow ? { contextWindow } : {}) };
  }));
  return { ok: true, models };
}
