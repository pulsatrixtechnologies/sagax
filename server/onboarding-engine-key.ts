// The access key a terminal / CLI onboarding saves for an OpenAI-compatible
// instance.
//
// The wizard used to write it as plaintext into config.json (owner-only, but
// in clear). It is sealed here instead, with the same vault key as the MCP
// OAuth store and the file-backed engine keys (resolveVaultKey): on the
// desktop that key comes from the operating system's encrypted credential
// store (safeStorage, handed over as SAGAX_MCP_OAUTH_KEY); on a headless or
// CLI-only host, where safeStorage is unavailable, it is a 0600 key file
// beside the data directory. Either way the key leaves config.json.
//
// AES-256-GCM, AAD `sagax onboarding-engine-key v1`, file mode 0600,
// `<data>/onboarding-engine-keys.enc`, keyed by instance id. The plaintext
// never goes into a log, a bot prompt, a backup, an answer, or config.json.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import { writeFileAtomic } from "./atomic.ts";
import { resolveVaultKey, type VaultKeySource } from "./mcp-oauth.ts";
import { parseJson, type JsonObject, type JsonValue } from "./schema.ts";

export const ONBOARDING_ENGINE_KEYS_FILE = "onboarding-engine-keys.enc";

const AAD = Buffer.from("sagax onboarding-engine-key v1");
// The ids the wizard creates (`api-<uuid8>`) and the built-in / reused ids it
// may reuse (`openai`, `codex-1a2b3c4d`, …). Narrow enough to be a safe file
// key, wide enough for every instance id the setup can save.
const INSTANCE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export type OnboardingKeySource = () => VaultKeySource;

export class OnboardingKeyError extends Error {}

type Keys = Record<string, string>;

function sourceFor(dataDir: string, source?: OnboardingKeySource): OnboardingKeySource {
  return source ?? (() => resolveVaultKey(dataDir));
}

function vaultKey(source: OnboardingKeySource): Buffer {
  const got = source();
  if (got.kind !== "key") {
    throw new OnboardingKeyError("The access key could not be saved. Try again.");
  }
  return got.key;
}

function storePath(dataDir: string): string {
  return join(dataDir, ONBOARDING_ENGINE_KEYS_FILE);
}

function refuseSymlink(path: string): void {
  try {
    if (lstatSync(path).isSymbolicLink()) {
      throw new OnboardingKeyError("The access key could not be saved. Try again.");
    }
  } catch (error) {
    if (error instanceof OnboardingKeyError) throw error;
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new OnboardingKeyError("The access key could not be saved. Try again.");
    }
  }
}

function parseKeys(value: unknown): Keys {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Keys = {};
  for (const [id, key] of Object.entries(value as Record<string, unknown>)) {
    if (INSTANCE_ID.test(id) && typeof key === "string" && key) out[id] = key;
  }
  return out;
}

function openKeys(raw: string, key: Buffer): Keys {
  const envelope = JSON.parse(raw) as { v?: unknown; iv?: unknown; tag?: unknown; data?: unknown };
  if (envelope.v !== 1 || typeof envelope.iv !== "string" || typeof envelope.tag !== "string" || typeof envelope.data !== "string") {
    throw new Error("format");
  }
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64"));
  decipher.setAAD(AAD);
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
  const plain = Buffer.concat([decipher.update(Buffer.from(envelope.data, "base64")), decipher.final()]).toString("utf8");
  const parsed = JSON.parse(plain) as { version?: unknown; keys?: unknown };
  if (parsed.version !== 1) throw new Error("format");
  return parseKeys(parsed.keys);
}

function sealKeys(keys: Keys, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(AAD);
  const data = Buffer.concat([cipher.update(JSON.stringify({ version: 1, keys }), "utf8"), cipher.final()]);
  return JSON.stringify({ v: 1, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64") });
}

/** The whole map, or `{}` when the file is missing or cannot be opened — a
 * turn or a boot never breaks because a key could not be read. */
export function readOnboardingEngineKeys(dataDir: string, source?: OnboardingKeySource): Keys {
  const path = storePath(dataDir);
  let raw: string;
  try {
    if (lstatSync(path).isSymbolicLink()) return {};
    raw = readFileSync(path, "utf8");
  } catch {
    return {};
  }
  try {
    return openKeys(raw, vaultKey(sourceFor(dataDir, source)));
  } catch {
    return {};
  }
}

/** One instance's key, or undefined. Never throws. */
export function readOnboardingEngineKey(dataDir: string, instanceId: string, source?: OnboardingKeySource): string | undefined {
  if (!INSTANCE_ID.test(instanceId)) return undefined;
  const key = readOnboardingEngineKeys(dataDir, source)[instanceId];
  return key && key.length ? key : undefined;
}

/** Seal or clear one instance's key. An empty key removes it. Throws when the
 * vault key is unavailable or the file is not writable, so a caller fails
 * closed rather than falling back to plaintext. */
export function storeOnboardingEngineKey(dataDir: string, instanceId: string, key: string, source?: OnboardingKeySource): void {
  if (!INSTANCE_ID.test(instanceId)) {
    throw new OnboardingKeyError("The access key could not be saved. Try again.");
  }
  const resolved = sourceFor(dataDir, source);
  const vault = vaultKey(resolved);
  const path = storePath(dataDir);
  refuseSymlink(path);
  let keys: Keys = {};
  if (existsSync(path)) {
    try {
      keys = openKeys(readFileSync(path, "utf8"), vault);
    } catch {
      // A store we cannot open must not be silently overwritten and its other
      // keys lost; refuse, the same as the file-backed engine store does.
      throw new OnboardingKeyError("The access key could not be saved. Try again.");
    }
  }
  if (key) keys[instanceId] = key;
  else delete keys[instanceId];
  if (!Object.keys(keys).length) {
    rmSync(path, { force: true });
    return;
  }
  mkdirSync(dataDir, { recursive: true });
  writeFileAtomic(path, `${sealKeys(keys, vault)}\n`, { mode: 0o600 });
}

/** A sentence for the wizard that says where the key went, without ever
 * printing it. The desktop uses the OS credential store; a headless host uses
 * a 0600 file. */
export function onboardingKeyStorageNote(): string {
  const osEncrypted = Boolean(process.env.SAGAX_MCP_OAUTH_KEY?.trim());
  if (osEncrypted) {
    return "Your API key is stored encrypted in this computer's operating-system credential store, not in config.json.";
  }
  return "Your API key is stored encrypted beside your data (file permissions owner-only, 0600), not in config.json. Keep this folder and its backups private.";
}

/** One-time heal: move every plaintext OpenAI-compatible instance key out of
 * config.json into the sealed store, and strip it from the file. Fail-safe —
 * a key the store cannot accept is left exactly where it is, never lost, and
 * the move is idempotent across boots. Returns how many keys were moved;
 * never the keys themselves. Built-in provider instances (openai, openrouter)
 * hold no inline key and are skipped. Only on a solo server. */
export function migrateConfigPlaintextKeys(
  dataDir: string,
  builtInInstanceIds: readonly string[],
  source?: OnboardingKeySource,
): number {
  const path = join(dataDir, "config.json");
  if (!existsSync(path)) return 0;
  let raw: JsonValue;
  try {
    raw = parseJson(readFileSync(path, "utf8"));
  } catch {
    return 0;
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return 0;
  const doc = raw as JsonObject;
  const instances = doc.instances;
  if (!instances || typeof instances !== "object" || Array.isArray(instances)) return 0;
  const found: Array<{ id: string; key: string }> = [];
  for (const [id, entry] of Object.entries(instances as Record<string, JsonValue>)) {
    if (!INSTANCE_ID.test(id) || builtInInstanceIds.includes(id)) continue;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const row = entry as JsonObject;
    if (row.driver !== "openai-compat") continue;
    const config = row.config;
    if (!config || typeof config !== "object" || Array.isArray(config)) continue;
    const key = (config as JsonObject).key;
    if (typeof key === "string" && key) found.push({ id, key });
  }
  if (!found.length) return 0;
  // Seal first (the key is safe in the vault before it leaves config.json);
  // an unavailable vault aborts the whole move, leaving every plaintext key in
  // place for a later boot to heal.
  const resolved = sourceFor(dataDir, source);
  try {
    for (const { id, key } of found) storeOnboardingEngineKey(dataDir, id, key, resolved);
  } catch {
    return 0;
  }
  for (const { id } of found) {
    const row = (instances as Record<string, JsonObject>)[id]!;
    const config = { ...(row.config as JsonObject) };
    delete config.key;
    row.config = config;
  }
  try {
    writeFileAtomic(path, JSON.stringify(doc, null, 2), { mode: 0o600 });
  } catch {
    // The keys are already sealed; a file we could not rewrite is healed again
    // on the next boot (storeOnboardingEngineKey overwrites the same ids).
    return 0;
  }
  return found.length;
}
