// xAI's asynchronous Videos API. Keep provider URLs and credentials out of
// receipts. A failed/ambiguous POST is never automatically submitted again.
import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import type { LookupFunction } from "node:net";
import { z } from "zod";
import { checkMediaDestination, mediaProxyPolicyFromEnv, type MediaProxyPolicy, type MediaProxyResolver } from "./media-proxy-guard.ts";

export const VIDEO_MODEL = "grok-imagine-video-1.5";
export const videoGenerationSchema = z.object({
  prompt: z.string().trim().min(1).max(2_000),
  image: z.string().trim().min(1).max(500).optional(),
  duration: z.number().int().min(1).max(15).default(8),
  aspect_ratio: z.enum(["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "21:9", "5:2"]).default("16:9"),
  resolution: z.enum(["480p", "720p", "1080p"]).default("480p"),
  generate_audio: z.boolean().default(true),
});
export type VideoGenerationInput = z.infer<typeof videoGenerationSchema>;
export class VideoProviderError extends Error {
  readonly code: string;
  constructor(message: string, code: string) { super(message); this.code = code; }
}
// Documented states are pending, done and failed; the overview example also
// shows expired. A failed job carries error.code (invalid_argument covers
// moderation). Any state xAI adds later reads as still pending, never success.
const pollSchema = z.object({
  status: z.string().max(40).transform(status => (["pending", "done", "failed", "expired"].includes(status) ? status : "pending") as "pending" | "done" | "failed" | "expired"),
  progress: z.number().min(0).max(100).optional().catch(undefined),
  video: z.object({ url: z.string().url().optional(), duration: z.number().optional(), respect_moderation: z.boolean().optional() }).optional(),
  error: z.object({ code: z.string().max(80).optional(), message: z.string().optional() }).optional().catch(undefined),
  usage: z.object({ cost_in_usd_ticks: z.number().nonnegative().optional() }).optional().catch(undefined),
});
export type VideoProviderResult = z.infer<typeof pollSchema>;
export interface VideoProvider {
  submit(key: string, input: VideoGenerationInput, imageDataUrl: string | undefined, signal: AbortSignal): Promise<string>;
  poll(key: string, requestId: string, signal: AbortSignal): Promise<VideoProviderResult>;
}

async function boundedJson(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new VideoProviderError("xAI returned an empty video response.", "invalid_response");
  let bytes = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 64 * 1024) {
        await reader.cancel().catch(() => {});
        throw new VideoProviderError("xAI returned an oversized video response.", "invalid_response");
      }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally { reader.releaseLock(); }
}

/** baseUrl/fetch are dependency injection for isolated tests, never tool input. */
export function createXaiVideoProvider(options: { baseUrl?: string; fetch?: typeof fetch } = {}): VideoProvider {
  const base = options.baseUrl ?? "https://api.x.ai/v1";
  const fetchImpl = options.fetch ?? fetch;
  const request = async (path: string, key: string, signal: AbortSignal, body?: unknown) => {
    const response = await fetchImpl(base + path, {
      method: body ? "POST" : "GET", redirect: "error", signal,
      headers: { authorization: `Bearer ${key}`, ...(body ? { "content-type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw new VideoProviderError(`xAI video request failed (HTTP ${response.status}).`, `http_${response.status}`);
    }
    return boundedJson(response);
  };
  return {
    async submit(key, input, imageDataUrl, signal) {
      const { prompt, duration, aspect_ratio, resolution, generate_audio } = input;
      try {
        const data = z.object({ request_id: z.string().regex(/^[\w-]{1,200}$/) }).parse(await request("/videos/generations", key, signal, {
          model: VIDEO_MODEL, prompt, duration, aspect_ratio, resolution, generate_audio,
          ...(imageDataUrl ? { image: { url: imageDataUrl } } : {}),
        }));
        return data.request_id;
      } catch (error) {
        if (error instanceof VideoProviderError && /^http_(400|401|403|404|422|429)$/.test(error.code)) throw error;
        throw new VideoProviderError("xAI did not acknowledge the video request. It may still be running and billable; no second generation was submitted.", "submission_unknown");
      }
    },
    async poll(key, requestId, signal) {
      try { return pollSchema.parse(await request(`/videos/${encodeURIComponent(requestId)}`, key, signal)); }
      catch (error) {
        if (error instanceof VideoProviderError) throw error;
        throw new VideoProviderError("Could not read xAI video progress. Retry resumes this same request.", "poll_failed");
      }
    },
  };
}

/** Streaming download, including pinned DNS and a fresh destination check at
 * every redirect. No provider Authorization header follows the media URL. */
export async function openGeneratedVideo(url: string, signal: AbortSignal, options: {
  policy?: MediaProxyPolicy; resolver?: MediaProxyResolver;
} = {}): Promise<IncomingMessage> {
  let target: URL;
  try { target = new URL(url); } catch { throw new VideoProviderError("xAI returned an invalid video URL.", "download_failed"); }
  for (let hop = 0; hop <= 5; hop++) {
    if (target.username || target.password || target.hash) throw new VideoProviderError("The generated video URL is not supported.", "download_failed");
    const pinned = await checkMediaDestination(target, options.policy ?? mediaProxyPolicyFromEnv(), options.resolver);
    signal.throwIfAborted();
    const lookup: LookupFunction = (_host, settings, callback) => {
      if (settings.all) (callback as unknown as (e: null, addresses: typeof pinned[]) => void)(null, [pinned]);
      else callback(null, pinned.address, pinned.family);
    };
    const incoming = await new Promise<IncomingMessage>((resolve, reject) => {
      const request = (target.protocol === "https:" ? httpsRequest : httpRequest)(target, { method: "GET", agent: false, lookup, signal }, resolve);
      request.on("error", reject);
      request.end();
    });
    const status = incoming.statusCode ?? 502;
    if ([301, 302, 303, 307, 308].includes(status) && incoming.headers.location) {
      incoming.destroy();
      target = new URL(incoming.headers.location, target);
      continue;
    }
    if (status !== 200 || !/^(video\/mp4|application\/octet-stream)(?:\s*;|$)/i.test(incoming.headers["content-type"] ?? "")) {
      incoming.destroy();
      throw new VideoProviderError(`Could not download the generated MP4 (HTTP ${status}). Retry resumes this same request.`, "download_failed");
    }
    return incoming;
  }
  throw new VideoProviderError("The generated video redirected too many times.", "download_failed");
}

/** Generated output must really be MP4 even when upload sniffing is in warn
 * mode. Keep the initial bytes bounded and let saveFile enforce size/quota. */
export async function* generatedMp4Chunks(chunks: AsyncIterable<Uint8Array>, signal: AbortSignal): AsyncGenerator<Uint8Array> {
  let head = Buffer.alloc(0);
  const pending: Uint8Array[] = [];
  let checked = false;
  for await (const chunk of chunks) {
    signal.throwIfAborted();
    if (!chunk.byteLength) continue;
    if (!checked) {
      pending.push(chunk);
      head = Buffer.concat([head, Buffer.from(chunk).subarray(0, 12 - head.length)]);
      if (head.length < 12) continue;
      if (head.subarray(4, 8).toString("ascii") !== "ftyp") throw new VideoProviderError("xAI returned content that is not MP4. No playable attachment was saved.", "invalid_media");
      checked = true;
      yield* pending;
      pending.length = 0;
    } else yield chunk;
  }
  signal.throwIfAborted();
  if (!checked) throw new VideoProviderError("xAI returned an empty or invalid MP4. No playable attachment was saved.", "invalid_media");
}
