// The person's web search provider (2026-10-26), Settings > Models and voice >
// Web search. A personal setting: no admin right, also on an organization
// server, where each person has their own (server/web-search/store.ts).
//
//   GET    /api/me/web-search        { provider, baseUrl, keyConfigured, last4, ready }
//   PUT    /api/me/web-search        { provider, key?, baseUrl? }: key omitted keeps the saved one
//   DELETE /api/me/web-search        forget the provider and its key
//   POST   /api/me/web-search/test   { provider?, key?, baseUrl? }: one real search, with the
//                                    typed values or the saved ones
//
// The key is never in an answer: only keyConfigured and its last four
// characters. It is never logged.
import { isWebSearchProvider, WEB_SEARCH_PROVIDER_INFO, type WebSearchProviderId } from "../../shared/web-search.ts";
import type { RequestAuth } from "../auth/request-auth.ts";
import { normalizeBaseUrl, runWebSearch, WebSearchError, type WebSearchConfig, type WebSearchFetch } from "../web-search/providers.ts";
import { readyConfig, WebSearchStoreError, type WebSearchScope, type WebSearchStore } from "../web-search/store.ts";
import { PASS, type RouteHandler } from "./table.ts";

export const WEB_SEARCH_PATH = "/api/me/web-search";
const TEST_PATH = `${WEB_SEARCH_PATH}/test`;

export interface WebSearchRouteDeps {
  store: WebSearchStore;
  /** Whose settings this session reads: null when an organization session names no person. */
  scope(auth: RequestAuth): WebSearchScope | null;
  refuseAddress?(url: string): Promise<string | null>;
  fetch?: WebSearchFetch;
}

/** A key as pasted: one line, no spaces. */
export function normalizeWebSearchKey(raw: string, provider: WebSearchProviderId): string {
  const key = raw.trim();
  if (!key) return "";
  const min = WEB_SEARCH_PROVIDER_INFO[provider].keyRequired ? 8 : 1;
  let rejected = key.length < min || key.length > 400;
  for (let i = 0; !rejected && i < key.length; i += 1) {
    const code = key.charCodeAt(i);
    if (code <= 32 || code === 127) rejected = true;
  }
  if (rejected) throw new WebSearchError("no_key", `Enter the key as a single line, between ${min} and 400 characters.`);
  return key;
}

type Input = { provider: WebSearchProviderId; key?: string; baseUrl?: string };

function parseInput(body: unknown): Input | string {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "Send { provider, key, baseUrl }.";
  const row = body as Record<string, unknown>;
  if (!isWebSearchProvider(row.provider)) return "provider must be brave, exa, parallel, firecrawl or searxng.";
  if (row.key !== undefined && typeof row.key !== "string") return "key must be a string.";
  if (row.baseUrl !== undefined && row.baseUrl !== null && typeof row.baseUrl !== "string") return "baseUrl must be a string.";
  try {
    const key = typeof row.key === "string" ? normalizeWebSearchKey(row.key, row.provider) : undefined;
    const baseUrl = typeof row.baseUrl === "string" ? normalizeBaseUrl(row.baseUrl) : undefined;
    return { provider: row.provider, ...(key !== undefined ? { key } : {}), ...(baseUrl ? { baseUrl } : {}) };
  } catch (error) {
    return error instanceof WebSearchError ? error.message : "Invalid settings.";
  }
}

export function createWebSearchRoutes(deps: WebSearchRouteDeps): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    if (path !== WEB_SEARCH_PATH && path !== TEST_PATH) return PASS;
    res.setHeader("cache-control", "no-store");
    const scope = deps.scope(auth);
    if (!scope) return json(res, 401, { error: "Web search settings belong to one person: sign in first." });
    try {
      if (path === TEST_PATH) {
        if (method !== "POST") return PASS;
        const raw = await readBody(req).catch(() => ({}));
        const saved = deps.store.config(scope);
        const typed = raw && typeof raw === "object" && isWebSearchProvider((raw as { provider?: unknown }).provider) ? parseInput(raw) : null;
        if (typeof typed === "string") return json(res, 400, { error: typed });
        // The typed values win; a key left empty for the saved provider is the saved key.
        const config: WebSearchConfig | null = typed
          ? {
              provider: typed.provider,
              ...((typed.key || (saved?.provider === typed.provider ? saved.key : undefined)) ? { key: typed.key || saved!.key } : {}),
              ...((typed.baseUrl ?? (saved?.provider === typed.provider ? saved.baseUrl : undefined)) ? { baseUrl: typed.baseUrl ?? saved!.baseUrl } : {}),
            }
          : saved;
        if (!config || !readyConfig(config)) return json(res, 400, { error: "Pick a provider and enter its key (or the SearXNG address) first." });
        if (config.baseUrl && deps.refuseAddress) {
          const refusal = await deps.refuseAddress(config.baseUrl);
          if (refusal) return json(res, 400, { error: refusal, code: "base_url" });
        }
        const results = await runWebSearch(config, "weather", { count: 1, ...(deps.fetch ? { fetch: deps.fetch } : {}) });
        return json(res, 200, { ok: true, results: results.length });
      }
      if (method === "GET") return json(res, 200, deps.store.view(scope));
      if (method === "DELETE") {
        deps.store.remove(scope);
        return json(res, 200, deps.store.view(scope));
      }
      if (method === "PUT") {
        const input = parseInput(await readBody(req).catch(() => undefined));
        if (typeof input === "string") return json(res, 400, { error: input });
        if (input.baseUrl && deps.refuseAddress) {
          const refusal = await deps.refuseAddress(input.baseUrl);
          if (refusal) return json(res, 400, { error: refusal, code: "base_url" });
        }
        return json(res, 200, deps.store.save(scope, input));
      }
      return PASS;
    } catch (error) {
      if (error instanceof WebSearchStoreError) return json(res, error.status, { error: error.message, code: error.code });
      if (error instanceof WebSearchError) return json(res, error.code === "refused_key" ? 400 : 502, { error: error.message, code: error.code });
      throw error;
    }
  };
}
