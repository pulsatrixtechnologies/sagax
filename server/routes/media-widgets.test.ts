// GET /api/media/proxy/<token> without a session (iOS AVPlayer, <video>, cast
// receivers): the signed token in the path is the whole authorization, and it
// opens this one route only.
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initMediaProxy, mediaProxyPath, mintMediaProxyToken } from "../media-proxy.ts";
import { resolveRequestAuth } from "../request-auth.ts";
import { SessionRegistry } from "../sessions.ts";
import { handleMediaProxy } from "./media-widgets.ts";

const listen = (server: Server) =>
  new Promise<string>((resolve) => server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)));
const close = (server: Server) => new Promise<void>((resolve) => server.close(() => resolve()));

describe("media proxy route without a session", () => {
  let dir: string;
  let upstream: Server;
  let upstreamUrl: string;
  let upstreamHits: string[];
  let app: Server;
  let appUrl: string;
  let now: number | undefined;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "sagax-media-route-"));
    initMediaProxy(dir);
    // The test upstream listens on loopback, which the proxy refuses unless allowed.
    vi.stubEnv("SAGAX_MEDIA_PROXY_ALLOW_HOSTS", "127.0.0.1");
    upstreamHits = [];
    upstream = createServer((req, res) => {
      upstreamHits.push(req.url ?? "");
      if (req.url === "/live/index.m3u8") {
        res.writeHead(200, { "content-type": "application/vnd.apple.mpegurl" });
        res.end("#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXTINF:2,\nseg0.ts\n");
        return;
      }
      if (req.url === "/live/seg0.ts") {
        res.writeHead(200, { "content-type": "video/mp2t" });
        res.end("SEGMENT");
        return;
      }
      if (req.url === "/broken.mp4") {
        res.writeHead(200, { "content-type": "video/mp4" });
        res.write("PARTIAL");
        setTimeout(() => res.destroy(), 10);
        return;
      }
      res.writeHead(404);
      res.end();
    });
    upstreamUrl = await listen(upstream);
    now = undefined;
    app = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://x");
      void handleMediaProxy(req, res, url.pathname, req.method ?? "GET", now).then((handled) => {
        if (!handled) {
          res.writeHead(418);
          res.end();
        }
      });
    });
    appUrl = await listen(app);
  });

  afterEach(async () => {
    await close(app);
    await close(upstream);
    rmSync(dir, { recursive: true, force: true });
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("plays an HLS playlist and its segment with the signed path alone (no header, no cookie)", async () => {
    const path = mediaProxyPath(mintMediaProxyToken(`${upstreamUrl}/live/index.m3u8`, "thread-1"));
    const playlist = await fetch(appUrl + path);
    expect(playlist.status).toBe(200);
    expect(playlist.headers.get("referrer-policy")).toBe("no-referrer");
    expect(playlist.headers.get("x-content-type-options")).toBe("nosniff");
    const text = await playlist.text();
    const segment = text.split("\n").find((line) => line.startsWith("/api/media/proxy/"));
    expect(segment).toBeTruthy();
    const bytes = await fetch(appUrl + segment!);
    expect(bytes.status).toBe(200);
    expect(await bytes.text()).toBe("SEGMENT");
    expect(upstreamHits).toEqual(["/live/index.m3u8", "/live/seg0.ts"]);
  });

  it("refuses a tampered token, and a token moved to another thread, before reaching the source", async () => {
    const token = mintMediaProxyToken(`${upstreamUrl}/live/index.m3u8`, "thread-1");
    const [payload, mac] = token.split(".");
    const flipped = mac.slice(0, -1) + (mac.endsWith("A") ? "B" : "A");
    const body = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
    const otherThread = Buffer.from(JSON.stringify({ ...body, t: "thread-2" })).toString("base64url");
    const otherUrl = Buffer.from(JSON.stringify({ ...body, u: `${upstreamUrl}/live/seg0.ts` })).toString("base64url");
    for (const bad of [`${payload}.${flipped}`, `${otherThread}.${mac}`, `${otherUrl}.${mac}`, payload, "", "%E0%A4%A"]) {
      const res = await fetch(`${appUrl}/api/media/proxy/${bad}`);
      expect(res.status, bad).toBe(403);
    }
    expect(upstreamHits).toEqual([]);
  });

  it("refuses a token minted by another server (another key)", async () => {
    const token = mintMediaProxyToken(`${upstreamUrl}/live/index.m3u8`, "thread-1");
    initMediaProxy(mkdtempSync(join(tmpdir(), "sagax-media-other-")));
    expect((await fetch(appUrl + mediaProxyPath(token))).status).toBe(403);
    expect(upstreamHits).toEqual([]);
  });

  it("refuses an expired token", async () => {
    const minted = 1_000_000;
    const token = mintMediaProxyToken(`${upstreamUrl}/live/index.m3u8`, "thread-1", minted);
    now = minted + 4 * 60 * 60_000 + 1;
    expect((await fetch(appUrl + mediaProxyPath(token))).status).toBe(403);
    now = minted + 60_000;
    expect((await fetch(appUrl + mediaProxyPath(token))).status).toBe(200);
  });

  it("refuses a token not bound to a thread", async () => {
    const token = mintMediaProxyToken(`${upstreamUrl}/live/index.m3u8`);
    expect((await fetch(appUrl + mediaProxyPath(token))).status).toBe(403);
    expect(upstreamHits).toEqual([]);
  });

  it("answers GET only", async () => {
    const path = mediaProxyPath(mintMediaProxyToken(`${upstreamUrl}/live/index.m3u8`, "thread-1"));
    expect((await fetch(appUrl + path, { method: "POST" })).status).toBe(418);
    expect((await fetch(appUrl + path, { method: "DELETE" })).status).toBe(418);
    expect(upstreamHits).toEqual([]);
  });

  it("never logs the token or the source URL", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((level) => vi.spyOn(console, level).mockImplementation(() => {}));
    const token = mintMediaProxyToken(`${upstreamUrl}/live/index.m3u8`, "thread-1");
    await fetch(appUrl + mediaProxyPath(token));
    await fetch(appUrl + mediaProxyPath(token.slice(0, -2) + "xx"));
    await fetch(appUrl + mediaProxyPath(mintMediaProxyToken("http://127.0.0.1:1/unreachable.mp4", "thread-1")));
    const logged = spies.flatMap((spy) => spy.mock.calls.flat().map(String)).join("\n");
    expect(logged).not.toContain(token.split(".")[1]);
    expect(logged).not.toContain(upstreamUrl);
  });

  it("breaks a started response when upstream truncates it", async () => {
    const path = mediaProxyPath(mintMediaProxyToken(`${upstreamUrl}/broken.mp4`, "thread-1"));
    const response = await fetch(appUrl + path);
    expect(response.status).toBe(200);
    await expect(response.arrayBuffer()).rejects.toThrow();
  });
});

describe("the media token is not a session credential", () => {
  let dir: string;
  let sessions: SessionRegistry;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sagax-media-auth-"));
    initMediaProxy(dir);
    sessions = new SessionRegistry({ file: join(dir, "sessions.json") });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const gate = (path: string, headers: Record<string, string>) =>
    resolveRequestAuth({ headers: { host: "sagax.example.com", ...headers }, method: "GET" } as unknown as IncomingMessage, {
      sessions, cookieName: "sgx_session", streamPath: "/api/events", url: new URL(path, "http://x"),
    });

  it("a remote player without a session is refused by the gate: only the pre-gate media handler serves it", () => {
    const path = mediaProxyPath(mintMediaProxyToken("http://127.0.0.1:9/live.m3u8", "thread-1"));
    expect(gate(path, { "user-agent": "AppleCoreMedia/1.0" }).auth).toBeNull();
  });

  it("opens no other route, as a bearer, a cookie or a query parameter", () => {
    const token = mintMediaProxyToken("http://127.0.0.1:9/live.m3u8", "thread-1");
    for (const path of ["/api/bots", "/api/events", `/api/events?ticket=${token}`, "/api/threads/thread-1/messages", "/api/youtube/transcript"]) {
      expect(gate(path, { authorization: `Bearer ${token}` }).auth, path).toBeNull();
      expect(gate(path, { cookie: `sgx_session=${token}` }).auth, path).toBeNull();
      expect(gate(path, {}).auth, path).toBeNull();
    }
  });
});
