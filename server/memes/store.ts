// Sealed meme provider key (#2121): AES-256-GCM like web-search. Solo:
// `<data>/memes.enc`. Organization: `principals/<id>/memes.enc`. The key is
// read only when the server calls Tenor or GIPHY; settings views never see it.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";

import {
  isMemeProvider,
  type MemeProviderId,
  type MemeSettingsView,
} from "../../shared/memes.ts";
import { writeFileAtomic } from "../atomic.ts";
import { resolveVaultKey, type VaultKeySource } from "../mcp/mcp-oauth.ts";

export const MEMES_FILE = "memes.enc";
const AAD = Buffer.from("sagax memes v1");
const PRINCIPAL = /^[a-z0-9][a-z0-9_-]{0,80}$/;

export type MemeScope = { organization: false } | { organization: true; principalId: string };
export type MemeKeySource = () => VaultKeySource;

export interface MemeConfig {
  provider: MemeProviderId;
  key?: string;
}

export class MemeStoreError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(message: string, status: number, code: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const UNAVAILABLE = "The meme settings could not be saved. Try again.";

export function memeScope(organization: boolean, principalId: string | null | undefined): MemeScope | null {
  if (!organization) return { organization: false };
  const id = principalId?.trim().toLowerCase() ?? "";
  return PRINCIPAL.test(id) ? { organization: true, principalId: id } : null;
}

function storePath(dataDir: string, scope: MemeScope): string {
  return scope.organization ? join(dataDir, "principals", scope.principalId, MEMES_FILE) : join(dataDir, MEMES_FILE);
}

function refuseSymlink(path: string): void {
  try {
    if (lstatSync(path).isSymbolicLink()) throw new MemeStoreError(UNAVAILABLE, 503, "store_unavailable");
  } catch (error) {
    if (error instanceof MemeStoreError) throw error;
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new MemeStoreError(UNAVAILABLE, 503, "store_unavailable");
  }
}

function vaultKey(source: MemeKeySource): Buffer {
  const got = source();
  if (got.kind !== "key") throw new MemeStoreError(UNAVAILABLE, 503, "store_unavailable");
  return got.key;
}

function parseConfig(value: unknown): MemeConfig | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (!isMemeProvider(row.provider)) return null;
  return {
    provider: row.provider,
    ...(typeof row.key === "string" && row.key ? { key: row.key } : {}),
  };
}

function seal(config: MemeConfig, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(AAD);
  const data = Buffer.concat([cipher.update(JSON.stringify({ version: 1, config }), "utf8"), cipher.final()]);
  return JSON.stringify({ v: 1, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64") });
}

function open(raw: string, key: Buffer): MemeConfig | null {
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

function read(dataDir: string, scope: MemeScope, source: MemeKeySource, mode: "quiet" | "strict"): MemeConfig | null {
  const path = storePath(dataDir, scope);
  let raw: string;
  try {
    refuseSymlink(path);
    raw = readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" || mode === "quiet") return null;
    throw error instanceof MemeStoreError ? error : new MemeStoreError(UNAVAILABLE, 503, "store_unavailable");
  }
  try {
    return open(raw, vaultKey(source));
  } catch (error) {
    if (mode === "quiet") return null;
    throw error instanceof MemeStoreError ? error : new MemeStoreError(UNAVAILABLE, 503, "store_unavailable");
  }
}

export function readyConfig(config: MemeConfig | null): boolean {
  return Boolean(config?.provider && config.key);
}

export function viewOf(config: MemeConfig | null): MemeSettingsView {
  return {
    provider: config?.provider ?? null,
    keyConfigured: Boolean(config?.key),
    last4: config?.key && config.key.length >= 12 ? config.key.slice(-4) : null,
    ready: readyConfig(config),
  };
}

export interface MemeStore {
  config(scope: MemeScope): MemeConfig | null;
  view(scope: MemeScope): MemeSettingsView;
  ready(scope: MemeScope): boolean;
  save(scope: MemeScope, input: { provider: MemeProviderId; key?: string }): MemeSettingsView;
  remove(scope: MemeScope): void;
}

export function createMemeStore(dataDir: string, source?: MemeKeySource): MemeStore {
  const keySource = source ?? (() => resolveVaultKey(dataDir));
  return {
    config: (scope) => read(dataDir, scope, keySource, "quiet"),
    view: (scope) => viewOf(read(dataDir, scope, keySource, "quiet")),
    ready: (scope) => readyConfig(read(dataDir, scope, keySource, "quiet")),
    save(scope, input) {
      const before = read(dataDir, scope, keySource, "strict");
      const keepKey = input.key === undefined && before?.provider === input.provider ? before.key : undefined;
      const key = input.key !== undefined ? input.key : keepKey;
      const config: MemeConfig = {
        provider: input.provider,
        ...(key ? { key } : {}),
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
