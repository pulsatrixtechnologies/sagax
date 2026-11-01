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
  rewriteHlsPlaylist,
  streamProxiedMedia,
  verifyMediaProxyToken,
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
    // Another origin is never followed by the proxy.
    expect(out[11]).toBe("https://cdn.public.example/seg3.ts");
  });

  it("leaves public absolute same-origin URIs direct (Glitcho share links)", () => {
    const playlist = "#EXTM3U\n#EXTINF:2,\nhttps://glitcho.example/v1/live/ninja/seg/9.ts?t=s\n";
    expect(rewriteHlsPlaylist(playlist, "https://glitcho.example/v1/share/live/ninja/index.m3u8", mint)).toBe(playlist);
  });

  it("rewrites variant playlists of a multivariant playlist", () => {
    const playlist = "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000\nlow/index.m3u8\n";
    const out = rewriteHlsPlaylist(playlist, "http://10.0.0.5/live/master.m3u8", mint, LAB);
    expect(out).toContain(mint("http://10.0.0.5/live/low/index.m3u8"));
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

  beforeEach(async () => {
    seen.length = 0;
    endlessClosed = false;
    slowClosed = false;
    upstream = createServer((req, res) => {
      seen.push({ path: req.url ?? "", range: req.headers.range });
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
