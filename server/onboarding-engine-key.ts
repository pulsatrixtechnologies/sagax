// CLI onboarding reads and writes the common provider-key store. The
// previous onboarding-engine-keys.enc is imported by ProviderKeysStore;
// custom instance keys remain isolated under compat:<instance id>.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ProviderKeysStore, PROVIDER_KEYS_FILE } from "./provider-keys.ts";

import { writeFileAtomic } from "./atomic.ts";
import { resolveVaultKey, type VaultKeySource } from "./mcp/mcp-oauth.ts";
import { parseJson, type JsonObject, type JsonValue } from "./schema.ts";

export const ONBOARDING_ENGINE_KEYS_FILE = PROVIDER_KEYS_FILE;

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

function providerFor(instanceId: string): string {
  return instanceId === "openai" || instanceId === "openrouter" ? instanceId : `compat:${instanceId}`;
}

/** Legacy callers read the same provider store as every other consumer. */
export function readOnboardingEngineKeys(dataDir: string, source?: OnboardingKeySource): Keys {
  try {
    const keys = new ProviderKeysStore(dataDir, source).keys();
    return Object.fromEntries(Object.entries(keys).flatMap(([provider, key]) =>
      provider === "openai" || provider === "openrouter" ? [[provider, key]]
        : provider.startsWith("compat:") ? [[provider.slice(7), key]] : []));
  } catch { return {}; }
}

export function readOnboardingEngineKey(dataDir: string, instanceId: string, source?: OnboardingKeySource): string | undefined {
  if (!INSTANCE_ID.test(instanceId)) return undefined;
  return readOnboardingEngineKeys(dataDir, source)[instanceId];
}

export function storeOnboardingEngineKey(dataDir: string, instanceId: string, key: string, source?: OnboardingKeySource): void {
  if (!INSTANCE_ID.test(instanceId)) throw new OnboardingKeyError("The access key could not be saved. Try again.");
  try { new ProviderKeysStore(dataDir, source).set({}, providerFor(instanceId), key || null); }
  catch { throw new OnboardingKeyError("The access key could not be saved. Try again."); }
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
