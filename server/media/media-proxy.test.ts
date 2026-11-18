import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  initMediaProxy,
  MAX_MEDIA_PROXY_BYTES,
  mediaProxyPath,
  mintMediaProxyToken,
  needsMediaProxy,
  playlistWarmupDelayMs,
  rewriteHlsPlaylist,
  streamProxiedMedia,
  verifyMediaProxyToken,
  MEDIA_PROXY_TOKEN_TTL_MS,
  wireVideoFromEmit,
} from "./media-proxy.ts";
import { parseMediaProxyAllowList } from "./media-proxy-guard.ts";

// The fixtures below are private hosts the operator allowed explicitly.
const LAB = parseMediaProxyAllowList("127.0.0.1, 10.0.0.5");

describe("media proxy", () => {
  beforeEach(() => {
    initMediaProxy(mkdtempSync(join(tmpdir(), "sagax-media-")));
  });

  it("mints and verifies tokens", () => {
    const token = mintMediaProxyToken("https://glitcho.example/live.m3u8", "thread-1", 1_000_000);
    expect(verifyMediaProxyToken(token, 1_000_000)).toEqual({
      u: "https://glitcho.example/live.m3u8",
      e: 1_000_000 + 4 * 60 * 60_000,
      t: "thread-1",
    });
    expect(verifyMediaProxyToken(token, 1_000_000 + 5 * 60 * 60_000)).toBeNull();
  });

  it("proxies glitcho and local URLs", () => {
    expect(needsMediaProxy("https://cdn.example/v.mp4")).toBe(false);
    expect(needsMediaProxy("https://cdn.example/v.mp4", "Glitcho")).toBe(true);
    expect(needsMediaProxy("http://127.0.0.1/x.m3u8")).toBe(true);
  });

  it("rewrites playback URLs for private sources", () => {
    const wire = wireVideoFromEmit({ url: "https://glitcho.example/a.m3u8", kind: "live", source: "Glitcho" }, "t1", 5_000);
    expect(wire.playbackUrl).toMatch(/^\/api\/media\/proxy\//);
    expect(wire.kind).toBe("live");
    expect(wire.format).toBe("hls");
  });

  it("always proxies HTTP(S) HLS and keeps the original URL as the browser fallback", () => {
    const hls = wireVideoFromEmit({ url: "https://media.example.test/live/index.m3u8", kind: "live" }, "t1", 5_000);
    expect(hls.playbackUrl.startsWith("/api/media/proxy/")).toBe(true);
    expect(hls.directUrl).toBe("https://media.example.test/live/index.m3u8");
    expect(hls.format).toBe("hls");
    const mp4 = wireVideoFromEmit({ url: "https://media.example.test/v.mp4" }, "t1", 5_000);
    expect(mp4.playbackUrl).toBe("https://media.example.test/v.mp4");
    expect(mp4.directUrl).toBeUndefined();
    const withCreds = wireVideoFromEmit({ url: "https://u:p@media.example.test/live/index.m3u8" }, "t1", 5_000);
    expect(withCreds.playbackUrl.startsWith("/api/media/proxy/")).toBe(true);
    expect(withCreds.directUrl).toBeUndefined();
  });

  it("keeps the source format on the wire although the proxied path hides it", () => {
    const live = wireVideoFromEmit(
      { url: "https://glitcho.example/v1/share/live/ninja/index.m3u8?u=1&exp=2&t=sig", kind: "live", source: "Glitcho" },
      "t1",
      5_000,
    );
    expect(live.playbackUrl).not.toMatch(/m3u8/);
    expect(live.format).toBe("hls");
    const declared = wireVideoFromEmit({ url: "http://127.0.0.1:9/play?id=3", format: "hls" }, "t1", 5_000);
    expect(declared.format).toBe("hls");
    const mp4 = wireVideoFromEmit({ url: "https://cdn.example/v.mp4" }, "t1", 5_000);
    expect(mp4).toMatchObject({ playbackUrl: "https://cdn.example/v.mp4", format: "mp4" });
    const unknown = wireVideoFromEmit({ url: "https://cdn.example/play?id=1" }, "t1", 5_000);
    expect(unknown.format).toBeUndefined();
  });

  it("passes the optional details through and computes when the card expires", () => {
    const wire = wireVideoFromEmit(
      {
        url: "https://media.example/v1/share/live/a/index.m3u8?exp=1900000000&t=sig",
        kind: "live",
        source: "Glitcho",
        viewerCount: 12,
        avatarUrl: "https://media.example/a.png",
        category: "Strategy",
        tags: ["English"],
        startedAt: "2026-11-06T12:00:00Z",
        recording: true,
        chapters: [{ startMs: 0, title: "Intro" }],
      },
      "t1",
      5_000,
    );
    expect(wire).toMatchObject({ viewerCount: 12, category: "Strategy", tags: ["English"], recording: true, startedAt: "2026-11-06T12:00:00Z" });
    expect(wire.chapters).toEqual([{ startMs: 0, title: "Intro" }]);
    // the avatar of a private source goes through the proxy like the poster
    expect(wire.avatarUrl).toMatch(/^\/api\/media\/proxy\//);
    // the proxy token (4 h) runs out before the share link's exp here
    expect(wire.expiresAt).toBe(5_000 + MEDIA_PROXY_TOKEN_TTL_MS);
    const late = wireVideoFromEmit(
      { url: "https://media.example/v1/share/live/a/index.m3u8?exp=1900000000&t=sig", kind: "live", source: "Glitcho" },
      "t1",
      1_899_990_000_000,
    );
    expect(late.expiresAt).toBe(1_900_000_000_000);
    const plain = wireVideoFromEmit({ url: "https://cdn.example/v.mp4" }, "t1", 5_000);
    expect(plain.expiresAt).toBeUndefined();
    expect(plain).not.toHaveProperty("viewerCount");
  });
});

describe("rewriteHlsPlaylist", () => {
  const mint = (u: string) => `/p/${encodeURIComponent(u)}`;

  it("proxies relative URIs, private same-origin URIs and URI attributes", () => {
    const playlist = [
      "#EXTM3U",
      "#EXT-X-VERSION:7",
      '#EXT-X-MAP:URI="init.mp4"',
      '#EXT-X-KEY:METHOD=AES-128,URI="../keys/k1?x=1"',
      "#EXTINF:4.0,",
      "seg0.ts?sig=a",
      "#EXTINF:4.0,",
      "/abs/seg1.ts",
      "#EXTINF:4.0,",
      "http://127.0.0.1:8080/abs/seg2.ts",
      "#EXTINF:4.0,",
      "https://cdn.public.example/seg3.ts",
      "",
    ].join("\r\n");
    const out = rewriteHlsPlaylist(playlist, "http://127.0.0.1:8080/v1/share/recordings/4/index.m3u8?t=s", mint, LAB).split("\n");
    expect(out[0]).toBe("#EXTM3U");
    expect(out[2]).toBe(`#EXT-X-MAP:URI="${mint("http://127.0.0.1:8080/v1/share/recordings/4/init.mp4")}"`);
    expect(out[3]).toBe(`#EXT-X-KEY:METHOD=AES-128,URI="${mint("http://127.0.0.1:8080/v1/share/recordings/keys/k1?x=1")}"`);
    expect(out[5]).toBe(mint("http://127.0.0.1:8080/v1/share/recordings/4/seg0.ts?sig=a"));
    expect(out[7]).toBe(mint("http://127.0.0.1:8080/abs/seg1.ts"));
    expect(out[9]).toBe(mint("http://127.0.0.1:8080/abs/seg2.ts"));
    // A segment on another origin (a CDN) goes through the proxy too, so
    // playback never depends on that host sending CORS headers.
    expect(out[11]).toBe(mint("https://cdn.public.example/seg3.ts"));
  });

  it("proxies public absolute URIs on the playlist origin (Glitcho share links)", () => {
    const playlist = "#EXTM3U\n#EXTINF:2,\nhttps://glitcho.example/v1/live/ninja/seg/9.ts?t=s\n";
    expect(rewriteHlsPlaylist(playlist, "https://glitcho.example/v1/share/live/ninja/index.m3u8", mint)).toBe(
      `#EXTM3U\n#EXTINF:2,\n${mint("https://glitcho.example/v1/live/ninja/seg/9.ts?t=s")}\n`,
    );
  });

  it("never proxies URIs with credentials or private hosts that were not allowed", () => {
    const playlist = [
      "#EXTM3U",
      "#EXTINF:2,",
      "https://user:pw@cdn.example.test/seg1.ts",
      "#EXTINF:2,",
      "http://192.168.1.20/seg2.ts",
      "#EXTINF:2,",
      "http://localhost:8080/seg3.ts",
      "#EXTINF:2,",
      "ftp://files.example.test/seg4.ts",
      "",
    ].join("\n");
    expect(rewriteHlsPlaylist(playlist, "https://media.example.test/live/index.m3u8", mint)).toBe(playlist);
  });

  it("rewrites variant playlists of a multivariant playlist", () => {
    const playlist = "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000\nlow/index.m3u8\n";
    const out = rewriteHlsPlaylist(playlist, "http://10.0.0.5/live/master.m3u8", mint, LAB);
    expect(out).toContain(mint("http://10.0.0.5/live/low/index.m3u8"));
  });
});

describe("playlistWarmupDelayMs", () => {
  const answer = (statusCode: number, headers: Record<string, string> = {}) => ({ statusCode, headers });

  it("retries a playlist's 503, honoring a capped Retry-After", () => {
    expect(playlistWarmupDelayMs(answer(503), true, 0)).toBe(1000);
    expect(playlistWarmupDelayMs(answer(503, { "retry-after": "2" }), true, 0)).toBe(2000);
    expect(playlistWarmupDelayMs(answer(503, { "retry-after": "60" }), true, 0)).toBe(3000);
    expect(playlistWarmupDelayMs(answer(503, { "retry-after": "0" }), true, 0)).toBe(250);
    expect(playlistWarmupDelayMs(answer(503, { "content-type": "application/x-mpegURL" }), false, 0)).toBe(1000);
  });

  it("passes the answer on otherwise", () => {
    expect(playlistWarmupDelayMs(answer(200), true, 0)).toBeNull();
    expect(playlistWarmupDelayMs(answer(502), true, 0)).toBeNull();
    expect(playlistWarmupDelayMs(answer(503), true, 6)).toBeNull();
    // Not a playlist and no Retry-After: a plain 503 of a file.
    expect(playlistWarmupDelayMs(answer(503, { "content-type": "video/mp4" }), false, 0)).toBeNull();
  });
});

describe("streamProxiedMedia over HLS", () => {
  let upstream: Server;
  let proxy: Server;
  let upstreamBase = "";
  let proxyBase = "";
  const seen: Array<{ path: string; range?: string }> = [];
  let endlessClosed = false;
  let slowClosed = false;
  let warmupLeft = 0;

  beforeEach(async () => {
    seen.length = 0;
    endlessClosed = false;
    slowClosed = false;
    warmupLeft = 0;
    upstream = createServer((req, res) => {
      seen.push({ path: req.url ?? "", range: req.headers.range });
      if (req.url === "/warm/index.m3u8") {
        // A live share link starting its ingest: 503 + Retry-After first.
        if (warmupLeft > 0) {
          warmupLeft -= 1;
          res.writeHead(503, { "retry-after": "0", "content-type": "text/plain" });
          res.end("warming up");
          return;
        }
        res.writeHead(200, { "content-type": "application/vnd.apple.mpegurl" });
        res.end("#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXTINF:2.0,\nseg0.ts\n");
        return;
      }
      if (req.url?.startsWith("/hls/index.m3u8")) {
        res.writeHead(200, { "content-type": "application/x-mpegURL" });
        res.end("#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXTINF:4.0,\nseg0.ts\n#EXT-X-ENDLIST\n");
        return;
      }
      if (req.url === "/hls/play") {
        // No extension: recognized by its Content-Type.
        res.writeHead(200, { "content-type": "application/vnd.apple.mpegurl" });
        res.end("#EXTM3U\n#EXTINF:4.0,\nseg0.ts\n");
        return;
      }
      if (req.url === "/hls/seg0.ts") {
        res.writeHead(200, { "content-type": "video/mp2t", "content-length": "4" });
        res.end(Buffer.from([0x47, 1, 2, 3]));
        return;
      }
      if (req.url === "/video.mp4") {
        const total = 1024 * 1024 * 1024;
        const match = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? "");
        if (!match || Number(match[1]) >= total) {
          res.writeHead(416, { "content-range": `bytes */${total}`, "accept-ranges": "bytes" });
          res.end();
          return;
        }
        const start = Number(match[1]);
        const end = Math.min(total - 1, match[2] ? Number(match[2]) : start + 31);
        const bytes = Buffer.from(Array.from({ length: end - start + 1 }, (_, index) => (start + index) % 251));
        res.writeHead(206, {
          "content-type": "video/mp4",
          "content-length": String(bytes.length),
          "content-range": `bytes ${start}-${end}/${total}`,
          "accept-ranges": "bytes",
        });
        res.end(bytes);
        return;
      }
      if (req.url === "/oversized.mp4") {
        res.writeHead(200, { "content-type": "video/mp4", "content-length": String(MAX_MEDIA_PROXY_BYTES + 1) });
        res.write("x");
        return;
      }
      if (req.url === "/endless.mp4") {
        res.writeHead(200, { "content-type": "video/mp4", "accept-ranges": "bytes" });
        const timer = setInterval(() => res.write(Buffer.alloc(64 * 1024, 0x44)), 2);
        res.on("close", () => { clearInterval(timer); endlessClosed = true; });
        return;
      }
      if (req.url === "/slow.mp4") {
        res.on("close", () => { slowClosed = true; });
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r));
    upstreamBase = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
    // Minimal stand-in for the /api/media/proxy/<token> route.
    proxy = createServer((req, res) => {
      const token = decodeURIComponent((req.url ?? "").replace(/^\/api\/media\/proxy\//, ""));
      const body = verifyMediaProxyToken(token);
      if (!body) {
        res.writeHead(403);
        res.end();
        return;
      }
      void streamProxiedMedia(body.u, res, req.headers.range, {
        threadId: body.t,
        policy: LAB,
        ...(body.u.endsWith("/slow.mp4") ? { headerTimeoutMs: 30 } : {}),
      }).catch(() => {
        if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain" });
        if (!res.writableEnded) res.end();
      });
    });
    await new Promise<void>((r) => proxy.listen(0, "127.0.0.1", r));
    proxyBase = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await new Promise((r) => upstream.close(r));
    await new Promise((r) => proxy.close(r));
  });

  it("serves a rewritten playlist whose segments play through the proxy", async () => {
    const wire = wireVideoFromEmit({ url: `${upstreamBase}/hls/index.m3u8?sig=x`, kind: "vod" }, "thread-9");
    expect(wire.format).toBe("hls");
    const playlist = await fetch(proxyBase + wire.playbackUrl, { headers: { Range: "bytes=0-10" } });
    expect(playlist.status).toBe(200);
    expect(playlist.headers.get("content-type")).toBe("application/vnd.apple.mpegurl");
    const text = await playlist.text();
    expect(text).not.toContain(upstreamBase);
    const segmentPath = text.split("\n").find((line) => line.startsWith("/api/media/proxy/"));
    expect(segmentPath).toBeTruthy();
    // The nested token is bound to the same thread and to the resolved segment URL.
    const nested = verifyMediaProxyToken(decodeURIComponent(segmentPath!.slice("/api/media/proxy/".length)));
    expect(nested).toMatchObject({ u: `${upstreamBase}/hls/seg0.ts`, t: "thread-9" });
    // Playlist fetched whole: the client's Range is not forwarded for it.
    expect(seen[0]).toEqual({ path: "/hls/index.m3u8?sig=x", range: undefined });

    const segment = await fetch(proxyBase + new URL(segmentPath!, proxyBase).pathname);
    expect(segment.status).toBe(200);
    expect(segment.headers.get("content-type")).toBe("video/mp2t");
    expect(Buffer.from(await segment.arrayBuffer())).toEqual(Buffer.from([0x47, 1, 2, 3]));
  });

  it("waits out a live playlist's 503 warm-up instead of failing the player", async () => {
    warmupLeft = 2;
    const wire = wireVideoFromEmit({ url: `${upstreamBase}/warm/index.m3u8`, kind: "live" }, "thread-9");
    const playlist = await fetch(proxyBase + wire.playbackUrl);
    expect(playlist.status).toBe(200);
    const text = await playlist.text();
    expect(text).toContain("#EXT-X-TARGETDURATION:2");
    expect(text.split("\n").some((line) => line.startsWith("/api/media/proxy/"))).toBe(true);
    expect(seen.filter((entry) => entry.path === "/warm/index.m3u8")).toHaveLength(3);
  });

  it("passes a playlist's 503 on once the warm-up retries run out", async () => {
    warmupLeft = 100;
    const wire = wireVideoFromEmit({ url: `${upstreamBase}/warm/index.m3u8`, kind: "live" }, "thread-9");
    const playlist = await fetch(proxyBase + wire.playbackUrl);
    expect(playlist.status).toBe(503);
    await playlist.arrayBuffer();
    expect(seen.filter((entry) => entry.path === "/warm/index.m3u8")).toHaveLength(7);
  }, 15_000);

  it("detects a playlist by Content-Type when the URL has no extension", async () => {
    const res = await fetch(`${proxyBase}/api/media/proxy/${mintMediaProxyToken(`${upstreamBase}/hls/play`, "t")}`);
    expect(res.headers.get("content-type")).toBe("application/vnd.apple.mpegurl");
    expect(await res.text()).toMatch(/^#EXTM3U\n#EXTINF:4.0,\n\/api\/media\/proxy\//);
  });

  it("forwards a 1 GiB video's byte range and preserves seek headers", async () => {
    const path = mediaProxyPath(mintMediaProxyToken(`${upstreamBase}/video.mp4`, "t"));
    const start = 1024 * 1024 * 1024 - 16;
    const response = await fetch(proxyBase + path, { headers: { range: `bytes=${start}-` } });
    expect(response.status).toBe(206);
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(response.headers.get("content-range")).toBe(`bytes ${start}-${start + 15}/${1024 * 1024 * 1024}`);
    expect(response.headers.get("content-length")).toBe("16");
    expect(response.headers.get("cache-control")).toBe("private, no-transform");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(Buffer.from(Array.from({ length: 16 }, (_, index) => (start + index) % 251)));
    expect(seen.at(-1)).toEqual({ path: "/video.mp4", range: `bytes=${start}-` });
  });

  it("preserves an upstream 416 so a player learns the media size", async () => {
    const path = mediaProxyPath(mintMediaProxyToken(`${upstreamBase}/video.mp4`, "t"));
    const response = await fetch(proxyBase + path, { headers: { range: `bytes=${1024 * 1024 * 1024}-` } });
    expect(response.status).toBe(416);
    expect(response.headers.get("content-range")).toBe(`bytes */${1024 * 1024 * 1024}`);
    expect(response.headers.get("accept-ranges")).toBe("bytes");
  });

  it("rejects an oversized declared response before streaming its body", async () => {
    const path = mediaProxyPath(mintMediaProxyToken(`${upstreamBase}/oversized.mp4`, "t"));
    const response = await fetch(proxyBase + path);
    expect(response.status).toBe(502);
    expect(await response.text()).toBe("");
  });

  it("stops the upstream body when the player cancels", async () => {
    const path = mediaProxyPath(mintMediaProxyToken(`${upstreamBase}/endless.mp4`, "t"));
    const response = await fetch(proxyBase + path);
    const reader = response.body!.getReader();
    expect((await reader.read()).value?.byteLength).toBeGreaterThan(0);
    await reader.cancel();
    await expect.poll(() => endlessClosed, { timeout: 5_000 }).toBe(true);
  });

  it("times out an upstream that never sends headers and closes its socket", async () => {
    const path = mediaProxyPath(mintMediaProxyToken(`${upstreamBase}/slow.mp4`, "t"));
    const response = await fetch(proxyBase + path);
    expect(response.status).toBe(502);
    await expect.poll(() => slowClosed, { timeout: 5_000 }).toBe(true);
  });
});
