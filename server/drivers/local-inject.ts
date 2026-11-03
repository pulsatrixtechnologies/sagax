// Shared local-host inject — the sidecar workflow, inside the picker.
// Probe oMLX / Ollama / EXO / LM Studio / Unsloth, list whatever they
// serve under Custom on every agent, and decode a pick back into a host
// + API id the selected driver can inject.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import type { ModelCatalog } from "../contracts.ts";
import { desktopModelApiKey } from "../desktop/desktop-model-grant.ts";
import { isDesktopHostId } from "../../shared/desktop-local-models.ts";
import { localModelLabels, withServerHints } from "../../shared/local-model-engines.ts";

export interface LocalHost {
  id: string;
  label: string;
  baseUrl: string;
  apiKey?: string;
  apiKeyEnv?: string;
}

export const LOCAL_HOSTS: LocalHost[] = [
  // The same loopback servers the desktop probes (shared/desktop-local-models.ts SEED_ENDPOINTS).
  { id: "dwarfstar", label: "DwarfStar", baseUrl: "http://127.0.0.1:8002/v1" },
  { id: "llamaserver", label: "llama-server", baseUrl: "http://127.0.0.1:9337/v1" },
  { id: "bonsai", label: "Bonsai", baseUrl: "http://127.0.0.1:9338/v1" },
  { id: "omlx", label: "oMLX", baseUrl: "http://127.0.0.1:8080/v1", apiKey: "omlx" },
  { id: "ollama", label: "Ollama", baseUrl: "http://127.0.0.1:11434/v1", apiKey: "ollama" },
  { id: "local_ollama", label: "Ollama", baseUrl: "http://127.0.0.1:11434/v1", apiKey: "ollama" },
  { id: "exo", label: "EXO", baseUrl: "http://127.0.0.1:52415/v1", apiKey: "exo" },
  { id: "lmstudio", label: "LM Studio", baseUrl: "http://127.0.0.1:1234/v1", apiKey: "lm-studio" },
  { id: "unsloth", label: "Unsloth", baseUrl: "http://127.0.0.1:8888/v1", apiKeyEnv: "UNSLOTH_STUDIO_AUTH_TOKEN" },
  { id: "unsloth_api", label: "Unsloth", baseUrl: "http://127.0.0.1:8888/v1", apiKeyEnv: "UNSLOTH_STUDIO_AUTH_TOKEN" },
];

export const INJECT_SEP = "::";

const HOST_BY_ID = new Map(LOCAL_HOSTS.map((host) => [host.id, host]));
/** Desktop hosts. The base URL is always this server's loopback proxy. */
const DESKTOP_HOSTS = new Map<string, LocalHost>();
const MODEL_ID = /^[\w][\w./:+-]*$/;

let desktopInjectModels: () => InjectedModel[] = () => [];

function hostById(id: string): LocalHost | undefined {
  return HOST_BY_ID.get(id) ?? DESKTOP_HOSTS.get(id);
}

/** Rows the organization server adds for connected desktops. Empty unless that server set a loader. */
export function setDesktopInjectModels(load: () => InjectedModel[]): void {
  desktopInjectModels = load;
}

/**
 * Register a desktop inject host. The base URL must already be this server's
 * proxy (`http://127.0.0.1:<proxy>/d/<id>/v1`). A Mac address or any other
 * host is refused, so a desktop id cannot become an open redirect.
 */
export function upsertDesktopInjectHost(host: LocalHost): void {
  if (!isDesktopHostId(host.id)) throw new Error("desktop host id refused");
  let url: URL;
  try { url = new URL(host.baseUrl); } catch { throw new Error("desktop host url refused"); }
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1") throw new Error("desktop host url refused");
  if (url.username || url.password || url.search || url.hash) throw new Error("desktop host url refused");
  if (!url.port) throw new Error("desktop host url refused");
  const path = url.pathname.replace(/\/$/, "");
  if (path !== `/d/${host.id}/v1`) throw new Error("desktop host url refused");
  DESKTOP_HOSTS.set(host.id, { id: host.id, label: host.label, baseUrl: `http://127.0.0.1:${url.port}/d/${host.id}/v1` });
}

export function removeDesktopInjectHost(id: string): void {
  DESKTOP_HOSTS.delete(id);
}

export function clearDesktopInjectHosts(): void {
  DESKTOP_HOSTS.clear();
}

/** True for a desktop inject id even when that host is not registered right now. */
export function isDesktopInjectModel(id: string | null | undefined): boolean {
  if (!id) return false;
  const sep = id.indexOf(INJECT_SEP);
  if (sep <= 0) return false;
  return isDesktopHostId(id.slice(0, sep)) && MODEL_ID.test(id.slice(sep + INJECT_SEP.length));
}

export interface InjectedModel {
  id: string;
  host: string;
  model: string;
  label: string;
  /** In VRAM / running on the host right now — Custom pins these first. */
  loaded?: boolean;
  /** the host's own word on the model's context window (Ollama reports it
   * for running models in /api/ps) — sizes the model-facing rebuild instead
   * of guessing from the name */
  contextWindow?: number;
  /** Desktop rows: the desktop probed this server and /v1/messages answers. */
  anthropic?: boolean;
  /** The server's label, only when two servers of this computer expose the
   * same model name (a quiet sub-line, never a prefix). */
  server?: string;
  /** Desktop rows from another person's computer: that person's display name. */
  sharedBy?: string;
}

/** Ollama's /api/ps lists running models with their context_length; a
 * small model's real window matters more than a big one's — an 8k model
 * guessed at 32k gets a rebuild it cannot hold. */
export function contextWindowsFromPs(extra: unknown): Map<string, number> {
  const out = new Map<string, number>();
  const rec = extra && typeof extra === "object" ? (extra as { models?: unknown }) : null;
  if (!rec || !Array.isArray(rec.models)) return out;
  for (const m of rec.models) {
    if (!m || typeof m !== "object") continue;
    const row = m as { name?: unknown; model?: unknown; context_length?: unknown };
    const id = typeof row.model === "string" ? row.model : typeof row.name === "string" ? row.name : null;
    const ctx = typeof row.context_length === "number" && Number.isFinite(row.context_length) && row.context_length > 0 ? row.context_length : null;
    if (id && ctx) {
      out.set(id, ctx);
      const baseId = id.split(":")[0]!;
      const current = out.get(baseId);
      out.set(baseId, current === undefined ? ctx : Math.min(current, ctx));
    }
  }
  return out;
}

export function encodeInjectId(host: string, model: string): string {
  return `${host}${INJECT_SEP}${model}`;
}

export function decodeInjectId(id: string | null | undefined): { host: string; model: string } | null {
  if (!id) return null;
  const sep = id.indexOf(INJECT_SEP);
  if (sep <= 0) return null;
  const host = id.slice(0, sep);
  const model = id.slice(sep + INJECT_SEP.length);
  if (!hostById(host) || !MODEL_ID.test(model)) return null;
  return { host, model };
}

/** A model served by a local or computer-shared server (`host::model`),
 * whether or not that host is registered right now: a computer that went
 * offline drops its host, and its failures are still a local model's. */
export function isLocalModelId(id: string | null | undefined): boolean {
  if (!id) return false;
  const sep = id.indexOf(INJECT_SEP);
  if (sep <= 0) return false;
  const host = id.slice(0, sep);
  return (HOST_BY_ID.has(host) || DESKTOP_HOSTS.has(host) || isDesktopHostId(host)) && MODEL_ID.test(id.slice(sep + INJECT_SEP.length));
}

export function localHost(id: string): LocalHost | undefined {
  return hostById(id);
}

export function injectedApiModel(id: string | null | undefined): string | null {
  return decodeInjectId(id)?.model ?? null;
}

/**
 * Map a picker / leftover API id onto a live `host::model` inject id.
 * Claude Code's settings.model is the last slug it used (e.g.
 * `orcarouter/Qwen3.8-27B-Uncensored-GGUF`) and is not host-encoded, so a
 * Custom pick of that leftover would otherwise skip inject and demand /login.
 */
export function resolveInjectId(
  modelId: string | null | undefined,
  extras: readonly InjectedModel[],
): string | null | undefined {
  if (!modelId) return modelId;
  if (decodeInjectId(modelId)) return modelId;
  const matches = extras.filter((row) => row.id === modelId || row.model === modelId);
  const match = matches.find((row) => row.loaded) ?? matches[0];
  return match?.id ?? modelId;
}

/** Anthropic-compatible base (Claude Code wants this without a trailing /v1). */
export function anthropicBaseUrl(host: LocalHost): string {
  return host.baseUrl.replace(/\/v1\/?$/, "");
}

export function hostApiKey(host: LocalHost, env: Record<string, string | undefined> = process.env): string {
  if (isDesktopHostId(host.id)) return desktopModelApiKey();
  if (host.apiKeyEnv && env[host.apiKeyEnv]) return env[host.apiKeyEnv]!;
  if (host.apiKey) return host.apiKey;
  if (host.id === "unsloth" || host.id === "unsloth_api") {
    const fromFile = readUnslothKey(env);
    if (fromFile) return fromFile;
  }
  return "local";
}

const CODEX_RESERVED_PROVIDERS = new Set(["openai", "ollama", "lmstudio"]);

/**
 * Configure the custom local providers on the Codex app-server without
 * rewriting the user's config.toml. Provider secrets ride in the child
 * environment; argv only contains the corresponding environment key name.
 */
export function codexLocalProviderArgs(
  env: Record<string, string | undefined>,
  modelId: string | null | undefined,
): string[] {
  const inject = decodeInjectId(modelId);
  if (!inject || CODEX_RESERVED_PROVIDERS.has(inject.host)) return [];
  const host = localHost(inject.host);
  if (!host) return [];
  const envKey = `SAGAX_LOCAL_${host.id.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_API_KEY`;
  env[envKey] = hostApiKey(host, env);
  return [
    "-c",
    `model_providers.${host.id}.name=${JSON.stringify(host.label)}`,
    "-c",
    `model_providers.${host.id}.base_url=${JSON.stringify(host.baseUrl)}`,
    "-c",
    `model_providers.${host.id}.env_key=${JSON.stringify(envKey)}`,
  ];
}

function firstUnslothToken(row: unknown): string | null {
  if (!row || typeof row !== "object") return null;
  const rec = row as { minted?: unknown; saved?: unknown; api_key?: unknown };
  for (const bucket of [rec.minted, rec.saved]) {
    if (typeof bucket === "string" && bucket) return bucket;
    if (Array.isArray(bucket)) {
      const token = bucket.find((value) => typeof value === "string" && value);
      if (typeof token === "string") return token;
    }
  }
  if (typeof rec.api_key === "string" && rec.api_key) return rec.api_key;
  return null;
}

function readUnslothKey(env: Record<string, string | undefined>): string | null {
  const home = env.HOME || env.USERPROFILE || homedir();
  try {
    const raw = JSON.parse(readFileSync(join(home, ".unsloth", "studio", "auth", "agent_api_key.json"), "utf8")) as {
      api_key?: unknown;
      servers?: unknown;
    };
    // Older Studio wrote `{ api_key }`. Current Studio writes
    // `{ servers: { "http://127.0.0.1:8888": { minted: ["sk-unsloth-…"] } } }`.
    // Prefer the localhost minted token so a stale mixed-format file cannot
    // win; keep the top-level key as fallback.
    if (raw.servers && typeof raw.servers === "object") {
      const servers = raw.servers as Record<string, unknown>;
      for (const url of ["http://127.0.0.1:8888", "http://localhost:8888"]) {
        const token = firstUnslothToken(servers[url]);
        if (token) return token;
      }
      for (const row of Object.values(servers)) {
        const token = firstUnslothToken(row);
        if (token) return token;
      }
    }
    if (typeof raw.api_key === "string" && raw.api_key) return raw.api_key;
    return null;
  } catch {
    return null;
  }
}

/** `name` and `context_length` a server adds to its /v1/models rows
 * (DwarfStar, OpenRouter-style catalogs), keyed by model id. */
export function modelFactsFromPayload(payload: unknown): Map<string, { name?: string; contextWindow?: number }> {
  const out = new Map<string, { name?: string; contextWindow?: number }>();
  const records = payload && typeof payload === "object" && Array.isArray((payload as { data?: unknown }).data)
    ? (payload as { data: unknown[] }).data
    : Array.isArray(payload) ? payload : [];
  for (const record of records) {
    if (!record || typeof record !== "object") continue;
    const row = record as { id?: unknown; name?: unknown; context_length?: unknown; top_provider?: { context_length?: unknown } };
    if (typeof row.id !== "string" || !MODEL_ID.test(row.id)) continue;
    // oxlint-disable-next-line no-control-regex -- strip control characters from a model name
    const name = typeof row.name === "string" ? row.name.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 80) : "";
    const raw = row.context_length ?? row.top_provider?.context_length;
    const contextWindow = typeof raw === "number" && Number.isSafeInteger(raw) && raw > 0 && raw <= 100_000_000 ? raw : undefined;
    out.set(row.id, { ...(name && name !== row.id ? { name } : {}), ...(contextWindow ? { contextWindow } : {}) });
  }
  return out;
}

function idsFromModelsPayload(payload: unknown): string[] {
  const records = Array.isArray(payload)
    ? payload
    : payload && typeof payload === "object" && Array.isArray((payload as { data?: unknown }).data)
      ? (payload as { data: unknown[] }).data
      : payload && typeof payload === "object" && Array.isArray((payload as { models?: unknown }).models)
        ? (payload as { models: unknown[] }).models
        : [];
  return records.flatMap((record) => {
    if (typeof record === "string") return MODEL_ID.test(record) ? [record] : [];
    if (!record || typeof record !== "object") return [];
    const id = (record as { id?: unknown; name?: unknown }).id ?? (record as { name?: unknown }).name;
    if (typeof id !== "string" || !MODEL_ID.test(id)) return [];
    const low = id.toLowerCase();
    if (low.includes("embed") || low.includes("bge-") || low.includes("nomic")) return [];
    return [id];
  });
}

async function timedJson(
  url: string,
  env: Record<string, string | undefined>,
  host: LocalHost,
  fetchImpl: typeof fetch,
): Promise<unknown | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1200);
  timer.unref?.();
  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      headers: { Authorization: `Bearer ${hostApiKey(host, env)}` },
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Which of this host's models are actually in memory / running. */
export function loadedIdsFromPayloads(_host: LocalHost, catalog: unknown, extra: unknown): Set<string> {
  const loaded = new Set<string>();
  const catalogIds = new Set(idsFromModelsPayload(catalog));
  const add = (id: string) => {
    const base = id.split(":")[0]!;
    if (catalogIds.size && !catalogIds.has(id) && !catalogIds.has(base)) return;
    if (!MODEL_ID.test(id)) return;
    loaded.add(id);
    if (catalogIds.has(base)) loaded.add(base);
  };

  if (extra && typeof extra === "object") {
    const rec = extra as {
      default_model?: unknown;
      models?: unknown;
      data?: unknown;
    };
    const running = Array.isArray(rec.models)
      ? rec.models
      : Array.isArray(rec.data)
        ? rec.data
        : [];
    // oMLX /v1/models/status lists every model with loaded:true/false.
    // /health only has default_model, which is the configured default — not
    // necessarily what is in memory. Prefer explicit flags when present.
    const hasLoadedFlags = running.some(
      (row) => row && typeof row === "object" && ("loaded" in row || "state" in row),
    );
    if (!hasLoadedFlags && typeof rec.default_model === "string") add(rec.default_model);
    for (const row of running) {
      if (typeof row === "string") {
        if (!hasLoadedFlags) add(row);
        continue;
      }
      if (!row || typeof row !== "object") continue;
      const item = row as { name?: unknown; model?: unknown; id?: unknown; state?: unknown; loaded?: unknown };
      const id =
        (typeof item.name === "string" && item.name) ||
        (typeof item.model === "string" && item.model) ||
        (typeof item.id === "string" && item.id) ||
        "";
      if (!id) continue;
      const state = typeof item.state === "string" ? item.state.toLowerCase() : "";
      if (item.loaded === false || state === "not-loaded" || state === "unloaded") continue;
      if (item.loaded === true || state === "loaded" || state === "idle" || !hasLoadedFlags) {
        add(id);
      }
    }
  }

  if (!loaded.size && catalog && typeof catalog === "object") {
    const rec = catalog as { default_model?: unknown; data?: unknown };
    if (typeof rec.default_model === "string") add(rec.default_model);
    const records = Array.isArray(rec.data) ? rec.data : [];
    for (const row of records) {
      if (!row || typeof row !== "object") continue;
      const item = row as { id?: unknown; state?: unknown; loaded?: unknown };
      if (typeof item.id !== "string") continue;
      const state = typeof item.state === "string" ? item.state.toLowerCase() : "";
      if (item.loaded === true || state === "loaded") add(item.id);
    }
  }

  return loaded;
}

function loadedProbeUrl(host: LocalHost): string | null {
  const origin = anthropicBaseUrl(host);
  if (host.id === "omlx") return `${origin}/v1/models/status`;
  if (host.id === "ollama" || host.id === "local_ollama") return `${origin}/api/ps`;
  if (host.id === "lmstudio") return `${origin}/api/v0/models`;
  return null;
}

/** Live models from the same local hosts the sidecar probed. */
export async function probeLocalInjects(
  env: Record<string, string | undefined> = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<InjectedModel[]> {
  const seenHosts = new Set<string>();
  const hosts = LOCAL_HOSTS.filter((host) => {
    const key = host.baseUrl.replace(/\/$/, "");
    if (seenHosts.has(key)) return false;
    seenHosts.add(key);
    return true;
  });
  const found: Array<InjectedModel & { serverLabel: string }> = [];
  const pages = await Promise.all(
    hosts.map(async (host) => {
      const catalogUrl = `${host.baseUrl.replace(/\/$/, "")}/models`;
      const extraUrl = loadedProbeUrl(host);
      const [catalog, extra] = await Promise.all([
        timedJson(catalogUrl, env, host, fetchImpl),
        extraUrl ? timedJson(extraUrl, env, host, fetchImpl) : Promise.resolve(null),
      ]);
      const catalogIds = catalog ? idsFromModelsPayload(catalog) : [];
      const extraIds = extra ? idsFromModelsPayload(extra) : [];
      const loaded = loadedIdsFromPayloads(host, catalog ?? extra, extra);
      const ids = [...new Set([...catalogIds, ...extraIds, ...loaded])];
      const windows = contextWindowsFromPs(extra);
      const facts = modelFactsFromPayload(catalog);
      return { host, ids, loaded, windows, facts };
    }),
  );
  for (const { host, ids, loaded, windows, facts } of pages) {
    const labels = localModelLabels(ids.map((id) => ({ id, ...(facts.get(id)?.name ? { name: facts.get(id)!.name } : {}) })));
    for (const model of ids) {
      const contextWindow = windows.get(model) ?? facts.get(model)?.contextWindow;
      found.push({
        id: encodeInjectId(host.id, model),
        host: host.id,
        model,
        label: labels.get(model) ?? model,
        serverLabel: host.label,
        loaded: loaded.has(model),
        ...(contextWindow ? { contextWindow } : {}),
      });
    }
  }
  return withServerHints(found);
}

/** Append live local models as custom rows. Official rows stay first. */
export async function mergeLocalInject(
  catalog: ModelCatalog,
  env: Record<string, string | undefined> = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<ModelCatalog> {
  const vitest = env.VITEST ?? process.env.VITEST;
  const probe = env.SAGAX_PROBE_LOCAL_INJECT ?? process.env.SAGAX_PROBE_LOCAL_INJECT;
  const probed = vitest === "true" && probe !== "1" ? [] : await probeLocalInjects(env, fetchImpl);
  const extras = [...probed, ...desktopInjectModels()];
  if (!extras.length) return catalog;
  const liveApiIds = new Set(extras.map((extra) => extra.model));
  // A settings leftover that is just the API id of a live inject is not a
  // second model — Custom should only offer the host:: row.
  const options = catalog.options
    .filter((option) => decodeInjectId(option.id) || !option.custom || !liveApiIds.has(option.id))
    .map((option) => ({ ...option }));
  const seen = new Set(options.map((option) => option.id));
  for (const extra of extras) {
    const existing = options.find((option) => option.id === extra.id);
    if (existing) {
      existing.local = true;
      if (extra.anthropic) existing.anthropic = true;
      if (extra.loaded) existing.loaded = true;
      if (extra.contextWindow) existing.contextWindow = extra.contextWindow;
      continue;
    }
    seen.add(extra.id);
    options.push({
      id: extra.id,
      label: extra.label,
      custom: true,
      local: true,
      ...(extra.anthropic ? { anthropic: true } : {}),
      ...(extra.loaded ? { loaded: true } : {}),
      ...(extra.contextWindow ? { contextWindow: extra.contextWindow } : {}),
      ...(extra.server ? { server: extra.server } : {}),
      ...(extra.sharedBy ? { sharedBy: extra.sharedBy } : {}),
    });
  }
  return { default: catalog.default, options };
}

/** Point an OpenAI-compatible CLI at the injected host. */
export function applyOpenAIInject(
  env: Record<string, string | undefined>,
  modelId: string | null | undefined,
): { model: string | null; injected: boolean } {
  const inject = decodeInjectId(modelId);
  if (!inject) return { model: modelId ?? null, injected: false };
  const host = localHost(inject.host);
  if (!host) return { model: modelId ?? null, injected: false };
  const key = hostApiKey(host, env);
  env.OPENAI_BASE_URL = host.baseUrl;
  env.OPENAI_API_KEY = key;
  return { model: inject.model, injected: true };
}

/** Point Claude Code at the injected host instead of Anthropic cloud. */
export function applyClaudeInject(
  env: Record<string, string | undefined>,
  modelId: string | null | undefined,
): { model: string | null; injected: boolean } {
  const inject = decodeInjectId(modelId);
  if (!inject) return { model: modelId ?? null, injected: false };
  const host = localHost(inject.host);
  if (!host) return { model: modelId ?? null, injected: false };
  const key = hostApiKey(host, env);
  env.ANTHROPIC_BASE_URL = anthropicBaseUrl(host);
  env.ANTHROPIC_AUTH_TOKEN = key;
  env.ANTHROPIC_API_KEY = key;
  env.ANTHROPIC_MODEL = inject.model;
  return { model: inject.model, injected: true };
}
