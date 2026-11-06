// Memes settings + search proxy (#2121).
//
//   GET    /api/me/memes           { provider, keyConfigured, last4, ready }
//   PUT    /api/me/memes           { provider, key? }
//   DELETE /api/me/memes           forget provider + key
//   GET    /api/memes/search?q=    { hits, keyConfigured }  (key never in body)
//   GET    /api/memes/trending     { hits, keyConfigured }
//   POST   /api/memes/materialize  { id?, url, provider, attribution, title?, caption? }
//                                  -> saves image attachment (+ meme meta)
//
// The provider key is never answered back and never logged.
import {
  isMemeProvider,
  MEME_CAPTION_MAX,
  MEME_PROVIDER_INFO,
  MEME_QUERY_MAX,
  type MemeAttachmentMeta,
  type MemeProviderId,
  type MemeSearchHit,
} from "../../shared/memes.ts";
import { saveImage } from "../attachments/attachments.ts";
import type { RequestAuth } from "../auth/request-auth.ts";
import { downloadMemeBytes, MemeProviderError, searchMemes, type MemeFetch } from "../memes/providers.ts";
import { MemeStoreError, readyConfig, type MemeScope, type MemeStore } from "../memes/store.ts";
import { PASS, type RouteHandler } from "./table.ts";

export const MEMES_SETTINGS_PATH = "/api/me/memes";
export const MEMES_SEARCH_PATH = "/api/memes/search";
export const MEMES_TRENDING_PATH = "/api/memes/trending";
export const MEMES_MATERIALIZE_PATH = "/api/memes/materialize";

export interface MemesRouteDeps {
  store: MemeStore;
  scope(auth: RequestAuth): MemeScope | null;
  fetch?: MemeFetch;
  /** Optional owner principal for attachment quota. */
  owner?(auth: RequestAuth): string | null;
}

/** A key as pasted: one line, no spaces. */
export function normalizeMemeKey(raw: string): string {
  const key = raw.trim();
  if (!key) return "";
  let rejected = key.length < 8 || key.length > 400;
  for (let i = 0; !rejected && i < key.length; i += 1) {
    const code = key.charCodeAt(i);
    if (code <= 32 || code === 127) rejected = true;
  }
  if (rejected) throw new MemeProviderError("no_key", "Enter the key as a single line, between 8 and 400 characters.");
  return key;
}

type SettingsInput = { provider: MemeProviderId; key?: string };

function parseSettings(body: unknown): SettingsInput | string {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "Send { provider, key }.";
  const row = body as Record<string, unknown>;
  if (!isMemeProvider(row.provider)) return "provider must be tenor or giphy.";
  if (row.key !== undefined && typeof row.key !== "string") return "key must be a string.";
  try {
    const key = typeof row.key === "string" ? normalizeMemeKey(row.key) : undefined;
    return { provider: row.provider, ...(key !== undefined ? { key } : {}) };
  } catch (error) {
    return error instanceof MemeProviderError ? error.message : "Invalid settings.";
  }
}

function sanitizeHits(hits: MemeSearchHit[]): MemeSearchHit[] {
  // Defensive: never leak a key-shaped query param if a provider echoed one.
  return hits.map((hit) => ({
    id: hit.id,
    title: hit.title,
    previewUrl: hit.previewUrl,
    url: hit.url,
    width: hit.width,
    height: hit.height,
    provider: hit.provider,
    attribution: hit.attribution,
    ...(hit.still ? { still: true } : {}),
  }));
}

function assertNoKeyLeak(payload: unknown, key: string | undefined): void {
  if (!key || key.length < 8) return;
  const raw = JSON.stringify(payload);
  if (raw.includes(key)) throw new Error("meme response leaked provider key");
}

export function createMemesRoutes(deps: MemesRouteDeps): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody, url }) => {
    const isSettings = path === MEMES_SETTINGS_PATH;
    const isSearch = path === MEMES_SEARCH_PATH;
    const isTrending = path === MEMES_TRENDING_PATH;
    const isMaterialize = path === MEMES_MATERIALIZE_PATH;
    if (!isSettings && !isSearch && !isTrending && !isMaterialize) return PASS;
    res.setHeader("cache-control", "no-store");

    const scope = deps.scope(auth);
    if (!scope) return json(res, 401, { error: "Meme settings belong to one person: sign in first." });

    try {
      if (isSettings) {
        if (method === "GET") {
          const view = deps.store.view(scope);
          assertNoKeyLeak(view, deps.store.config(scope)?.key);
          return json(res, 200, view);
        }
        if (method === "DELETE") {
          deps.store.remove(scope);
          return json(res, 200, deps.store.view(scope));
        }
        if (method === "PUT") {
          const input = parseSettings(await readBody(req).catch(() => undefined));
          if (typeof input === "string") return json(res, 400, { error: input });
          const view = deps.store.save(scope, input);
          assertNoKeyLeak(view, deps.store.config(scope)?.key);
          return json(res, 200, view);
        }
        return PASS;
      }

      if ((isSearch || isTrending) && method === "GET") {
        const q = isSearch ? (url.searchParams.get("q") ?? "").replace(/\s+/g, " ").trim().slice(0, MEME_QUERY_MAX) : "";
        const config = deps.store.config(scope);
        const { hits, keyConfigured } = await searchMemes(config, isSearch ? (q || null) : null, {
          fetch: deps.fetch,
        });
        const body = {
          hits: sanitizeHits(hits),
          keyConfigured,
          ...(keyConfigured ? {} : {
            setupHint: "Add a Tenor or GIPHY key in Settings > Providers > Memes to search animated reaction memes. You can still upload or paste a local GIF.",
            keysUrl: MEME_PROVIDER_INFO.tenor.keysUrl,
          }),
        };
        assertNoKeyLeak(body, config?.key);
        return json(res, 200, body);
      }

      if (isMaterialize && method === "POST") {
        const raw = await readBody(req).catch(() => undefined);
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) return json(res, 400, { error: "Send { url, provider, attribution }." });
        const row = raw as Record<string, unknown>;
        const mediaUrl = typeof row.url === "string" ? row.url.trim() : "";
        const provider = typeof row.provider === "string" ? row.provider : "";
        const attribution = typeof row.attribution === "string" ? row.attribution.trim().slice(0, 80) : "";
        const title = typeof row.title === "string" ? row.title.trim().slice(0, 120) : "meme";
        const caption = typeof row.caption === "string" ? row.caption.replace(/\s+/g, " ").trim().slice(0, MEME_CAPTION_MAX) : "";
        const sourceId = typeof row.id === "string" ? row.id.trim().slice(0, 80) : undefined;
        if (!mediaUrl || !attribution) return json(res, 400, { error: "url and attribution are required." });
        if (!(provider === "tenor" || provider === "giphy" || provider === "imgflip" || provider === "upload")) {
          return json(res, 400, { error: "provider must be tenor, giphy, imgflip or upload." });
        }
        const { bytes, mime } = await downloadMemeBytes(mediaUrl, { fetch: deps.fetch });
        const saved = saveImage(bytes, mime, undefined, deps.owner?.(auth) ?? null);
        const meme: MemeAttachmentMeta = {
          provider,
          attribution,
          ...(caption ? { caption } : {}),
          ...(sourceId ? { sourceId } : {}),
        };
        const attachment = {
          kind: "image" as const,
          path: saved.path,
          mime: saved.mime,
          name: `${title.replace(/[^\w.-]+/g, "_").slice(0, 40) || "meme"}${saved.mime === "image/png" ? ".png" : saved.mime === "image/jpeg" ? ".jpg" : saved.mime === "image/webp" ? ".webp" : ".gif"}`,
          meme,
        };
        const body = { attachment };
        assertNoKeyLeak(body, deps.store.config(scope)?.key);
        return json(res, 200, body);
      }

      return PASS;
    } catch (error) {
      if (error instanceof MemeStoreError) return json(res, error.status, { error: error.message, code: error.code });
      if (error instanceof MemeProviderError) {
        const status = error.code === "no_key" ? 400 : error.code === "too_large" ? 413 : 502;
        return json(res, status, { error: error.message, code: error.code });
      }
      if (error instanceof Error && error.message === "meme response leaked provider key") {
        return json(res, 500, { error: "The meme response was refused." });
      }
      const status = typeof (error as { status?: unknown }).status === "number" ? (error as { status: number }).status : 500;
      return json(res, status, { error: error instanceof Error ? error.message : "Meme request failed." });
    }
  };
}

export function memesReady(store: MemeStore, scope: MemeScope | null): boolean {
  return scope ? readyConfig(store.config(scope)) : false;
}
