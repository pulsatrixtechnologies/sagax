// A person's own voice keys on an organization server (#1098, 2026-10-28,
// shared/person-voice-keys.ts). One file per person,
// `principals/<id>/voice-keys.enc`, sealed with the vault key
// (AES-256-GCM, AAD `sagax voice-keys v1`, server/mcp/mcp-oauth.ts
// resolveVaultKey), mode 0600: the treatment of the person's web search key
// (server/web-search/store.ts). Read back only by the server, at the moment
// of a speech call; the settings view and the logs only learn whether one
// is saved and its last four characters.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";

import {
  isPersonalVoiceKeyProvider,
  PERSONAL_VOICE_KEY_PROVIDERS,
  type PersonalVoiceKeyProvider,
  type PersonalVoiceKeysView,
} from "../../shared/person-voice-keys.ts";
import { writeFileAtomic } from "../atomic.ts";
import type { AppConfig } from "../config.ts";
import { resolveVaultKey, type VaultKeySource } from "../mcp/mcp-oauth.ts";

export const PERSON_VOICE_KEYS_FILE = "voice-keys.enc";
const AAD = Buffer.from("sagax voice-keys v1");
const PRINCIPAL = /^[a-z0-9][a-z0-9_-]{0,80}$/;
const UNAVAILABLE = "Your voice keys could not be saved. Try again.";

export type PersonalVoiceKeys = Partial<Record<PersonalVoiceKeyProvider, string>>;

export class PersonVoiceKeysError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

/** The person's id as a file name, or null. */
export function personVoiceKeysPrincipal(principalId: string | null | undefined): string | null {
  const id = principalId?.trim().toLowerCase() ?? "";
  return PRINCIPAL.test(id) ? id : null;
}

/** A key as pasted: one line, no spaces, 8 to 400 characters. */
export function normalizeVoiceKey(raw: unknown): string {
  if (typeof raw !== "string") throw new PersonVoiceKeysError("key must be a string.");
  const key = raw.trim();
  let rejected = key.length < 8 || key.length > 400;
  for (let i = 0; !rejected && i < key.length; i += 1) {
    const code = key.charCodeAt(i);
    if (code <= 32 || code === 127) rejected = true;
  }
  if (rejected) throw new PersonVoiceKeysError("Enter the key as a single line, between 8 and 400 characters.");
  return key;
}

function parse(value: unknown): PersonalVoiceKeys {
  const keys: PersonalVoiceKeys = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return keys;
  for (const [provider, key] of Object.entries(value as Record<string, unknown>)) {
    if (isPersonalVoiceKeyProvider(provider) && typeof key === "string" && key) keys[provider] = key;
  }
  return keys;
}

function seal(keys: PersonalVoiceKeys, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(AAD);
  const data = Buffer.concat([cipher.update(JSON.stringify({ version: 1, keys }), "utf8"), cipher.final()]);
  return JSON.stringify({ v: 1, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64") });
}

function open(raw: string, key: Buffer): PersonalVoiceKeys {
  const envelope = JSON.parse(raw) as { v?: unknown; iv?: unknown; tag?: unknown; data?: unknown };
  if (envelope.v !== 1 || typeof envelope.iv !== "string" || typeof envelope.tag !== "string" || typeof envelope.data !== "string") throw new Error("format");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64"));
  decipher.setAAD(AAD);
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
  const plain = Buffer.concat([decipher.update(Buffer.from(envelope.data, "base64")), decipher.final()]).toString("utf8");
  const parsed = JSON.parse(plain) as { version?: unknown; keys?: unknown };
  if (parsed.version !== 1) throw new Error("format");
  return parse(parsed.keys);
}

export function voiceKeysView(keys: PersonalVoiceKeys): PersonalVoiceKeysView {
  const view = {} as PersonalVoiceKeysView;
  for (const provider of PERSONAL_VOICE_KEY_PROVIDERS) {
    const key = keys[provider];
    view[provider] = { configured: Boolean(key), last4: key && key.length >= 12 ? key.slice(-4) : null };
  }
  return view;
}

export class PersonVoiceKeysStore {
  private readonly dataDir: string;
  private readonly keySource: () => VaultKeySource;

  constructor(dataDir: string, keySource?: () => VaultKeySource) {
    this.dataDir = dataDir;
    this.keySource = keySource ?? (() => resolveVaultKey(dataDir));
  }

  private path(principalId: string): string {
    return join(this.dataDir, "principals", principalId, PERSON_VOICE_KEYS_FILE);
  }

  private vaultKey(): Buffer {
    const got = this.keySource();
    if (got.kind !== "key") throw new PersonVoiceKeysError(UNAVAILABLE, 503);
    return got.key;
  }

  private refuseSymlink(path: string): void {
    try {
      if (lstatSync(path).isSymbolicLink()) throw new PersonVoiceKeysError(UNAVAILABLE, 503);
    } catch (error) {
      if (error instanceof PersonVoiceKeysError) throw error;
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new PersonVoiceKeysError(UNAVAILABLE, 503);
    }
  }

  /** The saved keys, for a speech call only. A missing or unreadable file is none. */
  keys(principalId: string): PersonalVoiceKeys {
    const path = this.path(principalId);
    try {
      this.refuseSymlink(path);
      return open(readFileSync(path, "utf8"), this.vaultKey());
    } catch {
      return {};
    }
  }

  view(principalId: string): PersonalVoiceKeysView {
    return voiceKeysView(this.keys(principalId));
  }

  /** `key` null forgets that provider's key. */
  set(principalId: string, provider: PersonalVoiceKeyProvider, key: string | null): PersonalVoiceKeysView {
    const next = { ...this.keys(principalId) };
    if (key === null) delete next[provider];
    else next[provider] = key;
    const path = this.path(principalId);
    this.refuseSymlink(path);
    if (Object.keys(next).length === 0) {
      rmSync(path, { force: true });
      return voiceKeysView(next);
    }
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileAtomic(path, `${seal(next, this.vaultKey())}\n`, { mode: 0o600 });
    return voiceKeysView(next);
  }
}

/** The installation's voice settings with the person's own keys in place of
 * the organization's for the same engine. The engine, its voice and its
 * other settings stay the installation's. */
export function withPersonalVoiceKeys(cfg: AppConfig, keys: PersonalVoiceKeys): AppConfig {
  // OpenAI's key serves voice mode only (server/voice/voice-mode.ts providerKeys),
  // never the installation's engines
  if (!keys.elevenlabs && !keys.fish && !keys.xai) return cfg;
  return {
    ...cfg,
    ...(keys.elevenlabs || keys.fish
      ? { tts: { ...cfg.tts, ...(keys.elevenlabs ? { key: keys.elevenlabs } : {}), ...(keys.fish ? { fishKey: keys.fish } : {}) } as AppConfig["tts"] }
      : {}),
    ...(keys.xai ? { xai: { ...cfg.xai, key: keys.xai } as AppConfig["xai"] } : {}),
  };
}
