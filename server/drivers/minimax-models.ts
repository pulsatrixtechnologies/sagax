// MiniMax publishes an OpenAI-compatible model list: GET {base}/models
// (platform docs: GET /v1/models on the configured base, which already ends
// in /v1). The written catalog in minimax.ts is the fallback when that
// read is off, fails, or comes back empty. A known id keeps the context
// size from the written list. The key never goes to a plain http host that
// is not loopback, and a redirect is not followed.
import { createHash } from "node:crypto";

import type { ModelCatalog } from "../contracts.ts";
import { isLoopback } from "../engines/provider-key-check.ts";

export const MINIMAX_MODELS_TTL_MS = 10 * 60_000;
export const MINIMAX_MODELS_TIMEOUT_MS = 8_000;
const MAX_MODELS = 200;

export interface MinimaxModelCache {
  get(key: string): { at: number; options: ModelCatalog["options"] } | undefined;
  set(key: string, value: { at: number; options: ModelCatalog["options"] }): void;
}

const memory: MinimaxModelCache = new Map();

export function resetMinimaxModelCache(): void {
  if (memory instanceof Map) memory.clear();
}

/** The list URL, or null when the key must not be sent there. */
export function minimaxModelsUrl(apiUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(`${apiUrl.replace(/\/+$/, "")}/models`);
  } catch {
    return null;
  }
  const loopback = url.protocol === "http:" && isLoopback(url.hostname);
  if (url.protocol !== "https:" && !loopback) return null;
  return url.toString();
}

function idOk(id: string): boolean {
  if (id.length === 0 || id.length > 120) return false;
  for (let i = 0; i < id.length; i++) {
    const code = id.charCodeAt(i);
    if (code <= 32 || code === 127) return false;
  }
  return true;
}

/** Options from a list payload, or null when nothing usable was listed. */
export function minimaxOptionsFromPayload(payload: unknown, fallback: ModelCatalog): ModelCatalog["options"] | null {
  const record = payload && typeof payload === "object" ? payload as { data?: unknown; models?: unknown } : null;
  const list = Array.isArray(payload) ? payload : Array.isArray(record?.data) ? record.data : Array.isArray(record?.models) ? record.models : null;
  if (!list) return null;
  const known = new Map(fallback.options.map((option) => [option.id, option]));
  const options: ModelCatalog["options"] = [];
  const seen = new Set<string>();
  for (const row of list) {
    const item = typeof row === "string" ? { id: row } : row && typeof row === "object" ? row as { id?: unknown; name?: unknown } : null;
    const id = typeof item?.id === "string" ? item.id.trim() : "";
    if (!idOk(id) || seen.has(id)) continue;
    seen.add(id);
    const prior = known.get(id);
    const name = typeof item?.name === "string" ? item.name.trim() : "";
    options.push(prior ? { ...prior, ...(name ? { label: name } : {}) } : { id, label: name || id, custom: true });
    if (options.length >= MAX_MODELS) break;
  }
  return options.length ? options : null;
}

export function minimaxCatalog(options: ModelCatalog["options"], fallback: ModelCatalog, preferred?: string): ModelCatalog {
  const ids = new Set(options.map((option) => option.id));
  const wanted = preferred && ids.has(preferred) ? preferred : ids.has(fallback.default) ? fallback.default : options[0]!.id;
  return { default: wanted, options };
}

function cacheId(url: string, apiKey: string): string {
  return createHash("sha256").update(`${url}\n${apiKey}`).digest("hex");
}

export async function fetchMinimaxCatalog(input: {
  apiUrl: string;
  apiKey: string;
  fallback: ModelCatalog;
  preferred?: string;
  fetchImpl?: typeof fetch;
  now?: number;
  cache?: MinimaxModelCache;
  ttlMs?: number;
}): Promise<ModelCatalog> {
  const fallback = minimaxCatalog(input.fallback.options, input.fallback, input.preferred);
  const key = input.apiKey.trim();
  const url = minimaxModelsUrl(input.apiUrl);
  if (!key || !url) return fallback;
  const cache = input.cache ?? memory;
  const now = input.now ?? Date.now();
  const ttl = input.ttlMs ?? MINIMAX_MODELS_TTL_MS;
  const id = cacheId(url, key);
  const hit = cache.get(id);
  if (hit && now - hit.at < ttl) return minimaxCatalog(hit.options, input.fallback, input.preferred);
  try {
    const response = await (input.fetchImpl ?? fetch)(url, {
      method: "GET",
      headers: { authorization: `Bearer ${key}`, accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(MINIMAX_MODELS_TIMEOUT_MS),
    });
    if (!response.ok) return hit ? minimaxCatalog(hit.options, input.fallback, input.preferred) : fallback;
    const options = minimaxOptionsFromPayload(await response.json(), input.fallback);
    if (!options) return hit ? minimaxCatalog(hit.options, input.fallback, input.preferred) : fallback;
    cache.set(id, { at: now, options });
    return minimaxCatalog(options, input.fallback, input.preferred);
  } catch {
    return hit ? minimaxCatalog(hit.options, input.fallback, input.preferred) : fallback;
  }
}
