// Provider-card access keys. File-backed driver variables are views of the
// common provider store; model and voice consumers share the same key.
// Organization requests are routed to the person's Perspicax account.
import { FILE_PROVIDER_ENV, PROVIDER_KEYS_FILE, ProviderKeysStore, type ProviderKeyScope } from "./provider-keys.ts";
import { resolveVaultKey, type VaultKeySource } from "./mcp/mcp-oauth.ts";

export const ENGINE_API_KEYS_FILE = PROVIDER_KEYS_FILE;

/** Hermes provider id → the variable that provider reads. The only place
 * those names are chosen; a save never invents a variable of its own. */
export const HERMES_PROVIDER_ENV = {
  openrouter: "OPENROUTER_API_KEY",
  glm: "GLM_API_KEY",
  zai: "ZAI_API_KEY",
} as const;

export type HermesProvider = keyof typeof HERMES_PROVIDER_ENV;

const PRINCIPAL = /^[a-z0-9][a-z0-9_-]{0,80}$/;

const FILE_DRIVERS: Record<string, { env: string } | { hermes: true }> = {
  cursorAgent: { env: "CURSOR_API_KEY" },
  droidAgent: { env: "FACTORY_API_KEY" },
  minimax: { env: "MINIMAX_API_KEY" },
  geminiAgent: { env: "GEMINI_API_KEY" },
  hermesAgent: { hermes: true },
};

export type EngineKeyTarget =
  | { kind: "config"; section: "openai" | "openrouter" | "openaiCompat" | "anthropic" | "xai" | "mistral" | "cerebras" | "opencodeGo"; field: "key" | "apiKey" }
  | { kind: "file"; env: string }
  | { kind: "file"; hermes: true };

export type EngineKeyScope =
  | { organization: false }
  | { organization: true; principalId: string | null };

export type EngineKeySource = () => VaultKeySource;

export class EngineKeyError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(message: string, status: number, code: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** The variable a Hermes provider reads, or null when the name is unknown.
 * An omitted provider is OpenRouter. */
export function hermesProviderEnv(provider: string | undefined): string | null {
  const name = (provider ?? "openrouter").trim().toLowerCase();
  if (!name) return HERMES_PROVIDER_ENV.openrouter;
  if (!Object.prototype.hasOwnProperty.call(HERMES_PROVIDER_ENV, name)) return null;
  return HERMES_PROVIDER_ENV[name as HermesProvider];
}

/** Where a pasted key for this instance is stored. Null when this card
 * must not take one (a subscription CLI, or the server's own Claude login). */
export function engineKeyTarget(instanceId: string, driver: string): EngineKeyTarget | null {
  if (instanceId === "openai") return { kind: "config", section: "openai", field: "key" };
  if (instanceId === "openrouter") return { kind: "config", section: "openrouter", field: "key" };
  if (instanceId === "claudeApi") return { kind: "config", section: "anthropic", field: "key" };
  if (instanceId === "xaiApi" || driver === "grok") return { kind: "config", section: "xai", field: "key" };
  if (driver === "mistral") return { kind: "config", section: "mistral", field: "key" };
  if (driver === "cerebras") return { kind: "config", section: "cerebras", field: "key" };
  if (driver === "opencodeGo" || instanceId === "opencodeGo") return { kind: "config", section: "opencodeGo", field: "apiKey" };
  if (driver === "openai-compat") return { kind: "config", section: "openaiCompat", field: "key" };
  const file = FILE_DRIVERS[driver];
  if (!file) return null;
  if ("hermes" in file) return { kind: "file", hermes: true };
  return { kind: "file", env: file.env };
}

/** Empty clears the key. Anything else is one line, 8 to 400 characters,
 * with no whitespace or control character. The value is never included in
 * an error. Checked by code point, not a control-character regex. */
export function normalizeEngineKey(raw: string): string {
  const key = raw.trim();
  if (!key) return "";
  let rejected = key.length < 8 || key.length > 400;
  for (let i = 0; !rejected && i < key.length; i += 1) {
    const code = key.charCodeAt(i);
    if (code <= 32 || code === 127) rejected = true;
  }
  if (rejected) {
    throw new EngineKeyError("Enter the access key as a single line, between 8 and 400 characters.", 400, "engine_key_shape");
  }
  return key;
}

/** Who this paste belongs to. An organization config key is the shared
 * fallback and is refused. An organization file key needs a person. */
export function engineKeyScope(organization: boolean, principalId: string | null, target: EngineKeyTarget): EngineKeyScope {
  if (organization && target.kind === "config") {
    throw new EngineKeyError("This provider's key is shared by the organization. Set it in Settings.", 403, "engine_key_shared");
  }
  if (!organization) return { organization: false };
  const id = principalId?.trim().toLowerCase() ?? "";
  if (!PRINCIPAL.test(id)) {
    throw new EngineKeyError("A provider key on an organization server belongs to one person.", 403, "engine_key_no_person");
  }
  return { organization: true, principalId: id };
}

type Store = Record<string, Record<string, string>>;

function allowedEnv(driver: string, envName: string): boolean {
  const file = FILE_DRIVERS[driver];
  if (!file) return false;
  if ("hermes" in file) return Object.values(HERMES_PROVIDER_ENV).includes(envName as (typeof HERMES_PROVIDER_ENV)[HermesProvider]);
  return envName === file.env;
}

function sourceFor(dataDir: string, source?: EngineKeySource): EngineKeySource {
  return source ?? (() => resolveVaultKey(dataDir));
}

function providerScope(scope: EngineKeyScope): ProviderKeyScope {
  if (!scope.organization) return {};
  const id = scope.principalId?.trim().toLowerCase() ?? "";
  if (!PRINCIPAL.test(id)) throw new EngineKeyError("A provider key on an organization server belongs to one person.", 403, "engine_key_no_person");
  return { principalId: id };
}

function readStore(dataDir: string, scope: EngineKeyScope, source: EngineKeySource, mode: "inject" | "strict"): Store {
  try {
    const where = providerScope(scope);
    const store = new ProviderKeysStore(dataDir, source);
    const keys = { ...(scope.organization ? store.legacy(where) : {}), ...store.keys(where) };
    const result: Store = {};
    for (const [driver, mapping] of Object.entries(FILE_PROVIDER_ENV)) {
      const row: Record<string, string> = {};
      for (const [env, provider] of Object.entries(mapping)) if (keys[provider]) row[env] = keys[provider];
      if (Object.keys(row).length) result[driver] = row;
    }
    return result;
  } catch (error) {
    if (mode === "inject") return {};
    if (error instanceof EngineKeyError) throw error;
    throw new EngineKeyError("The access key could not be saved. Try again.", 503, "store_unavailable");
  }
}

function writeStore(dataDir: string, scope: EngineKeyScope, store: Store, source: EngineKeySource): void {
  const patch: Record<string, string | null> = {};
  for (const [driver, mapping] of Object.entries(FILE_PROVIDER_ENV)) {
    for (const [env, provider] of Object.entries(mapping)) patch[provider] = store[driver]?.[env] ?? null;
  }
  try { new ProviderKeysStore(dataDir, source).patch(providerScope(scope), patch); }
  catch (error) {
    if (error instanceof EngineKeyError) throw error;
    throw new EngineKeyError("The access key could not be saved. Try again.", 503, "store_unavailable");
  }
}

/** Whether this person has any file-backed key for the driver. Never the
 * key itself. An unreadable store counts as none. */
export function fileKeyConfigured(dataDir: string, scope: EngineKeyScope, driver: string, source?: EngineKeySource): boolean {
  const row = readStore(dataDir, scope, sourceFor(dataDir, source), "inject")[driver];
  return Boolean(row && Object.values(row).some((value) => value.length > 0));
}

/** Save or clear one file-backed variable. An empty key removes it. */
export function writeFileEngineKey(
  dataDir: string,
  scope: EngineKeyScope,
  driver: string,
  envName: string,
  key: string,
  source?: EngineKeySource,
): void {
  if (!allowedEnv(driver, envName)) {
    throw new EngineKeyError("This provider does not take an access key here.", 404, "engine_key_unsupported");
  }
  const resolved = sourceFor(dataDir, source);
  const store = readStore(dataDir, scope, resolved, "strict");
  const row = { ...store[driver] };
  if (key) row[envName] = key;
  else delete row[envName];
  if (Object.keys(row).length) store[driver] = row;
  else delete store[driver];
  writeStore(dataDir, scope, store, resolved);
}

/** Put a saved file key on an environment only when that variable is empty.
 * Organization with no person injects nothing, even if a solo file exists.
 * Hermes is not injected here: its turn writes a private home instead. */
export function applyStoredEngineEnv(
  environment: Record<string, string | undefined>,
  driver: string,
  dataDir: string,
  scope: EngineKeyScope,
  source?: EngineKeySource,
): void {
  if (scope.organization && !scope.principalId?.trim()) return;
  const file = FILE_DRIVERS[driver];
  if (!file || "hermes" in file || environment[file.env]) return;
  const key = readStore(dataDir, scope, sourceFor(dataDir, source), "inject")[driver]?.[file.env];
  if (key) environment[file.env] = key;
}

/** The lines a Hermes turn may put in its private `.env`. Empty when there
 * is no person on an organization server, or the store cannot be opened. */
export function hermesManagedEnvText(dataDir: string, scope: EngineKeyScope, source?: EngineKeySource): string {
  const row = readStore(dataDir, scope, sourceFor(dataDir, source), "inject").hermesAgent ?? {};
  const lines: string[] = [];
  for (const name of Object.values(HERMES_PROVIDER_ENV)) {
    const value = row[name];
    if (value) lines.push(`${name}=${value}`);
  }
  return lines.length ? `${lines.join("\n")}\n` : "";
}

/** The config.json patch for a config-backed key. Empty clears it. */
export function configKeyPatch(target: Extract<EngineKeyTarget, { kind: "config" }>, key: string): Record<string, Record<string, string>> {
  return { [target.section]: { [target.field]: key } };
}
