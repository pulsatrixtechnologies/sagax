// Network egress through the person's computer (server/desktop/desktop-egress.ts):
// the tunnel only for the signed-in person whose desktop registered it, the
// proxy only with the thread's credential and only during that person's
// turn, and traffic really leaving through the desktop's own resolver.
import { randomUUID } from "node:crypto";
import { createServer, request, type Server } from "node:http";
import { connect } from "node:net";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DesktopBridges } from "./desktop-bridge.ts";
import { attachDesktopTunnel } from "./desktop-bridge-routes.ts";
import { DesktopTunnels, egressEnvironment, egressRoute, encodeFrame, FrameReader, isLanAddress, startEgressProxy, type EgressAuditEntry, type EgressProxy } from "./desktop-egress.ts";
import { openFakeTunnel } from "../testing/fake-desktop.ts";

// The echo is plain text, never HTML: the request path it repeats cannot
// become markup in whatever reads it.
const PLAIN_TEXT = { "content-type": "text/plain; charset=utf-8", "x-content-type-options": "nosniff" } as const;

const ADA = "pr_11111111-1111-4111-8111-111111111111";
const BOB = "pr_22222222-2222-4222-8222-222222222222";
const SECRET = "c".repeat(64);
const people = new Map([["ada-session", ADA], ["bob-session", BOB]]);
const sessionPerson = (session: string) => people.get(session) ?? null;

let server: Server;
let upstream: Server;
let base = "";
let upstreamPort = 0;
let proxy: EgressProxy;
const bridges = new DesktopBridges(sessionPerson);
const tunnels = new DesktopTunnels(sessionPerson);
const audit: EgressAuditEntry[] = [];
const adaDesktop = randomUUID();
const bobDesktop = randomUUID();
const registration = (id: string) => ({ id, name: "desk", platform: "linux" as const, attachmentsDir: "/tmp/x", capabilities: { shell: true, files: true, fetch: true, browser: true, computer: false, localVm: false } });

beforeAll(async () => {
  upstream = createServer((req, res) => res.writeHead(200, PLAIN_TEXT).end(`intranet says hi to ${req.url}`));
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  upstreamPort = (upstream.address() as AddressInfo).port;
  server = createServer((_req, res) => res.writeHead(404).end());
  attachDesktopTunnel(server, {
    organization: () => true,
    // the test's "cookie" names the session directly
    session: (req) => {
      const session = String(req.headers.cookie ?? "").replace(/^s=/, "");
      const person = sessionPerson(session);
      return person ? { id: session, person } : null;
    },
    sameOrigin: () => true,
    bridgeOwner: (id, session, secret) => bridges.owns(id, session, secret),
    tunnels,
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `ws://127.0.0.1:${(server.address() as AddressInfo).port}`;
  bridges.register(registration(adaDesktop), "ada-session", SECRET);
  bridges.register(registration(bobDesktop), "bob-session", SECRET);
  proxy = await startEgressProxy({ tunnels, audit: (entry) => audit.push(entry) });
});
afterAll(async () => {
  tunnels.close();
  await proxy?.close();
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  await new Promise<void>((resolve) => upstream?.close(() => resolve()));
});

/** Only Ada's desktop knows intranet.test. */
const adaNetwork = (host: string, port: number) => host === "intranet.test" ? { host: "127.0.0.1", port: upstreamPort } : host === "public.example" ? null : { host, port };

function viaProxy(proxyUrl: string, url: string): Promise<{ status: number; body: string }> {
  const parsed = new URL(proxyUrl);
  return new Promise((resolve, reject) => {
    const req = request({
      host: parsed.hostname, port: parsed.port, path: url, method: "GET",
      headers: { host: new URL(url).host, ...(parsed.password ? { "proxy-authorization": `Basic ${Buffer.from(`${parsed.username}:${parsed.password}`).toString("base64")}` } : {}) },
    }, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

function connectVia(proxyUrl: string, target: string, auth = true): Promise<string> {
  const parsed = new URL(proxyUrl);
  return new Promise((resolve, reject) => {
    const socket = connect(Number(parsed.port), parsed.hostname);
    let data = "";
    socket.on("data", (chunk) => {
      data += chunk;
      if (data.startsWith("HTTP/1.1 200")) {
        if (!data.includes("intranet says")) socket.write("GET /tls-ish HTTP/1.1\r\nhost: intranet.test\r\nconnection: close\r\n\r\n");
      }
    });
    socket.on("end", () => resolve(data));
    socket.on("error", reject);
    socket.write(`CONNECT ${target} HTTP/1.1\r\nhost: ${target}\r\n${auth ? `proxy-authorization: Basic ${Buffer.from(`sagax:${parsed.password}`).toString("base64")}\r\n` : ""}\r\n`);
  });
}

describe("the tunnel", () => {
  it("refuses a session that did not register the desktop, or a wrong secret", async () => {
    await expect(openFakeTunnel({ url: `${base}/api/desktop-bridge/${adaDesktop}/tunnel`, headers: { cookie: "s=bob-session", "x-sagax-bridge-secret": SECRET } }).ready).rejects.toThrow();
    await expect(openFakeTunnel({ url: `${base}/api/desktop-bridge/${adaDesktop}/tunnel`, headers: { cookie: "s=ada-session", "x-sagax-bridge-secret": "d".repeat(64) } }).ready).rejects.toThrow();
    await expect(openFakeTunnel({ url: `${base}/api/desktop-bridge/${adaDesktop}/tunnel`, headers: { "x-sagax-bridge-secret": SECRET } }).ready).rejects.toThrow();
    expect(tunnels.connected(ADA)).toBe(false);
  });
});

describe("the egress proxy", () => {
  let live = true;
  let network: "all" | "lan" = "all";
  const opened: string[] = [];
  let adaProxy = "";

  beforeAll(async () => {
    const tunnel = openFakeTunnel({ url: `${base}/api/desktop-bridge/${adaDesktop}/tunnel`, headers: { cookie: "s=ada-session", "x-sagax-bridge-secret": SECRET }, resolve: adaNetwork, opened });
    await tunnel.ready;
    for (let tries = 0; tries < 50 && !tunnels.connected(ADA); tries++) await new Promise((resolve) => setTimeout(resolve, 20));
    expect(tunnels.connected(ADA)).toBe(true);
    adaProxy = proxy.urlFor({ person: ADA, botId: "bot1", threadId: "t1", active: () => live, network: () => network });
  });

  it("routes plain HTTP through the person's desktop, to a host only their network knows", async () => {
    const answer = await viaProxy(adaProxy, "http://intranet.test/report");
    expect(answer).toEqual({ status: 200, body: "intranet says hi to /report" });
    expect(opened).toContain("intranet.test:80");
    expect(audit.at(-1)).toMatchObject({ person: ADA, host: "intranet.test", port: 80, via: "desktop", ok: true });
  });

  it("tunnels CONNECT (https) through the desktop", async () => {
    const raw = await connectVia(adaProxy, "intranet.test:443");
    expect(raw).toMatch(/^HTTP\/1.1 200 Connection Established/);
    expect(raw).toContain("intranet says hi to /tls-ish");
    expect(opened).toContain("intranet.test:443");
  });

  it("is no open proxy: no credential, a wrong one, or after the turn ended", async () => {
    expect((await viaProxy(adaProxy.replace(/:[a-f0-9]{64}@/, "@"), "http://intranet.test/")).status).toBe(407);
    expect((await viaProxy(adaProxy.replace(/:[a-f0-9]{64}@/, `:${"e".repeat(64)}@`), "http://intranet.test/")).status).toBe(407);
    expect(await connectVia(adaProxy, "intranet.test:443", false)).toMatch(/^HTTP\/1.1 407/);
    live = false;
    expect((await viaProxy(adaProxy, "http://intranet.test/")).status).toBe(403);
    expect(await connectVia(adaProxy, "intranet.test:443")).toMatch(/^HTTP\/1.1 403/);
    live = true;
  });

  it("uses only that person's own tunnel: Bob's credential never reaches Ada's desktop", async () => {
    const before = opened.length;
    const bobProxy = proxy.urlFor({ person: BOB, botId: "bot1", threadId: "t2", active: () => true, network: () => "all" });
    const answer = await viaProxy(bobProxy, "http://intranet.test/");
    expect(answer.status).toBe(502);
    expect(answer.body).toMatch(/not connected/);
    expect(opened.length).toBe(before);
  });

  it("revoking a thread ends its credential", async () => {
    const other = proxy.urlFor({ person: ADA, botId: "bot1", threadId: "t3", active: () => true, network: () => "all" });
    proxy.revoke("t3");
    expect((await viaProxy(other, "http://intranet.test/")).status).toBe(407);
  });

  it("local network only: public destinations leave from the server, LAN ones through the desktop", async () => {
    network = "lan";
    const before = opened.length;
    // an IP literal outside the LAN never asks the desktop
    const direct = await viaProxy(adaProxy, `http://127.0.0.1:${upstreamPort}/direct`);
    expect(direct.body).toBe("intranet says hi to /direct");
    expect(opened.length).toBe(before);
    expect(audit.at(-1)).toMatchObject({ via: "direct" });
    // a name the desktop says is outside its LAN falls back to direct
    const fallback = await viaProxy(adaProxy, "http://public.example/").catch(() => ({ status: 0, body: "" }));
    expect(opened.at(-1)).toBe("public.example:80");
    expect(fallback.status).not.toBe(200);
    // a LAN name still goes through the desktop
    expect((await viaProxy(adaProxy, "http://intranet.test/lan")).body).toBe("intranet says hi to /lan");
    network = "all";
  });

  it("closes when the session is no longer that person's", async () => {
    people.set("ada-session", BOB);
    expect(tunnels.connected(ADA)).toBe(false);
    people.set("ada-session", ADA);
  });
});

describe("pieces", () => {
  it("frames round-trip (masked client frames, fragmented)", () => {
    const reader = new FrameReader();
    const mask = Buffer.from([1, 2, 3, 4]);
    const masked = (fin: boolean, opcode: number, data: Buffer) => {
      const payload = Buffer.from(data.map((byte, index) => byte ^ mask[index % 4]!));
      return Buffer.concat([Buffer.from([(fin ? 0x80 : 0) | opcode, 0x80 | payload.length]), mask, payload]);
    };
    const both = Buffer.concat([masked(false, 2, Buffer.from("hel")), masked(true, 0, Buffer.from("lo"))]);
    expect(reader.push(both.subarray(0, 5))).toEqual([]);
    expect(reader.push(both.subarray(5)).map((entry) => [entry.opcode, entry.payload.toString()])).toEqual([[2, "hello"]]);
    expect(encodeFrame(2, Buffer.alloc(70_000)).subarray(0, 2)).toEqual(Buffer.from([0x82, 127]));
    expect(() => new FrameReader().push(Buffer.from([0x82, 0x01, 0x00]))).toThrow(/masked/);
  });
  it("knows the LAN and the routes", () => {
    for (const address of ["10.1.2.3", "172.20.0.1", "192.168.1.10", "100.100.1.1", "fd12:3456::1"]) expect(isLanAddress(address)).toBe(true);
    for (const address of ["8.8.8.8", "127.0.0.1", "169.254.169.254", "172.32.0.1", "::1"]) expect(isLanAddress(address)).toBe(false);
    expect(egressRoute("intranet.local", "all")).toBe("desktop");
    expect(egressRoute("10.0.0.5", "lan")).toBe("desktop");
    expect(egressRoute("8.8.8.8", "lan")).toBe("direct");
    expect(egressRoute("intranet.local", "lan")).toBe("ask");
  });
  it("never sends model traffic through the person's computer", () => {
    const env = egressEnvironment("http://sagax:x@127.0.0.1:1", ["llm.acme.test"]);
    expect(env.HTTPS_PROXY).toBe("http://sagax:x@127.0.0.1:1");
    expect(env.NO_PROXY.split(",")).toEqual(expect.arrayContaining(["127.0.0.1", "localhost", "api.anthropic.com", "api.openai.com", "llm.acme.test"]));
  });
});
