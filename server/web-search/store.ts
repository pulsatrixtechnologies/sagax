// The person's web search settings (2026-10-26): provider, SearXNG address
// and key, sealed with the vault key (AES-256-GCM, AAD
// `sagax web-search v1`, the key from server/mcp/mcp-oauth.ts resolveVaultKey:
// the OS credential store on the desktop, a 0600 key file on a headless
// server), mode 0600, the same treatment as server/engine-api-keys.ts.
// Solo: `<data>/web-search.enc`. Organization: one file per person,
// `principals/<id>/web-search.enc`. The key is read back only by the server,
// at the moment of the HTTP call (server/web-search/providers.ts); the
// settings view, the bot and the logs only ever learn whether one is saved.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";

import { isWebSearchProvider, WEB_SEARCH_PROVIDER_INFO, type WebSearchProviderId, type WebSearchSettingsView } from "../../shared/web-search.ts";
import { writeFileAtomic } from "../atomic.ts";
import { resolveVaultKey, type VaultKeySource } from "../mcp/mcp-oauth.ts";
import type { WebSearchConfig } from "./providers.ts";

export const WEB_SEARCH_FILE = "web-search.enc";
const AAD = Buffer.from("sagax web-search v1");
const PRINCIPAL = /^[a-z0-9][a-z0-9_-]{0,80}$/;

export type WebSearchScope = { organization: false } | { organization: true; principalId: string };
export type WebSearchKeySource = () => VaultKeySource;

export class WebSearchStoreError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(message: string, status: number, code: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const UNAVAILABLE = "The web search settings could not be saved. Try again.";

/** Who these settings belong to; an organization needs a person. */
export function webSearchScope(organization: boolean, principalId: string | null | undefined): WebSearchScope | null {
  if (!organization) return { organization: false };
  const id = principalId?.trim().toLowerCase() ?? "";
  return PRINCIPAL.test(id) ? { organization: true, principalId: id } : null;
}

function storePath(dataDir: string, scope: WebSearchScope): string {
  return scope.organization ? join(dataDir, "principals", scope.principalId, WEB_SEARCH_FILE) : join(dataDir, WEB_SEARCH_FILE);
}

function refuseSymlink(path: string): void {
  try {
    if (lstatSync(path).isSymbolicLink()) throw new WebSearchStoreError(UNAVAILABLE, 503, "store_unavailable");
  } catch (error) {
    if (error instanceof WebSearchStoreError) throw error;
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new WebSearchStoreError(UNAVAILABLE, 503, "store_unavailable");
  }
}

function vaultKey(source: WebSearchKeySource): Buffer {
  const got = source();
  if (got.kind !== "key") throw new WebSearchStoreError(UNAVAILABLE, 503, "store_unavailable");
  return got.key;
}

function parseConfig(value: unknown): WebSearchConfig | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (!isWebSearchProvider(row.provider)) return null;
  return {
    provider: row.provider,
    ...(typeof row.key === "string" && row.key ? { key: row.key } : {}),
    ...(typeof row.baseUrl === "string" && row.baseUrl ? { baseUrl: row.baseUrl } : {}),
  };
}

function seal(config: WebSearchConfig, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(AAD);
  const data = Buffer.concat([cipher.update(JSON.stringify({ version: 1, config }), "utf8"), cipher.final()]);
  return JSON.stringify({ v: 1, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64") });
}

function open(raw: string, key: Buffer): WebSearchConfig | null {
  const envelope = JSON.parse(raw) as { v?: unknown; iv?: unknown; tag?: unknown; data?: unknown };
  if (envelope.v !== 1 || typeof envelope.iv !== "string" || typeof envelope.tag !== "string" || typeof envelope.data !== "string") throw new Error("format");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64"));
  decipher.setAAD(AAD);
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
  const plain = Buffer.concat([decipher.update(Buffer.from(envelope.data, "base64")), decipher.final()]).toString("utf8");
  const parsed = JSON.parse(plain) as { version?: unknown; config?: unknown };
  if (parsed.version !== 1) throw new Error("format");
  return parseConfig(parsed.config);
}

/** `quiet`: a missing or unreadable file is "nothing saved" (a turn still
 * starts). `strict`: a file that cannot be opened refuses the change. */
function read(dataDir: string, scope: WebSearchScope, source: WebSearchKeySource, mode: "quiet" | "strict"): WebSearchConfig | null {
  const path = storePath(dataDir, scope);
  let raw: string;
  try {
    refuseSymlink(path);
    raw = readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" || mode === "quiet") return null;
    throw error instanceof WebSearchStoreError ? error : new WebSearchStoreError(UNAVAILABLE, 503, "store_unavailable");
  }
  try {
    return open(raw, vaultKey(source));
  } catch (error) {
    if (mode === "quiet") return null;
    throw error instanceof WebSearchStoreError ? error : new WebSearchStoreError(UNAVAILABLE, 503, "store_unavailable");
  }
}

export interface WebSearchStore {
  /** The saved settings, key included: for the HTTP call only. */
  config(scope: WebSearchScope): WebSearchConfig | null;
  /** What the settings page and the bot may know. Never the key. */
  view(scope: WebSearchScope): WebSearchSettingsView;
  /** Searches can run for this person (a provider with its key or address). */
  ready(scope: WebSearchScope): boolean;
  /** Save. `key` undefined keeps the saved one when the provider is the same. */
  save(scope: WebSearchScope, input: { provider: WebSearchProviderId; key?: string; baseUrl?: string }): WebSearchSettingsView;
  remove(scope: WebSearchScope): void;
}

export function readyConfig(config: WebSearchConfig | null): boolean {
  if (!config) return false;
  const info = WEB_SEARCH_PROVIDER_INFO[config.provider];
  if (info.keyRequired && !config.key) return false;
  if (info.baseUrl && !config.baseUrl) return false;
  return true;
}

export function viewOf(config: WebSearchConfig | null): WebSearchSettingsView {
  return {
    provider: config?.provider ?? null,
    baseUrl: config?.baseUrl ?? null,
    keyConfigured: Boolean(config?.key),
    last4: config?.key && config.key.length >= 12 ? config.key.slice(-4) : null,
    ready: readyConfig(config),
  };
}

export function createWebSearchStore(dataDir: string, source?: WebSearchKeySource): WebSearchStore {
  const keySource = source ?? (() => resolveVaultKey(dataDir));
  return {
    config: (scope) => read(dataDir, scope, keySource, "quiet"),
    view: (scope) => viewOf(read(dataDir, scope, keySource, "quiet")),
    ready: (scope) => readyConfig(read(dataDir, scope, keySource, "quiet")),
    save(scope, input) {
      const before = read(dataDir, scope, keySource, "strict");
      const keepKey = input.key === undefined && before?.provider === input.provider ? before.key : undefined;
      const key = input.key !== undefined ? input.key : keepKey;
      const config: WebSearchConfig = {
        provider: input.provider,
        ...(key ? { key } : {}),
        ...(WEB_SEARCH_PROVIDER_INFO[input.provider].baseUrl && input.baseUrl ? { baseUrl: input.baseUrl } : {}),
      };
      const path = storePath(dataDir, scope);
      refuseSymlink(path);
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      writeFileAtomic(path, `${seal(config, vaultKey(keySource))}\n`, { mode: 0o600 });
      return viewOf(config);
    },
    remove(scope) {
      const path = storePath(dataDir, scope);
      refuseSymlink(path);
      rmSync(path, { force: true });
    },
  };
}
