import { createServer, type RequestListener, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { createXaiVideoProvider, generatedMp4Chunks, openGeneratedVideo, videoGenerationSchema } from "./video-provider.ts";
import { mediaProxyPolicyFromEnv } from "./media-proxy-guard.ts";

const servers: Server[] = [];
afterEach(async () => { for (const server of servers.splice(0)) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); } });
async function listen(handler: RequestListener) {
  const server = createServer(handler); servers.push(server);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
const policy = mediaProxyPolicyFromEnv({ SAGAX_MEDIA_PROXY_ALLOW_HOSTS: "127.0.0.1" });
const mp4 = readFileSync(new URL("./testing/fixtures/generated-video-blue.mp4", import.meta.url));
describe("xAI video wire and streamed media", () => {
  it("sends the documented generation parameters, polls request_id and keeps credentials off media requests", async () => {
    const calls: Array<{ url?: string; auth?: string; body: unknown }> = [];
    const base = await listen(async (req, res) => {
      let body = ""; for await (const chunk of req) body += chunk;
      calls.push({ url: req.url, auth: req.headers.authorization, body: body ? JSON.parse(body) : null });
      res.setHeader("content-type", "application/json");
      if (req.url === "/v1/videos/generations") return res.end('{"request_id":"documented-request"}');
      if (req.url === "/v1/videos/documented-request") return res.end(JSON.stringify({ status: "done", progress: 100, video: { url: base + "/video.mp4", duration: 3, respect_moderation: true } }));
      res.setHeader("content-type", "application/octet-stream"); res.write(mp4.subarray(0, 5)); res.end(mp4.subarray(5));
    });
    const provider = createXaiVideoProvider({ baseUrl: base + "/v1" });
    const signal = AbortSignal.timeout(5_000);
    const id = await provider.submit("synthetic-video-key", videoGenerationSchema.parse({ prompt: "blue", image: "/already-attached.png", duration: 3, resolution: "1080p", generate_audio: false }), "data:image/png;base64,c3ludGhldGlj", signal);
    expect(id).toBe("documented-request");
    const result = await provider.poll("synthetic-video-key", id, signal);
    const stream = await openGeneratedVideo(result.video!.url!, signal, { policy });
    const chunks: Uint8Array[] = []; for await (const chunk of generatedMp4Chunks(stream, signal)) chunks.push(chunk);
    expect(Buffer.concat(chunks)).toEqual(mp4);
    expect(calls[0]).toMatchObject({ auth: "Bearer synthetic-video-key", body: { model: "grok-imagine-video-1.5", prompt: "blue", duration: 3, aspect_ratio: "16:9", resolution: "1080p", generate_audio: false, image: { url: "data:image/png;base64,c3ludGhldGlj" } } });
    expect(calls[1]?.url).toBe("/v1/videos/documented-request"); expect(calls[2]?.auth).toBeUndefined();
  });
  it("redacts upstream errors and treats lost or malformed POST acknowledgements as ambiguous", async () => {
    let mode = "error";
    const base = await listen((_req, res) => {
      if (mode === "disconnect") return res.destroy();
      res.statusCode = mode === "error" ? 401 : 200; res.end(mode === "error" ? '{"error":"synthetic-private-provider-response"}' : '{"request_id":"../escape"}');
    });
    const provider = createXaiVideoProvider({ baseUrl: base }); const input = videoGenerationSchema.parse({ prompt: "blue" });
    await expect(provider.submit("synthetic", input, undefined, AbortSignal.timeout(5_000))).rejects.toMatchObject({ code: "http_401", message: "xAI video request failed (HTTP 401)." });
    mode = "malformed";
    await expect(provider.submit("synthetic", input, undefined, AbortSignal.timeout(5_000))).rejects.toMatchObject({ code: "submission_unknown" });
    mode = "disconnect";
    await expect(provider.submit("synthetic", input, undefined, AbortSignal.timeout(5_000))).rejects.toMatchObject({ code: "submission_unknown" });
  });
  it("blocks private destinations and redirect pivots, including metadata, and pins checked DNS", async () => {
    await expect(openGeneratedVideo("http://127.0.0.1/video.mp4", AbortSignal.timeout(1_000), { policy: mediaProxyPolicyFromEnv({}) })).rejects.toMatchObject({ reason: "loopback" });
    const base = await listen((_req, res) => { res.writeHead(302, { location: "http://169.254.169.254/metadata" }); res.end(); });
    await expect(openGeneratedVideo(base, AbortSignal.timeout(1_000), { policy })).rejects.toMatchObject({ reason: "metadata" });
    let lookups = 0;
    const actual = await listen((_req, res) => { res.writeHead(200, { "content-type": "video/mp4" }); res.end(mp4); });
    const url = actual.replace("127.0.0.1", "media.synthetic.test");
    const stream = await openGeneratedVideo(url, AbortSignal.timeout(2_000), {
      policy: mediaProxyPolicyFromEnv({ SAGAX_MEDIA_PROXY_ALLOW_HOSTS: "media.synthetic.test" }),
      resolver: async () => { lookups++; return [{ address: "127.0.0.1", family: 4 }]; },
    });
    for await (const _chunk of stream) { /* Drain the real pinned socket. */ }
    expect(lookups).toBe(1);
  });
  it("aborts an open download and rejects MIME spoofing and non-MP4 bytes", async () => {
    const base = await listen((_req, res) => { res.writeHead(200, { "content-type": "video/mp4" }); res.write(mp4.subarray(0, 32)); });
    const abort = new AbortController(); const stream = await openGeneratedVideo(base, abort.signal, { policy });
    const consume = (async () => { for await (const _chunk of stream) { /* Wait for abort. */ } })();
    abort.abort(); await expect(consume).rejects.toThrow();
    const wrong = await listen((_req, res) => { res.writeHead(200, { "content-type": "text/html" }); res.end("<html>not video</html>"); });
    await expect(openGeneratedVideo(wrong, AbortSignal.timeout(1_000), { policy })).rejects.toMatchObject({ code: "download_failed" });
    const invalid = async function* () { yield Buffer.from("#!/bin/sh\nsynthetic"); };
    await expect((async () => { for await (const _chunk of generatedMp4Chunks(invalid(), AbortSignal.timeout(1_000))) { /* Validate. */ } })()).rejects.toMatchObject({ code: "invalid_media" });
  });
  it("reads the documented failed and expired states, an error code, and an unknown state as still pending", async () => {
    const bodies = [
      { status: "failed", error: { code: "invalid_argument", message: "Prompt cannot be empty." } },
      { status: "expired" },
      { status: "queued_for_gpu", progress: 140 },
      { status: "done", video: { url: "https://vidgen.x.ai/a/video.mp4", duration: 8 }, model: "grok-imagine-video-1.5" },
    ];
    let index = 0;
    const base = await listen((_req, res) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(bodies[index++])); });
    const provider = createXaiVideoProvider({ baseUrl: base });
    const signal = AbortSignal.timeout(5_000);
    expect(await provider.poll("synthetic", "r", signal)).toMatchObject({ status: "failed", error: { code: "invalid_argument" } });
    expect(await provider.poll("synthetic", "r", signal)).toMatchObject({ status: "expired" });
    const unknown = await provider.poll("synthetic", "r", signal);
    expect(unknown.status).toBe("pending"); expect(unknown.progress).toBeUndefined();
    expect(await provider.poll("synthetic", "r", signal)).toMatchObject({ status: "done", video: { url: "https://vidgen.x.ai/a/video.mp4" } });
  });
  it("validates documented durations, formats and output sizes before any request", () => {
    for (const bad of [{ duration: 0 }, { duration: 16 }, { duration: 1.5 }, { aspect_ratio: "unsupported" }, { resolution: "4k" }, { prompt: "" }, { prompt: "x".repeat(2001) }]) expect(videoGenerationSchema.safeParse({ prompt: "blue", ...bad }).success).toBe(false);
  });
});
