// #4973: the Claude models an account really offers, read live from
// Anthropic with that account's own key or sign-in. A model the account
// gains (a new release, a gated family such as Mythos) shows up without a
// code change; the written list (STATIC_CLAUDE_MODELS) only adds what the
// app knows about a model it lists (effort levels, context sizes) and serves
// while no live list could be read.
//
// Sources, merged in this order:
// - GET /v1/models (paged): every model the key or sign-in may call, with
//   its display name, context size and effort levels;
// - a subscription's GET /api/claude_cli/bootstrap `additional_model_options`:
//   models Claude Code offers that account beyond the public list.
// No value of a key or token ever leaves this module.
import { existsSync, readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import type { EffortLevel, ModelCatalog } from "../../contracts.ts";
import { CLAUDE_KEYCHAIN_SERVICE, decodeKeychainSecret, readDarwinClaudeKeychain } from "../../usage/plan-usage.ts";
import { claudeAccessFrom } from "../../cloud-agents/subscription-access.ts";
import { resolveClaudeConfigDir } from "./config.ts";

export const ANTHROPIC_API_BASE = "https://api.anthropic.com";
export const CLAUDE_MODELS_TIMEOUT_MS = 8_000;
/** How long a live list serves before the next read of the catalog reads it again. */
export const CLAUDE_MODELS_TTL_MS = 10 * 60_000;
const OAUTH_BETA = "oauth-2025-04-20";
const MAX_PAGES = 10;
const MODEL_ID = /^[a-z0-9][a-z0-9._-]{0,159}$/i;
const EFFORT_ORDER: EffortLevel[] = ["low", "medium", "high", "xhigh", "max"];

/** How a read signs in: an API key, or a bearer (a gateway token, or a
 * Claude sign-in's access token when `oauth`). */
export type ClaudeModelsAuth =
  | { kind: "key"; key: string }
  | { kind: "bearer"; token: string; oauth: boolean };

type Option = ModelCatalog["options"][number];

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** The effort levels a /v1/models row says the model takes: `[]` when it
 * takes none, undefined when the row does not say. */
function rowEfforts(row: Record<string, unknown>): EffortLevel[] | undefined {
  const effort = record(record(row.capabilities)?.effort);
  if (!effort || typeof effort.supported !== "boolean") return undefined;
  if (!effort.supported) return [];
  const levels = EFFORT_ORDER.filter((level) => record(effort[level])?.supported === true);
  return levels.length ? levels : undefined;
}

/** A row the account can no longer call (retired) is left out. */
function retired(row: Record<string, unknown>, now: number): boolean {
  if (row.lifecycle === "retired") return true;
  const at = typeof row.retires_at === "string" ? Date.parse(row.retires_at) : NaN;
  return Number.isFinite(at) && at <= now;
}

/** One catalog row from a live row, with what the written list knows about
 * the same model. A dated id (`claude-haiku-4-5-20251001`) whose undated
 * alias is in the written list keeps the alias: saved bots, health and the
 * models turned off by hand name it that way. */
function liveOption(row: Record<string, unknown>, known: Map<string, Option>): Option | null {
  const raw = typeof row.id === "string" ? row.id.trim() : "";
  if (!MODEL_ID.test(raw)) return null;
  const dated = /^(.+)-\d{8}$/.exec(raw)?.[1];
  const id = dated && known.has(dated) && !known.has(raw) ? dated : raw;
  const base = known.get(id);
  const label = typeof row.display_name === "string" && row.display_name.trim() ? row.display_name.trim() : base?.label ?? id;
  const window = typeof row.max_input_tokens === "number" && Number.isFinite(row.max_input_tokens) && row.max_input_tokens > 0
    ? Math.floor(row.max_input_tokens) : undefined;
  const efforts = rowEfforts(row);
  const option: Option = { ...base, id, label };
  if (window !== undefined) {
    option.contextWindow = window;
    // Claude Code runs a 1M model with the 200K window too (#4417).
    if (!base?.contextWindows && window >= 1_000_000) option.contextWindows = [200_000, window];
    else if (base?.contextWindows && !base.contextWindows.includes(window)) delete option.contextWindows;
  }
  if (efforts !== undefined) option.effortLevels = efforts;
  delete option.custom;
  return option;
}

/** Claude Code's extra rows for a subscription: `{ value | id | model, label | name | displayName }`. */
function extraOption(value: unknown, known: Map<string, Option>): Option | null {
  if (typeof value === "string") return MODEL_ID.test(value) ? { ...known.get(value), id: value, label: known.get(value)?.label ?? value } : null;
  const row = record(value);
  if (!row) return null;
  const id = [row.value, row.id, row.model].find((candidate): candidate is string => typeof candidate === "string" && MODEL_ID.test(candidate));
  if (!id) return null;
  const label = [row.label, row.displayName, row.display_name, row.name].find((candidate): candidate is string => typeof candidate === "string" && candidate.trim() !== "");
  return { ...known.get(id), id, label: label?.trim() ?? known.get(id)?.label ?? id };
}

/** The live catalog from the rows read: newest first as Anthropic lists
 * them, the extras after. Null when nothing usable came back (the caller
 * keeps the list it had). Pure. */
export function claudeCatalogFromLive(
  rows: readonly unknown[],
  extras: readonly unknown[],
  metadata: ModelCatalog,
  now: number = Date.now(),
): ModelCatalog | null {
  const known = new Map(metadata.options.map((option) => [option.id, option]));
  const options: Option[] = [];
  const seen = new Set<string>();
  const add = (option: Option | null) => {
    if (!option || seen.has(option.id)) return;
    seen.add(option.id);
    options.push(option);
  };
  for (const value of rows) {
    const row = record(value);
    if (row && !retired(row, now)) add(liveOption(row, known));
  }
  for (const value of extras) add(extraOption(value, known));
  if (!options.length) return null;
  return { default: seen.has(metadata.default) ? metadata.default : options[0]!.id, options };
}

function headers(auth: ClaudeModelsAuth): Record<string, string> {
  const base = { "anthropic-version": "2023-06-01", accept: "application/json" };
  if (auth.kind === "key") return { ...base, "x-api-key": auth.key };
  return { ...base, authorization: `Bearer ${auth.token}`, ...(auth.oauth ? { "anthropic-beta": OAUTH_BETA } : {}) };
}

export interface ReadClaudeModelsOptions {
  baseUrl?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  now?: () => number;
}

/** Read the account's live list. Null when it cannot be read (no network,
 * a refused key, an empty answer): the caller keeps what it had. */
export async function readClaudeAccountModels(
  auth: ClaudeModelsAuth,
  metadata: ModelCatalog,
  options: ReadClaudeModelsOptions = {},
): Promise<ModelCatalog | null> {
  const fetchImpl = options.fetch ?? fetch;
  const base = (options.baseUrl ?? ANTHROPIC_API_BASE).replace(/\/+$/, "");
  const timeout = options.timeoutMs ?? CLAUDE_MODELS_TIMEOUT_MS;
  const get = async (path: string): Promise<Record<string, unknown> | null> => {
    const response = await fetchImpl(`${base}${path}`, { headers: headers(auth), redirect: "error", signal: AbortSignal.timeout(timeout) });
    if (!response.ok) return null;
    return record(await response.json());
  };
  try {
    const rows: unknown[] = [];
    let after: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const body = await get(`/v1/models?limit=1000${after ? `&after_id=${encodeURIComponent(after)}` : ""}`);
      if (!body) return null;
      const data = Array.isArray(body.data) ? body.data : [];
      rows.push(...data);
      const last = typeof body.last_id === "string" ? body.last_id : undefined;
      if (body.has_more !== true || !last || last === after) break;
      after = last;
    }
    let extras: unknown[] = [];
    if (auth.kind === "bearer" && auth.oauth) {
      // Best effort: the extra rows a subscription gets in Claude Code.
      const boot = await get("/api/claude_cli/bootstrap").catch(() => null);
      if (Array.isArray(boot?.additional_model_options)) extras = boot.additional_model_options;
    }
    return claudeCatalogFromLive(rows, extras, metadata, options.now?.() ?? Date.now());
  } catch {
    return null;
  }
}

function readSmallFile(path: string): string | null {
  try {
    if (!existsSync(path)) return null;
    const stat = statSync(path);
    if (!stat.isFile() || stat.size > 1_000_000) return null;
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

/** The keychain item Claude Code keeps a login directory's sign-in in: the
 * plain name for the default directory, the hashed one for any other. */
export function claudeLoginKeychainService(loginDir: string, env: NodeJS.ProcessEnv): string {
  let defaultDir: string | null = null;
  try {
    const withoutConfig = { ...env };
    delete withoutConfig.CLAUDE_CONFIG_DIR;
    defaultDir = resolveClaudeConfigDir(undefined, withoutConfig);
  } catch {
    defaultDir = null;
  }
  const resolved = resolve(loginDir);
  if (defaultDir !== null && resolved === resolve(defaultDir)) return CLAUDE_KEYCHAIN_SERVICE;
  return `${CLAUDE_KEYCHAIN_SERVICE}-${createHash("sha256").update(resolved).digest("hex").slice(0, 8)}`;
}

export interface ClaudeAuthSources {
  readFile?: (path: string) => string | null;
  /** macOS keychain, read only; null off macOS. */
  readKeychain?: ((service: string) => Promise<string | null>) | null;
  now?: () => number;
}

/** A sign-in's access token from a Claude login directory (its
 * `.credentials.json`, or on macOS its keychain item). Null when there is
 * none, or it has expired (Claude Code renews it on its next turn). */
export async function claudeLoginAuth(loginDir: string, env: NodeJS.ProcessEnv, sources: ClaudeAuthSources = {}): Promise<ClaudeModelsAuth | null> {
  const readFile = sources.readFile ?? readSmallFile;
  const keychain = sources.readKeychain === undefined ? (process.platform === "darwin" ? readDarwinClaudeKeychain : null) : sources.readKeychain;
  let access = claudeAccessFrom(readFile(join(loginDir, ".credentials.json")));
  if (!access && keychain) {
    try {
      access = claudeAccessFrom(decodeKeychainSecret(await keychain(claudeLoginKeychainService(loginDir, env))));
    } catch {
      access = null;
    }
  }
  if (!access) return null;
  if (access.expiresAt !== null && access.expiresAt <= (sources.now?.() ?? Date.now())) return null;
  return { kind: "bearer", token: access.accessToken, oauth: true };
}

const nonEmpty = (value: string | undefined) => (typeof value === "string" && value.trim() ? value.trim() : undefined);

/** How a Claude Code environment signs in, in Claude Code's own order: an
 * API key, a gateway token, an OAuth token, then the login directory.
 * `baseUrl` is set only for Anthropic's own API: an Anthropic-compatible
 * host keeps the list it was given (null). */
export async function claudeEnvironmentAuth(
  env: NodeJS.ProcessEnv,
  configDir: string | undefined,
  sources: ClaudeAuthSources = {},
): Promise<{ auth: ClaudeModelsAuth; baseUrl: string } | null> {
  const baseUrl = nonEmpty(env.ANTHROPIC_BASE_URL)?.replace(/\/+$/, "") ?? ANTHROPIC_API_BASE;
  if (baseUrl !== ANTHROPIC_API_BASE) return null;
  const key = nonEmpty(env.ANTHROPIC_API_KEY);
  if (key) return { auth: { kind: "key", key }, baseUrl };
  const gateway = nonEmpty(env.ANTHROPIC_AUTH_TOKEN);
  if (gateway) return { auth: { kind: "bearer", token: gateway, oauth: false }, baseUrl };
  const oauth = nonEmpty(env.CLAUDE_CODE_OAUTH_TOKEN);
  if (oauth) return { auth: { kind: "bearer", token: oauth, oauth: true }, baseUrl };
  let dir: string;
  try {
    dir = resolveClaudeConfigDir(configDir, env);
  } catch {
    return null;
  }
  const login = await claudeLoginAuth(dir, env, sources);
  return login ? { auth: login, baseUrl } : null;
}

/** A stable, non-secret name for an auth (the per-account cache key). */
export function claudeAuthKey(auth: ClaudeModelsAuth): string {
  return auth.kind === "key" ? `key:${auth.key}` : `${auth.oauth ? "oauth" : "bearer"}:${auth.token}`;
}
