import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  blockedAddressReason,
  checkMediaDestination,
  MediaProxyBlockedError,
  mediaUrlMayBeProxied,
  parseMediaProxyAllowList,
  type MediaProxyResolver,
} from "./media-proxy-guard.ts";
import { initMediaProxy, mintMediaProxyToken, needsMediaProxy, rewriteHlsPlaylist, streamProxiedMedia } from "./media-proxy.ts";
import { handleMediaProxy } from "../routes/media-widgets.ts";

const NONE = parseMediaProxyAllowList("");

function fakeResolver(table: Record<string, string[]>, calls: string[] = []): MediaProxyResolver {
  return async (host) => {
    calls.push(host);
    const found = table[host];
    if (!found) throw Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" });
    return found.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }) as const);
  };
}

async function reasonFor(url: string, policy = NONE, resolver?: MediaProxyResolver): Promise<string | null> {
  try {
    await checkMediaDestination(new URL(url), policy, resolver ?? fakeResolver({}));
    return null;
  } catch (error) {
    if (error instanceof MediaProxyBlockedError) return error.reason;
    throw error;
  }
}

describe("blockedAddressReason", () => {
  it.each([
    ["127.0.0.1", "loopback"],
    ["127.255.255.254", "loopback"],
    ["::1", "loopback"],
    ["0.0.0.0", "unspecified"],
    ["::", "unspecified"],
    ["0.1.2.3", "reserved"],
    ["169.254.10.20", "link-local"],
    ["fe80::1", "link-local"],
    ["febf::1", "link-local"],
    ["169.254.169.254", "metadata"],
    ["168.63.129.16", "metadata"],
    ["fd00:ec2::254", "metadata"],
    ["10.1.2.3", "private"],
    ["172.16.0.1", "private"],
    ["172.31.255.255", "private"],
    ["192.168.1.10", "private"],
    ["100.64.0.1", "cgnat"],
    ["100.100.100.100", "cgnat"],
    ["100.127.255.255", "cgnat"],
    ["fc00::1", "ula"],
    ["fd7a:115c:a1e0::1", "ula"],
    ["224.0.0.1", "multicast"],
    ["239.255.255.250", "multicast"],
    ["ff02::1", "multicast"],
    ["240.0.0.1", "reserved"],
    ["255.255.255.255", "reserved"],
    ["192.0.2.1", "reserved"],
    ["198.18.0.1", "reserved"],
    ["2001:db8::1", "reserved"],
    ["2002:7f00:1::", "reserved"],
    ["::ffff:127.0.0.1", "ipv4-mapped"],
    ["::ffff:7f00:1", "ipv4-mapped"],
    ["::ffff:169.254.169.254", "ipv4-mapped"],
    ["::ffff:8.8.8.8", "ipv4-mapped"],
    ["::127.0.0.1", "ipv4-mapped"],
    ["64:ff9b::a00:1", "ipv4-mapped"],
    ["100::1", "reserved"],
  ])("refuses %s (%s)", (address, reason) => {
    expect(blockedAddressReason(address)).toBe(reason);
  });

  it.each(["8.8.8.8", "142.250.72.14", "172.32.0.1", "100.128.0.1", "2606:4700:4700::1111", "2a00:1450:4001::200e"])(
    "accepts the public address %s",
    (address) => {
      expect(blockedAddressReason(address)).toBeNull();
    },
  );

  it("knows the edges of 172.16.0.0/12 and 100.64.0.0/10", () => {
    expect(blockedAddressReason("172.15.255.255")).toBeNull();
    expect(blockedAddressReason("100.63.255.255")).toBeNull();
  });
});

describe("checkMediaDestination", () => {
  it.each([
    ["http://127.0.0.1/x.m3u8", "loopback"],
    ["http://2130706433/", "loopback"],
    ["http://0x7f.1/", "loopback"],
    ["http://[::1]/x", "loopback"],
    ["http://localhost/x", "loopback"],
    ["http://api.localhost/x", "loopback"],
    ["http://0.0.0.0/", "unspecified"],
    ["http://[::]/", "unspecified"],
    ["http://169.254.169.254/latest/meta-data/", "metadata"],
    ["http://168.63.129.16/machine?comp=goalstate", "metadata"],
    ["http://[fd00:ec2::254]/latest", "metadata"],
    ["http://[fe80::1]/", "link-local"],
    ["http://10.0.0.5/live.m3u8", "private"],
    ["http://192.168.1.20:8080/x", "private"],
    ["http://100.101.102.103/x", "cgnat"],
    ["http://[fd12:3456::1]/x", "ula"],
    ["http://[::ffff:127.0.0.1]/x", "ipv4-mapped"],
    ["http://[::ffff:a9fe:a9fe]/x", "ipv4-mapped"],
    ["http://224.0.0.251/x", "multicast"],
    ["ftp://8.8.8.8/x", "scheme"],
    ["file:///etc/passwd", "scheme"],
  ])("refuses %s", async (url, reason) => {
    expect(await reasonFor(url)).toBe(reason);
  });

  it("checks the addresses a name resolves to, all of them", async () => {
    const resolver = fakeResolver({
      "rebind.example": ["127.0.0.1"],
      "meta.example": ["169.254.169.254"],
      "mixed.example": ["93.184.216.34", "10.0.0.7"],
      "six.example": ["::ffff:10.0.0.1"],
      "cdn.example": ["93.184.216.34", "2606:2800:220:1::1"],
    });
    expect(await reasonFor("https://rebind.example/v.mp4", NONE, resolver)).toBe("loopback");
    expect(await reasonFor("https://meta.example/v.mp4", NONE, resolver)).toBe("metadata");
    expect(await reasonFor("https://mixed.example/v.mp4", NONE, resolver)).toBe("private");
    expect(await reasonFor("https://six.example/v.mp4", NONE, resolver)).toBe("ipv4-mapped");
    expect(await reasonFor("https://nowhere.example/v.mp4", NONE, resolver)).toBe("unresolved");
    expect(await checkMediaDestination(new URL("https://cdn.example/v.mp4"), NONE, resolver)).toEqual({ address: "93.184.216.34", family: 4 });
  });

  it("accepts public URLs without any configuration (YouTube, public Glitcho, CDN)", async () => {
    const resolver = fakeResolver({
      "qc1.glitcho-server.devjc.net": ["104.21.32.1"],
      "rr3---sn-t0aedn7l.googlevideo.com": ["173.194.183.200", "2607:f8b0:4002:c00::1"],
      "i.ytimg.com": ["142.250.72.14"],
    });
    expect(await reasonFor("https://qc1.glitcho-server.devjc.net/v1/share/live/x/index.m3u8?t=s", NONE, resolver)).toBeNull();
    expect(await reasonFor("https://rr3---sn-t0aedn7l.googlevideo.com/videoplayback?id=1", NONE, resolver)).toBeNull();
    expect(await reasonFor("http://i.ytimg.com/vi/x/hq.jpg", NONE, resolver)).toBeNull();
    expect(await reasonFor("https://8.8.8.8/x")).toBeNull();
  });

  it("limits public destinations to ports 80 and 443", async () => {
    const resolver = fakeResolver({ "cdn.example": ["93.184.216.34"] });
    expect(await reasonFor("https://cdn.example:8443/v.mp4", NONE, resolver)).toBe("port");
    expect(await reasonFor("http://cdn.example:22/", NONE, resolver)).toBe("port");
    expect(await reasonFor("https://cdn.example:443/v.mp4", NONE, resolver)).toBeNull();
  });

  it("lets the allow list open a private host by name, wildcard or CIDR, on any port", async () => {
    const policy = parseMediaProxyAllowList("glitcho.lan, *.tail1234.ts.net 192.168.1.0/24,100.64.0.0/10 bogus/entry");
    const resolver = fakeResolver({
      "glitcho.lan": ["192.168.50.4"],
      "box.tail1234.ts.net": ["100.90.1.2"],
      "tail1234.ts.net": ["100.90.1.3"],
      "nas.home": ["192.168.1.30"],
      "other.home": ["192.168.2.30"],
    });
    expect(await reasonFor("http://glitcho.lan:8080/live.m3u8", policy, resolver)).toBeNull();
    expect(await reasonFor("http://box.tail1234.ts.net:9000/x", policy, resolver)).toBeNull();
    // `*.` covers sub-domains only; this one still passes through its CIDR.
    expect(await reasonFor("http://tail1234.ts.net:9000/x", policy, resolver)).toBeNull();
    expect(await reasonFor("http://nas.home:8096/x", policy, resolver)).toBeNull();
    expect(await reasonFor("http://192.168.1.31:8096/x", policy)).toBeNull();
    expect(await reasonFor("http://other.home/x", policy, resolver)).toBe("private");
    expect(await reasonFor("http://10.0.0.5/x", policy)).toBe("private");
  });

  it("never opens a cloud metadata address through a host name, even an allowed one", async () => {
    const policy = parseMediaProxyAllowList("glitcho.lan");
    const resolver = fakeResolver({ "glitcho.lan": ["169.254.169.254"] });
    expect(await reasonFor("http://glitcho.lan/latest", policy, resolver)).toBe("metadata");
  });

  it("accepts an IPv4-mapped address when its IPv4 is allowed", async () => {
    const policy = parseMediaProxyAllowList("10.0.0.0/8");
    expect(await reasonFor("http://[::ffff:10.0.0.5]/x", policy)).toBeNull();
    expect(await reasonFor("http://[::ffff:127.0.0.1]/x", policy)).toBe("ipv4-mapped");
  });
});

describe("playlist rewrite and the allow list", () => {
  const mint = (u: string) => `/p/${encodeURIComponent(u)}`;
  const playlist = "#EXTM3U\n#EXTINF:4,\nseg0.ts\n#EXTINF:4,\nhttp://10.0.0.5/live/seg1.ts\n";

  it("does not turn private URIs into proxy paths when the host is not allowed", () => {
    expect(rewriteHlsPlaylist(playlist, "http://10.0.0.5/live/index.m3u8", mint, NONE)).toBe(playlist);
    const v6 = "#EXTM3U\n#EXTINF:4,\nhttp://[::1]:8080/seg.ts\n";
    expect(rewriteHlsPlaylist(v6, "http://[::1]:8080/index.m3u8", mint, NONE)).toBe(v6);
    const local = "#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI=\"key\"\n";
    expect(rewriteHlsPlaylist(local, "http://localhost/index.m3u8", mint, NONE)).toBe(local);
  });

  it("rewrites them when the host is allowed", () => {
    const out = rewriteHlsPlaylist(playlist, "http://10.0.0.5/live/index.m3u8", mint, parseMediaProxyAllowList("10.0.0.5"));
    expect(out).toContain(mint("http://10.0.0.5/live/seg0.ts"));
    expect(out).toContain(mint("http://10.0.0.5/live/seg1.ts"));
  });

  it("keeps segments of other origins, private or not, untouched", () => {
    const text = "#EXTM3U\n#EXTINF:4,\nhttp://192.168.1.9/seg.ts\n#EXTINF:4,\nhttps://cdn.example/seg.ts\n#EXTINF:4,\nseg2.ts\n";
    const out = rewriteHlsPlaylist(text, "https://qc1.glitcho-server.devjc.net/v1/share/live/x/index.m3u8", mint, NONE);
    expect(out).toContain("\nhttp://192.168.1.9/seg.ts\n");
    expect(out).toContain("\nhttps://cdn.example/seg.ts\n");
    expect(out).toContain(mint("https://qc1.glitcho-server.devjc.net/v1/share/live/x/seg2.ts"));
  });

  it("mediaUrlMayBeProxied follows the same rule", () => {
    expect(mediaUrlMayBeProxied(new URL("https://cdn.example/a.ts"), NONE)).toBe(true);
    expect(mediaUrlMayBeProxied(new URL("http://169.254.169.254/"), NONE)).toBe(false);
    expect(mediaUrlMayBeProxied(new URL("http://[fd00:ec2::254]/"), NONE)).toBe(false);
  });

  it("still routes literal non-public hosts through the proxy (needsMediaProxy)", () => {
    expect(needsMediaProxy("http://100.90.1.2/x.m3u8")).toBe(true);
    expect(needsMediaProxy("http://[::1]/x.m3u8")).toBe(true);
    expect(needsMediaProxy("https://cdn.example/x.mp4")).toBe(false);
  });
});

describe("streamProxiedMedia against real sockets", () => {
  let upstream: Server;
  let port = 0;
  const seen: string[] = [];

  beforeEach(async () => {
    initMediaProxy(mkdtempSync(join(tmpdir(), "sagax-media-guard-")));
    seen.length = 0;
    upstream = createServer((req, res) => {
      seen.push(req.url ?? "");
      const url = req.url ?? "";
      if (url === "/seg.ts") {
        res.writeHead(200, { "content-type": "video/mp2t", "content-length": "3" });
        res.end(Buffer.from([0x47, 9, 9]));
      } else if (url === "/to-loopback") {
        res.writeHead(302, { location: `http://127.0.0.1:${port}/seg.ts` });
        res.end();
      } else if (url === "/to-private-name") {
        res.writeHead(301, { location: `http://internal.test:${port}/seg.ts` });
        res.end();
      } else if (url === "/to-same-host") {
        res.writeHead(307, { location: "/seg.ts" });
        res.end();
      } else if (url.startsWith("/loop")) {
        res.writeHead(302, { location: `/loop${seen.length}` });
        res.end();
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r));
    port = (upstream.address() as AddressInfo).port;
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    await new Promise((r) => upstream.close(r));
  });

  async function run(target: string, policy = NONE, resolver?: MediaProxyResolver) {
    const proxy = createServer((_req, res) => {
      streamProxiedMedia(target, res, undefined, { threadId: "t", policy, resolver }).catch((error: unknown) => {
        res.writeHead(error instanceof MediaProxyBlockedError ? 403 : 502, { "x-reason": error instanceof MediaProxyBlockedError ? error.reason : "error" });
        res.end();
      });
    });
    await new Promise<void>((r) => proxy.listen(0, "127.0.0.1", r));
    try {
      const res = await fetch(`http://127.0.0.1:${(proxy.address() as AddressInfo).port}/`);
      return { status: res.status, reason: res.headers.get("x-reason"), body: Buffer.from(await res.arrayBuffer()) };
    } finally {
      await new Promise((r) => proxy.close(r));
    }
  }

  it("refuses a name resolving to a private address before connecting to it", async () => {
    const out = await run(`http://sneaky.test:${port}/seg.ts`, NONE, fakeResolver({ "sneaky.test": ["127.0.0.1"] }));
    expect(out).toMatchObject({ status: 403, reason: "loopback" });
    expect(seen).toEqual([]);
  });

  it("connects to the address it checked, resolving the name once (no rebinding window)", async () => {
    const calls: string[] = [];
    const policy = parseMediaProxyAllowList("media.test");
    const out = await run(`http://media.test:${port}/seg.ts`, policy, fakeResolver({ "media.test": ["127.0.0.1"] }, calls));
    expect(out.status).toBe(200);
    expect(out.body).toEqual(Buffer.from([0x47, 9, 9]));
    expect(calls).toEqual(["media.test"]);
  });

  it("refuses a redirect from an allowed host to a private address", async () => {
    const policy = parseMediaProxyAllowList("public.test");
    const resolver = fakeResolver({ "public.test": ["127.0.0.1"], "internal.test": ["10.0.0.9"] });
    expect(await run(`http://public.test:${port}/to-loopback`, policy, resolver)).toMatchObject({ status: 403, reason: "loopback" });
    expect(await run(`http://public.test:${port}/to-private-name`, policy, resolver)).toMatchObject({ status: 403, reason: "private" });
    // Neither private target was ever contacted.
    expect(seen).toEqual(["/to-loopback", "/to-private-name"]);
  });

  it("follows a redirect that stays on an allowed destination", async () => {
    const policy = parseMediaProxyAllowList("public.test");
    const out = await run(`http://public.test:${port}/to-same-host`, policy, fakeResolver({ "public.test": ["127.0.0.1"] }));
    expect(out.status).toBe(200);
    expect(seen).toEqual(["/to-same-host", "/seg.ts"]);
  });

  it("stops after five redirects", async () => {
    const out = await run(`http://127.0.0.1:${port}/loop`, parseMediaProxyAllowList("127.0.0.1"));
    expect(out).toMatchObject({ status: 403, reason: "too-many-redirects" });
    expect(seen).toHaveLength(6);
  });

  it("answers the client with a generic 403 and logs the reason without token or URL", async () => {
    vi.stubEnv("SAGAX_MEDIA_PROXY_ALLOW_HOSTS", "");
    const logged: string[] = [];
    for (const level of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        logged.push(args.map(String).join(" "));
      });
    }
    const secretPath = `/private/recording.m3u8?sig=s3cr3t-signature`;
    const token = mintMediaProxyToken(`http://127.0.0.1:${port}${secretPath}`, "thread-x");
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      void handleMediaProxy(req, res, req.url ?? "", req.method ?? "GET");
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    try {
      const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/media/proxy/${token}`);
      expect(res.status).toBe(403);
      const body = await res.text();
      expect(JSON.parse(body)).toEqual({ error: "Media source not allowed" });
      expect(body).not.toMatch(/loopback|127\.0\.0\.1/);
    } finally {
      await new Promise((r) => server.close(r));
    }
    expect(seen).toEqual([]);
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain("loopback");
    const all = logged.join("\n");
    expect(all).not.toContain(token);
    expect(all).not.toContain(token.split(".")[0]!.slice(0, 24));
    expect(all).not.toContain("s3cr3t");
    expect(all).not.toContain("/private/recording");
  });
});
