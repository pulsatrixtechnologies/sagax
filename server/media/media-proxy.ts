import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { Agent as HttpAgent, request as httpRequest, type IncomingMessage, type ServerResponse } from "node:http";
import { Agent as HttpsAgent, request as httpsRequest } from "node:https";
import type { LookupAddress } from "node:dns";
import type { LookupFunction } from "node:net";
import { URL } from "node:url";

import type { SagaxVideoEmit, WireVideoWidget } from "../../shared/video-widget.ts";
import { normalizeVideoFormat, shareLinkExpiresAt, videoFormatFromUrl } from "../../shared/video-widget.ts";
import {
  checkMediaDestination,
  isNonPublicLiteralHost,
  MediaProxyBlockedError,
  mediaProxyPolicyFromEnv,
  mediaUrlMayBeProxied,
  type MediaProxyPolicy,
  type MediaProxyResolver,
} from "./media-proxy-guard.ts";

const TOKEN_TTL_MS = 4 * 60 * 60_000;
/** How long a minted proxy path keeps working (the card's latest expiry). */
export const MEDIA_PROXY_TOKEN_TTL_MS = TOKEN_TTL_MS;
/** One provider response may carry the same largest durable media object as
 * an uploaded video. Range responses normally stay much smaller. */
export const MAX_MEDIA_PROXY_BYTES = 1024 * 1024 * 1024;
const DEFAULT_HEADER_TIMEOUT_MS = 15_000;
/** HLS playlists are text; a real one is a few KiB, a long VOD a few hundred. */
const MAX_PLAYLIST_BYTES = 4 * 1024 * 1024;
export const HLS_CONTENT_TYPE = "application/vnd.apple.mpegurl";

function b64url(data: string | Buffer): string {
  return Buffer.from(data).toString("base64url");
}

function unb64url(data: string): string {
  return Buffer.from(data, "base64url").toString("utf8");
}

export interface MediaProxyBody {
  u: string;
  e: number;
  t?: string;
}

let proxyKey: Buffer | null = null;

export function initMediaProxy(dataDir: string): void {
  const path = join(dataDir, "media-proxy.key");
  if (!existsSync(path)) {
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(path, randomBytes(32), { mode: 0o600 });
  }
  proxyKey = readFileSync(path);
}

function key(): Buffer {
  if (!proxyKey) throw new Error("media proxy not initialized");
  return proxyKey;
}

/** Private stable identities use the existing persisted server key and a
 * separate MAC domain. A public principal/upload id cannot predict a URL. */
export function privateMediaIdentity(namespace: string, identity: readonly string[]): string {
  return createHmac("sha256", key()).update(JSON.stringify(["private-media-id", namespace, identity])).digest("hex");
}

export function needsMediaProxy(url: string, source?: string): boolean {
  if (source?.toLowerCase() === "glitcho") return true;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return true;
    const host = parsed.hostname.toLowerCase();
    if (host.endsWith(".local") || isNonPublicLiteralHost(host)) return true;
    if (parsed.username || parsed.password) return true;
  } catch {
    return true;
  }
  return false;
}

function isHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/** An http(s) URL without credentials the browser can try by itself. */
function browserFetchable(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (parsed.protocol === "http:" || parsed.protocol === "https:") && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

export function mintMediaProxyToken(url: string, threadId?: string, now = Date.now()): string {
  const body: MediaProxyBody = { u: url, e: now + TOKEN_TTL_MS, ...(threadId ? { t: threadId } : {}) };
  const payload = b64url(JSON.stringify(body));
  const mac = createHmac("sha256", key()).update(payload).digest("base64url").slice(0, 32);
  return `${payload}.${mac}`;
}

export function verifyMediaProxyToken(token: string, now = Date.now()): MediaProxyBody | null {
  if (!token || token.length > 4096) return null;
  const [payload, mac] = token.split(".");
  if (!payload || !mac) return null;
  const expected = createHmac("sha256", key()).update(payload).digest("base64url").slice(0, 32);
  const given = Buffer.from(mac);
  if (given.length !== expected.length || !timingSafeEqual(given, Buffer.from(expected))) return null;
  try {
    const body = JSON.parse(unb64url(payload)) as MediaProxyBody;
    if (typeof body.u !== "string" || typeof body.e !== "number" || body.e < now) return null;
    return body;
  } catch {
    return null;
  }
}

export function mediaProxyPath(token: string): string {
  return `/api/media/proxy/${token}`;
}

export function wireVideoFromEmit(
  emit: SagaxVideoEmit,
  threadId: string,
  now = Date.now(),
): WireVideoWidget {
  const format = emit.format ?? videoFormatFromUrl(emit.url);
  // HLS always goes through the proxy: it rewrites child playlists and
  // segments, so playback no longer depends on the upstream's CORS headers.
  const proxied = needsMediaProxy(emit.url, emit.source) || (format === "hls" && isHttpUrl(emit.url));
  const playbackUrl = proxied ? mediaProxyPath(mintMediaProxyToken(emit.url, threadId, now)) : emit.url;
  // The browser may reach a host the proxy refuses (split DNS answering a
  // private address): the player falls back to the original URL.
  const directUrl = proxied && browserFetchable(emit.url) ? emit.url : undefined;
  const posterUrl = emit.posterUrl && needsMediaProxy(emit.posterUrl, emit.source)
    ? mediaProxyPath(mintMediaProxyToken(emit.posterUrl, threadId, now))
    : emit.posterUrl;
  const avatarUrl = emit.avatarUrl && needsMediaProxy(emit.avatarUrl, emit.source)
    ? mediaProxyPath(mintMediaProxyToken(emit.avatarUrl, threadId, now))
    : emit.avatarUrl;
  // The card stops working at the first of the share link's own expiry and
  // the proxy token's; the player then offers to ask the bot for a new link.
  const expiries = [emit.expiresAt, shareLinkExpiresAt(emit.url), proxied ? now + MEDIA_PROXY_TOKEN_TTL_MS : undefined]
    .filter((at): at is number => typeof at === "number" && Number.isFinite(at));
  const expiresAt = expiries.length ? Math.min(...expiries) : undefined;
  return {
    kind: emit.kind ?? "vod",
    playbackUrl,
    ...(directUrl ? { directUrl } : {}),
    ...(format ? { format } : {}),
    title: emit.title,
    streamer: emit.streamer,
    source: emit.source,
    posterUrl,
    durationMs: emit.durationMs,
    ...(emit.viewerCount != null ? { viewerCount: emit.viewerCount } : {}),
    ...(emit.id ? { id: emit.id } : {}),
    ...(avatarUrl ? { avatarUrl } : {}),
    ...(emit.category ? { category: emit.category } : {}),
    ...(emit.startedAt ? { startedAt: emit.startedAt } : {}),
    ...(emit.tags?.length ? { tags: emit.tags } : {}),
    ...(emit.chapters?.length ? { chapters: emit.chapters } : {}),
    ...(emit.recording ? { recording: true } : {}),
    ...(emit.channelUrl && /^https:\/\//i.test(emit.channelUrl) ? { channelUrl: emit.channelUrl } : {}),
    ...(expiresAt ? { expiresAt } : {}),
  };
}

function isPlaylistContentType(contentType: string | undefined): boolean {
  return normalizeVideoFormat(contentType) === "hls";
}

/**
 * Rewrite the URIs of an HLS playlist (media or multivariant) so a player
 * that loaded it from `/api/media/proxy/<token>` reaches every variant
 * playlist, segment, key and init map through the proxy too, each with its
 * own signed token bound to the same thread:
 * - relative URIs resolve against the upstream playlist URL (after redirects);
 * - absolute URIs, on the playlist origin or another one (CDN segments,
 *   signed share segments), are proxied the same way, so playback never
 *   depends on the upstream sending CORS headers to the browser;
 * - a URI whose host is a non-public IP literal or `localhost` is left as
 *   is unless SAGAX_MEDIA_PROXY_ALLOW_HOSTS allows it, and every proxied
 *   fetch is checked again by the destination guard after DNS resolution.
 */
export function rewriteHlsPlaylist(
  text: string,
  playlistUrl: string,
  mint: (url: string) => string,
  policy: MediaProxyPolicy = mediaProxyPolicyFromEnv(),
): string {
  let base: URL;
  try {
    base = new URL(playlistUrl);
  } catch {
    return text;
  }
  const rewrite = (raw: string): string => {
    const value = raw.trim();
    if (!value) return raw;
    let resolved: URL;
    try {
      resolved = new URL(value, base);
    } catch {
      return raw;
    }
    if (resolved.protocol !== "http:" && resolved.protocol !== "https:") return raw;
    if (resolved.username || resolved.password) return raw;
    if (!mediaUrlMayBeProxied(resolved, policy)) return raw;
    return mint(resolved.href);
  };
  return text
    .split(/\r?\n/)
    .map((line) => {
      if (!line.trim()) return line;
      if (line.startsWith("#")) return line.replace(/URI="([^"]*)"/g, (_m, uri: string) => `URI="${rewrite(uri)}"`);
      return rewrite(line);
    })
    .join("\n");
}

export interface StreamProxiedMediaOptions {
  /** Thread the top-level token was minted for; nested HLS tokens inherit it. */
  threadId?: string;
  now?: number;
  /** Destinations allowed besides public ones (default: SAGAX_MEDIA_PROXY_ALLOW_HOSTS). */
  policy?: MediaProxyPolicy;
  /** DNS resolver of the destination guard (tests pass a fake one). */
  resolver?: MediaProxyResolver;
  /** Maximum time to wait for upstream response headers. */
  headerTimeoutMs?: number;
}

/** Redirects the proxy follows itself, each hop checked like the first URL. */
const MAX_REDIRECTS = 5;

// Sockets of the proxy live in their own pool: a kept-alive socket reused
// here was always opened by the proxy toward an address it had checked.
const proxyHttpAgent = new HttpAgent({ keepAlive: true });
const proxyHttpsAgent = new HttpsAgent({ keepAlive: true });

/**
 * One GET to a destination the guard accepted, connected to the address the
 * guard checked: the `lookup` hook hands that address to the socket, so no
 * second DNS answer (a rebinding resolver) can redirect the connection.
 */
async function requestCheckedUpstream(
  target: URL,
  headers: Record<string, string> | undefined,
  options: StreamProxiedMediaOptions,
  signal: AbortSignal,
): Promise<IncomingMessage> {
  const pinned = await checkMediaDestination(target, options.policy ?? mediaProxyPolicyFromEnv(), options.resolver);
  const https = target.protocol === "https:";
  const pinnedLookup: LookupFunction = (_hostname, lookupOptions, callback) => {
    if (lookupOptions.all) (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, [pinned]);
    else callback(null, pinned.address, pinned.family);
  };
  return await new Promise<IncomingMessage>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout>;
    const req = (https ? httpsRequest : httpRequest)(
      {
        hostname: target.hostname.replace(/^\[|\]$/g, ""),
        port: target.port || (https ? 443 : 80),
        path: target.pathname + target.search,
        method: "GET",
        headers,
        agent: https ? proxyHttpsAgent : proxyHttpAgent,
        lookup: pinnedLookup,
        signal,
      },
      (response) => {
        if (settled) {
          response.destroy();
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve(response);
      },
    );
    const timeout = Math.max(1, Math.floor(options.headerTimeoutMs ?? DEFAULT_HEADER_TIMEOUT_MS));
    timer = setTimeout(() => req.destroy(new Error("media upstream header timeout")), timeout);
    timer.unref?.();
    req.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    req.end();
  });
}

/** Playlist warm-up retries: at most this many, each wait capped. */
const PLAYLIST_WARMUP_RETRIES = 6;
const PLAYLIST_WARMUP_MAX_WAIT_MS = 3_000;

/** Wait before asking a warming-up playlist again, or null to pass the answer on. */
export function playlistWarmupDelayMs(
  upstream: Pick<IncomingMessage, "statusCode" | "headers">,
  playlistByPath: boolean,
  attempt: number,
): number | null {
  if (upstream.statusCode !== 503 || attempt >= PLAYLIST_WARMUP_RETRIES) return null;
  const ct = upstream.headers["content-type"];
  const raw = upstream.headers["retry-after"];
  if (!playlistByPath && !(typeof ct === "string" && isPlaylistContentType(ct)) && raw === undefined) return null;
  const seconds = typeof raw === "string" && /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : 1;
  return Math.min(Math.max(seconds, 0.25) * 1000, PLAYLIST_WARMUP_MAX_WAIT_MS);
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("aborted"));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("aborted"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export async function streamProxiedMedia(
  targetUrl: string,
  res: ServerResponse,
  rangeHeader?: string,
  options: StreamProxiedMediaOptions = {},
): Promise<void> {
  const clientAbort = new AbortController();
  const onClientClose = () => clientAbort.abort();
  res.once("close", onClientClose);
  try {
  const playlistByPath = videoFormatFromUrl(targetUrl) === "hls";
  // A playlist is rewritten whole: never ask the upstream for a byte range of it.
  const forwardRange = rangeHeader && !playlistByPath ? rangeHeader : undefined;
  const headers = forwardRange ? { Range: forwardRange } : undefined;
  let current: URL;
  let upstream: IncomingMessage;
  for (let attempt = 0; ; attempt += 1) {
    current = new URL(targetUrl);
    upstream = await requestCheckedUpstream(current, headers, options, clientAbort.signal);
    for (let hop = 0; ; hop += 1) {
      const status = upstream.statusCode ?? 502;
      const location = upstream.headers.location;
      if (status < 300 || status >= 400 || status === 304 || typeof location !== "string") break;
      // A redirect body is irrelevant and may be unbounded. Close this hop
      // before validating and opening the next destination.
      upstream.destroy();
      if (hop >= MAX_REDIRECTS) throw new MediaProxyBlockedError("too-many-redirects", current.hostname);
      current = new URL(location, current);
      upstream = await requestCheckedUpstream(current, headers, options, clientAbort.signal);
    }
    // A live playlist answers 503 + Retry-After while its ingest starts
    // (Glitcho share links do): wait here instead of failing the player.
    const retryAfter = playlistWarmupDelayMs(upstream, playlistByPath, attempt);
    if (retryAfter === null) break;
    upstream.destroy();
    await delay(retryAfter, clientAbort.signal);
  }
  const finalUrl = current.href;
  const response = upstream;
  if (res.destroyed) {
    response.destroy();
    return;
  }
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let clientClosed = false;
    let waitingDrain = false;
    const drain = () => {
      waitingDrain = false;
      if (!settled) response.resume();
    };
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      res.off("close", close);
      res.off("drain", drain);
      if (error !== undefined && !clientClosed) reject(error);
      else resolve();
    };
    const close = () => {
      clientClosed = true;
      response.destroy();
      finish();
    };
    res.once("close", close);
    const status = response.statusCode ?? 502;
    if (status >= 300) {
      const out: Record<string, string> = { "content-type": "text/plain" };
      if (status === 416) {
        const contentRange = response.headers["content-range"];
        const acceptRanges = response.headers["accept-ranges"];
        if (typeof contentRange === "string") out["content-range"] = contentRange;
        if (typeof acceptRanges === "string") out["accept-ranges"] = acceptRanges;
      }
      res.writeHead(status >= 400 ? status : 502, out);
      res.end();
      response.resume();
      finish();
      return;
    }
    const ct = response.headers["content-type"];
    const contentType = typeof ct === "string" ? ct : undefined;
    if (status === 200 && (playlistByPath || isPlaylistContentType(contentType))) {
      const chunks: Buffer[] = [];
      let size = 0;
      let aborted = false;
      response.on("data", (chunk: Buffer) => {
        if (aborted) return;
        size += chunk.length;
        if (size > MAX_PLAYLIST_BYTES) {
          aborted = true;
          response.destroy();
          res.writeHead(502, { "content-type": "text/plain" });
          res.end();
          finish();
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => {
        if (aborted) return;
        const now = options.now ?? Date.now();
        // Relative URIs resolve against the URL that answered (after redirects).
        const body = Buffer.from(
          rewriteHlsPlaylist(
            Buffer.concat(chunks).toString("utf8"),
            finalUrl,
            (u) => mediaProxyPath(mintMediaProxyToken(u, options.threadId, now)),
            options.policy,
          ),
          "utf8",
        );
        res.writeHead(200, {
          "content-type": HLS_CONTENT_TYPE,
          "content-length": String(body.length),
          "cache-control": "no-store",
        });
        res.end(body);
        finish();
      });
      response.on("error", (error) => {
        if (aborted) return;
        finish(error);
      });
      return;
    }
    let bytes = 0;
    // Media bytes pass through as the upstream sent them: a reverse proxy in
    // front of Sagax must not re-encode a body that a player seeks by range.
    const out: Record<string, string> = { "cache-control": "private, no-transform" };
    if (contentType) out["content-type"] = contentType;
    const cl = response.headers["content-length"];
    if (typeof cl === "string") {
      const declared = /^\d+$/.test(cl) ? Number(cl) : Number.NaN;
      if (Number.isSafeInteger(declared) && declared > MAX_MEDIA_PROXY_BYTES) {
        response.once("error", () => undefined);
        response.destroy();
        res.writeHead(502, { "content-type": "text/plain" });
        res.end();
        finish();
        return;
      }
      out["content-length"] = cl;
    }
    const cr = response.headers["content-range"];
    if (typeof cr === "string") out["content-range"] = cr;
    const ar = response.headers["accept-ranges"];
    if (typeof ar === "string") out["accept-ranges"] = ar;
    res.writeHead(status, out);
    response.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > MAX_MEDIA_PROXY_BYTES) {
        response.destroy();
        if (!res.destroyed) res.destroy();
        finish();
        return;
      }
      if (!res.write(chunk)) {
        response.pause();
        if (!waitingDrain) {
          waitingDrain = true;
          res.once("drain", drain);
        }
      }
    });
    response.on("end", () => {
      if (!res.writableEnded) res.end();
      finish();
    });
    response.on("error", (error) => finish(error));
  });
  } catch (error) {
    if (!clientAbort.signal.aborted && !res.destroyed) throw error;
  } finally {
    res.off("close", onClientClose);
  }
}
