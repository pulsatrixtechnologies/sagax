// Tenor / GIPHY / Imgflip adapters for meme search (#2121). The API key is
// put on the HTTP request here and nowhere else: never in an error, a log
// line, the tool arguments or the picker payload.
import {
  MEME_MAX_BYTES,
  MEME_PROVIDER_INFO,
  MEME_SEARCH_LIMIT,
  type MemeProviderId,
  type MemeSearchHit,
} from "../../shared/memes.ts";
import type { MemeConfig } from "./store.ts";

export type MemeFetch = (url: string, init?: RequestInit) => Promise<Response>;

export class MemeProviderError extends Error {
  readonly code: "no_key" | "rate_limited" | "upstream" | "timeout" | "bad_answer" | "too_large" | "refused";
  readonly status?: number;
  constructor(code: MemeProviderError["code"], message: string, status?: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const TIMEOUT_MS = 15_000;
const TITLE_CHARS = 160;

function clean(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/<[^>]{0,200}>/g, "").replace(/\s+/g, " ").trim().slice(0, max);
}

function httpUrl(value: unknown): string {
  if (typeof value !== "string") return "";
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

function num(value: unknown, fallback = 0): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.round(n) : fallback;
}

async function getJson(fetchImpl: MemeFetch, url: string, init?: RequestInit): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, { ...init, signal: controller.signal });
    if (res.status === 401 || res.status === 403) throw new MemeProviderError("refused", "The meme provider refused this key.", res.status);
    if (res.status === 429) throw new MemeProviderError("rate_limited", "The meme provider rate-limited this request.", res.status);
    if (!res.ok) throw new MemeProviderError("upstream", `The meme provider returned HTTP ${res.status}.`, res.status);
    return await res.json();
  } catch (error) {
    if (error instanceof MemeProviderError) throw error;
    if ((error as { name?: string }).name === "AbortError") throw new MemeProviderError("timeout", "The meme provider timed out.");
    throw new MemeProviderError("upstream", "The meme provider call failed.");
  } finally {
    clearTimeout(timer);
  }
}

function requireKey(config: MemeConfig | null): asserts config is MemeConfig & { key: string } {
  if (!config?.key) throw new MemeProviderError("no_key", "Add a Tenor or GIPHY key in Settings > Providers > Memes.");
}

function tenorHit(row: Record<string, unknown>): MemeSearchHit | null {
  const id = clean(row.id, 80);
  const formats = row.media_formats && typeof row.media_formats === "object" ? row.media_formats as Record<string, Record<string, unknown>> : {};
  const preview = formats.tinygif ?? formats.nanogif ?? formats.tinygifpreview;
  const full = formats.gif ?? formats.mediumgif ?? formats.mp4;
  const previewUrl = httpUrl(preview?.url);
  const url = httpUrl(full?.url);
  if (!id || !previewUrl || !url) return null;
  const dims = (full?.dims ?? preview?.dims) as unknown;
  const width = Array.isArray(dims) ? num(dims[0], 320) : num(full?.width ?? preview?.width, 320);
  const height = Array.isArray(dims) ? num(dims[1], 240) : num(full?.height ?? preview?.height, 240);
  return {
    id: `tenor:${id}`,
    title: clean(row.title ?? row.content_description, TITLE_CHARS) || "Meme",
    previewUrl,
    url,
    width,
    height,
    provider: "tenor",
    attribution: MEME_PROVIDER_INFO.tenor.attribution,
  };
}

function giphyHit(row: Record<string, unknown>): MemeSearchHit | null {
  const id = clean(row.id, 80);
  const images = row.images && typeof row.images === "object" ? row.images as Record<string, Record<string, unknown>> : {};
  const preview = images.fixed_width_small ?? images.preview_gif ?? images.fixed_width;
  const full = images.original ?? images.downsized_medium ?? images.downsized;
  const previewUrl = httpUrl(preview?.url);
  const url = httpUrl(full?.url);
  if (!id || !previewUrl || !url) return null;
  return {
    id: `giphy:${id}`,
    title: clean(row.title, TITLE_CHARS) || "Meme",
    previewUrl,
    url,
    width: num(full?.width ?? preview?.width, 320),
    height: num(full?.height ?? preview?.height, 240),
    provider: "giphy",
    attribution: MEME_PROVIDER_INFO.giphy.attribution,
  };
}

async function searchTenor(config: MemeConfig & { key: string }, query: string | null, limit: number, fetchImpl: MemeFetch): Promise<MemeSearchHit[]> {
  const params = new URLSearchParams({
    key: config.key,
    client_key: "sagax",
    limit: String(limit),
    media_filter: "gif,tinygif,nanogif",
  });
  const path = query ? `https://tenor.googleapis.com/v2/search?${params}&q=${encodeURIComponent(query)}`
    : `https://tenor.googleapis.com/v2/featured?${params}`;
  const body = await getJson(fetchImpl, path) as { results?: unknown };
  const rows = Array.isArray(body.results) ? body.results : [];
  const hits: MemeSearchHit[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const hit = tenorHit(row as Record<string, unknown>);
    if (hit) hits.push(hit);
  }
  return hits;
}

async function searchGiphy(config: MemeConfig & { key: string }, query: string | null, limit: number, fetchImpl: MemeFetch): Promise<MemeSearchHit[]> {
  const params = new URLSearchParams({
    api_key: config.key,
    limit: String(limit),
    rating: "pg-13",
  });
  const path = query
    ? `https://api.giphy.com/v1/gifs/search?${params}&q=${encodeURIComponent(query)}`
    : `https://api.giphy.com/v1/gifs/trending?${params}`;
  const body = await getJson(fetchImpl, path) as { data?: unknown };
  const rows = Array.isArray(body.data) ? body.data : [];
  const hits: MemeSearchHit[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const hit = giphyHit(row as Record<string, unknown>);
    if (hit) hits.push(hit);
  }
  return hits;
}

/** Imgflip public template list (no key). Used when the person has no GIF key
 * yet, and mixed into searches as still meme templates. */
export async function searchImgflipTemplates(query: string | null, limit: number, fetchImpl: MemeFetch = fetch): Promise<MemeSearchHit[]> {
  const body = await getJson(fetchImpl, "https://api.imgflip.com/get_memes") as {
    success?: boolean;
    data?: { memes?: Array<Record<string, unknown>> };
  };
  const rows = Array.isArray(body.data?.memes) ? body.data!.memes! : [];
  const needle = (query ?? "").trim().toLowerCase();
  const hits: MemeSearchHit[] = [];
  for (const row of rows) {
    const id = clean(row.id, 40);
    const name = clean(row.name, TITLE_CHARS);
    const url = httpUrl(row.url);
    if (!id || !url) continue;
    if (needle && !name.toLowerCase().includes(needle)) continue;
    hits.push({
      id: `imgflip:${id}`,
      title: name || "Meme",
      previewUrl: url,
      url,
      width: num(row.width, 500),
      height: num(row.height, 500),
      provider: "imgflip",
      attribution: "Imgflip",
      still: true,
    });
    if (hits.length >= limit) break;
  }
  return hits;
}

export async function searchMemes(
  config: MemeConfig | null,
  query: string | null,
  opts: { limit?: number; fetch?: MemeFetch; includeImgflip?: boolean } = {},
): Promise<{ hits: MemeSearchHit[]; keyConfigured: boolean }> {
  const limit = Math.min(MEME_SEARCH_LIMIT, Math.max(1, opts.limit ?? MEME_SEARCH_LIMIT));
  const fetchImpl = opts.fetch ?? fetch;
  const includeImgflip = opts.includeImgflip !== false;
  const q = query?.replace(/\s+/g, " ").trim() || null;

  if (!config?.key) {
    const hits = includeImgflip ? await searchImgflipTemplates(q, limit, fetchImpl) : [];
    return { hits, keyConfigured: false };
  }

  requireKey(config);
  const providerHits = config.provider === "giphy"
    ? await searchGiphy(config, q, limit, fetchImpl)
    : await searchTenor(config, q, limit, fetchImpl);

  if (!includeImgflip || providerHits.length >= limit) {
    return { hits: providerHits.slice(0, limit), keyConfigured: true };
  }
  const still = await searchImgflipTemplates(q, Math.max(4, limit - providerHits.length), fetchImpl);
  return { hits: [...providerHits, ...still].slice(0, limit), keyConfigured: true };
}

/** Download a provider media URL into a Buffer (bounded). */
export async function downloadMemeBytes(
  url: string,
  opts: { fetch?: MemeFetch; maxBytes?: number } = {},
): Promise<{ bytes: Buffer; mime: string }> {
  const fetchImpl = opts.fetch ?? fetch;
  const maxBytes = opts.maxBytes ?? MEME_MAX_BYTES;
  const target = httpUrl(url);
  if (!target) throw new MemeProviderError("bad_answer", "That meme URL is not valid.");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(target, { signal: controller.signal, redirect: "follow" });
    if (!res.ok) throw new MemeProviderError("upstream", `Could not download the meme (HTTP ${res.status}).`, res.status);
    const length = Number(res.headers.get("content-length") ?? "0");
    if (length > maxBytes) throw new MemeProviderError("too_large", "That meme is too large to send.");
    const mime = (res.headers.get("content-type") ?? "image/gif").split(";")[0]!.trim().toLowerCase() || "image/gif";
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > maxBytes) throw new MemeProviderError("too_large", "That meme is too large to send.");
    if (buf.byteLength === 0) throw new MemeProviderError("bad_answer", "The meme download was empty.");
    return { bytes: buf, mime: mime.startsWith("image/") ? mime : "image/gif" };
  } catch (error) {
    if (error instanceof MemeProviderError) throw error;
    if ((error as { name?: string }).name === "AbortError") throw new MemeProviderError("timeout", "Downloading the meme timed out.");
    throw new MemeProviderError("upstream", "Could not download the meme.");
  } finally {
    clearTimeout(timer);
  }
}

export function providerLabel(id: MemeProviderId): string {
  return MEME_PROVIDER_INFO[id].label;
}
