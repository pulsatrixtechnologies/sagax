// A person's provider keys, independent of whether a model or voice uses
// them. Solo uses this sealed server store. An organization imports its
// legacy files into Perspicax before removing the local copies.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { writeFileAtomic } from "../atomic.ts";
import { resolveVaultKey, type VaultKeySource } from "../mcp/mcp-oauth.ts";

export const PROVIDER_KEYS_FILE = "provider-keys.enc";
const AAD = "sagax provider-keys v1";
const PRINCIPAL = /^[a-z0-9][a-z0-9_-]{0,80}$/;
const PROVIDER = /^[a-z][a-z0-9-]{0,40}(?::[A-Za-z0-9][A-Za-z0-9_-]{0,63})?$/;
const UNAVAILABLE = "Your provider keys could not be saved. Try again.";

/** The legacy driver's variable and its provider now share one mapping. */
export const FILE_PROVIDER_ENV: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  cursorAgent: { CURSOR_API_KEY: "cursor" },
  droidAgent: { FACTORY_API_KEY: "factory" },
  minimax: { MINIMAX_API_KEY: "minimax" },
  geminiAgent: { GEMINI_API_KEY: "google" },
  hermesAgent: { OPENROUTER_API_KEY: "openrouter", GLM_API_KEY: "glm", ZAI_API_KEY: "zai" },
};

export type ProviderKeyValues = Record<string, string>;
export type ProviderKeyScope = { principalId?: string };

export class ProviderKeysError extends Error {
  readonly status = 503;
  constructor() { super(UNAVAILABLE); }
}

export class ProviderKeysStore {
  private readonly dataDir: string;
  private readonly source: () => VaultKeySource;
  constructor(dataDir: string, source: () => VaultKeySource = () => resolveVaultKey(dataDir)) {
    this.dataDir = dataDir;
    this.source = source;
  }

  private home(scope: ProviderKeyScope): string {
    if (scope.principalId === undefined) return this.dataDir;
    if (!PRINCIPAL.test(scope.principalId)) throw new ProviderKeysError();
    return join(this.dataDir, "principals", scope.principalId);
  }

  private key(): Buffer {
    const source = this.source();
    if (source.kind !== "key") throw new ProviderKeysError();
    return source.key;
  }

  private read(path: string, aad: string): Record<string, unknown> | null {
    try {
      if (lstatSync(path).isSymbolicLink()) throw new ProviderKeysError();
      const raw = JSON.parse(readFileSync(path, "utf8"));
      if (raw.v !== 1 || typeof raw.iv !== "string" || typeof raw.tag !== "string" || typeof raw.data !== "string") throw new ProviderKeysError();
      const decipher = createDecipheriv("aes-256-gcm", this.key(), Buffer.from(raw.iv, "base64"));
      decipher.setAAD(Buffer.from(aad));
      decipher.setAuthTag(Buffer.from(raw.tag, "base64"));
      const plain = Buffer.concat([decipher.update(Buffer.from(raw.data, "base64")), decipher.final()]);
      const parsed = JSON.parse(plain.toString("utf8"));
      if (parsed.version !== 1 || !parsed.keys || typeof parsed.keys !== "object" || Array.isArray(parsed.keys)) throw new ProviderKeysError();
      return parsed.keys;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw new ProviderKeysError();
    }
  }

  private parse(raw: Record<string, unknown> | null): ProviderKeyValues {
    return Object.fromEntries(Object.entries(raw ?? {}).filter((entry): entry is [string, string] => PROVIDER.test(entry[0]) && typeof entry[1] === "string" && Boolean(entry[1])));
  }

  private write(scope: ProviderKeyScope, keys: ProviderKeyValues): void {
    const path = join(this.home(scope), PROVIDER_KEYS_FILE);
    try {
      if (lstatSync(path).isSymbolicLink()) throw new ProviderKeysError();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new ProviderKeysError();
    }
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key(), iv);
    cipher.setAAD(Buffer.from(AAD));
    const data = Buffer.concat([cipher.update(JSON.stringify({ version: 1, keys }), "utf8"), cipher.final()]);
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileAtomic(path, JSON.stringify({ v: 1, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64") }), { mode: 0o600 });
  }

  /** All old stores must be readable before any of them can be retired. */
  legacy(scope: ProviderKeyScope): ProviderKeyValues {
    const home = this.home(scope);
    const keys: ProviderKeyValues = {};
    const engines = this.read(join(home, "engine-api-keys.enc"), "sagax engine-api-keys v1");
    for (const [driver, mapping] of Object.entries(FILE_PROVIDER_ENV)) {
      const row = engines?.[driver];
      if (!row || typeof row !== "object" || Array.isArray(row)) continue;
      for (const [env, provider] of Object.entries(mapping)) {
        const key = (row as Record<string, unknown>)[env];
        if (typeof key === "string" && key) keys[provider] = key;
      }
    }
    const voice = this.parse(this.read(join(home, "voice-keys.enc"), "sagax voice-keys v1"));
    for (const provider of ["elevenlabs", "fish", "xai", "openai"]) if (voice[provider]) keys[provider] ??= voice[provider];
    if (scope.principalId === undefined) {
      const onboarding = this.read(join(home, "onboarding-engine-keys.enc"), "sagax onboarding-engine-key v1");
      for (const [id, key] of Object.entries(onboarding ?? {})) {
        if (typeof key !== "string" || !key || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(id)) continue;
        keys[id === "openai" || id === "openrouter" ? id : `compat:${id}`] = key;
      }
    }
    return keys;
  }

  /** Call only after the destination has durably acknowledged every key. */
  retireLegacy(scope: ProviderKeyScope): void {
    const home = this.home(scope);
    for (const file of ["engine-api-keys.enc", "voice-keys.enc", ...(scope.principalId === undefined ? ["onboarding-engine-keys.enc"] : [])]) rmSync(join(home, file), { force: true });
  }

  retireImported(scope: ProviderKeyScope): void {
    if (scope.principalId === undefined) throw new ProviderKeysError();
    this.retireLegacy(scope);
    rmSync(join(this.home(scope), PROVIDER_KEYS_FILE), { force: true });
  }

  keys(scope: ProviderKeyScope = {}): ProviderKeyValues {
    const path = join(this.home(scope), PROVIDER_KEYS_FILE);
    const current = this.parse(this.read(path, AAD));
    // On an organization server the destination is Perspicax, never another
    // local store. Its caller uses legacy() and retires after remote import.
    if (scope.principalId !== undefined) return current;
    const legacy = this.legacy(scope);
    if (["engine-api-keys.enc", "voice-keys.enc", "onboarding-engine-keys.enc"].some((file) => existsSync(join(this.home(scope), file)))) {
      const next = { ...legacy, ...current };
      this.write(scope, next);
      this.retireLegacy(scope);
      return next;
    }
    return current;
  }

  set(scope: ProviderKeyScope, provider: string, key: string | null): void {
    this.patch(scope, { [provider]: key });
  }

  patch(scope: ProviderKeyScope, patch: Record<string, string | null>): void {
    const next = this.keys(scope);
    for (const [provider, key] of Object.entries(patch)) {
      if (!PROVIDER.test(provider)) throw new ProviderKeysError();
      if (key === null) delete next[provider];
      else next[provider] = key;
    }
    this.write(scope, next);
  }
}
