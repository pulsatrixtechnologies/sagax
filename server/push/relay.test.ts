import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";

import { createPushRelayRoutes } from "../routes/push-relay.ts";
import { PASS } from "../routes/table.ts";
import { createPushDeviceStore } from "./devices.ts";
import { PushHub } from "./hub.ts";
import { ApnsRelaySender, parseRelayEnvelope, readApnsRelayConfig, readApnsRelayTokens, RelayRateLimiter, type RelayFetch } from "./relay.ts";

const SECRET = "s".repeat(40);
const TOKEN = "a".repeat(64);
const TOPIC = "ca.pulsatrix.sagax";
const request = () => ({ headers: { "apns-push-type": "alert", "apns-topic": TOPIC, "apns-priority": "10" }, body: JSON.stringify({ aps: { alert: { title: "x" } } }) });

describe("relay config", () => {
  it("needs https (or http on loopback) and a 32 to 256 character secret", () => {
    expect(readApnsRelayConfig({})).toMatchObject({ configured: false });
    expect(readApnsRelayConfig({ SAGAX_APNS_RELAY_URL: "http://relay.example", SAGAX_APNS_RELAY_TOKEN: SECRET })).toMatchObject({ configured: false });
    expect(readApnsRelayConfig({ SAGAX_APNS_RELAY_URL: "https://relay.example", SAGAX_APNS_RELAY_TOKEN: "short" })).toMatchObject({ configured: false });
    expect(readApnsRelayConfig({ SAGAX_APNS_RELAY_URL: "https://relay.example/", SAGAX_APNS_RELAY_TOKEN: SECRET }))
      .toEqual({ configured: true, url: "https://relay.example/api/push/relay", token: SECRET });
    expect(readApnsRelayConfig({ SAGAX_APNS_RELAY_URL: "http://127.0.0.1:5190", SAGAX_APNS_RELAY_TOKEN: SECRET })).toMatchObject({ configured: true });
  });
  it("the relay keeps only valid secrets", () => {
    expect(readApnsRelayTokens({ SAGAX_APNS_RELAY_TOKENS: ` ${SECRET} ,bad,${"t".repeat(32)}` })).toEqual([SECRET, "t".repeat(32)]);
    expect(readApnsRelayTokens({})).toEqual([]);
  });
});

describe("relay envelope", () => {
  it("accepts a prepared push to this app, refuses other topics, headers, tokens and big bodies", () => {
    expect(parseRelayEnvelope({ token: TOKEN.toUpperCase(), environment: "production", ...request() }, TOPIC)).toMatchObject({ ok: true, envelope: { token: TOKEN } });
    expect(parseRelayEnvelope({ token: TOKEN, environment: "production", ...request(), headers: { ...request().headers, "apns-topic": "com.other" } }, TOPIC).ok).toBe(false);
    expect(parseRelayEnvelope({ token: TOKEN, environment: "production", ...request(), headers: { ...request().headers, authorization: "bearer x" } }, TOPIC).ok).toBe(false);
    expect(parseRelayEnvelope({ token: "zz", environment: "production", ...request() }, TOPIC).ok).toBe(false);
    expect(parseRelayEnvelope({ token: TOKEN, environment: "dev", ...request() }, TOPIC).ok).toBe(false);
    expect(parseRelayEnvelope({ token: TOKEN, environment: "sandbox", ...request(), body: JSON.stringify({ x: "y".repeat(5000) }) }, TOPIC).ok).toBe(false);
    expect(parseRelayEnvelope({ token: TOKEN, environment: "sandbox", headers: { ...request().headers, "apns-topic": `${TOPIC}.push-type.liveactivity` }, body: "{}" }, TOPIC).ok).toBe(true);
  });
});

describe("relay sender", () => {
  it("posts the envelope with the secret and maps the answer", async () => {
    const calls: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
    let answer: { status: number; data: unknown } = { status: 200, data: { ok: true } };
    const fetch: RelayFetch = async (url, init) => {
      calls.push({ url, headers: init.headers, body: init.body });
      return { status: answer.status, json: async () => answer.data };
    };
    const sender = new ApnsRelaySender({ url: "https://relay.example/api/push/relay", token: SECRET, fetch });
    expect(await sender.send({ token: TOKEN, environment: "production" }, request())).toEqual({ ok: true });
    expect(calls[0]!.headers.authorization).toBe(`Bearer ${SECRET}`);
    expect(JSON.parse(calls[0]!.body)).toMatchObject({ token: TOKEN, environment: "production" });
    answer = { status: 200, data: { ok: false, status: 410, reason: "Unregistered", prune: true } };
    expect(await sender.send({ token: TOKEN, environment: "production" }, request())).toEqual({ ok: false, status: 410, reason: "Unregistered", prune: true });
    answer = { status: 401, data: { error: "Unauthorized" } };
    expect(await sender.send({ token: TOKEN, environment: "production" }, request())).toMatchObject({ ok: false, status: 401, prune: false });
    const down = new ApnsRelaySender({ url: "https://relay.example", token: SECRET, fetch: async () => { throw new Error("ECONNREFUSED"); } });
    expect(await down.send({ token: TOKEN, environment: "production" }, request())).toMatchObject({ ok: false, status: 0, prune: false });
  });
});

function call(route: ReturnType<typeof createPushRelayRoutes>, input: { method?: string; auth?: string; body?: unknown; path?: string }) {
  const raw = input.body === undefined ? "" : typeof input.body === "string" ? input.body : JSON.stringify(input.body);
  const req = Object.assign(Readable.from([Buffer.from(raw)]), { headers: input.auth ? { authorization: input.auth } : {}, method: input.method ?? "POST" });
  const out: { status?: number; body?: unknown } = {};
  const res = { setHeader() {}, headersSent: false, writableEnded: false };
  const json = (_res: unknown, status: number, body: unknown) => { out.status = status; out.body = body; };
  return route({ req, res, path: input.path ?? "/api/push/relay", method: input.method ?? "POST", json } as never).then((result) => ({ result, ...out }));
}

describe("relay route", () => {
  const sent: string[] = [];
  const route = (tokens: string[], hasKey = true) => createPushRelayRoutes({
    tokens,
    topic: () => TOPIC,
    send: (device) => hasKey ? (sent.push(device.token), Promise.resolve({ ok: true as const })) : null,
  });

  it("passes other paths, is off without secrets, refuses a wrong secret", async () => {
    expect((await call(route([SECRET]), { path: "/api/other" })).result).toBe(PASS);
    expect((await call(route([]), { auth: `Bearer ${SECRET}` })).status).toBe(404);
    expect((await call(route([SECRET]), { auth: `Bearer ${"x".repeat(40)}`, body: {} })).status).toBe(401);
    expect((await call(route([SECRET]), { method: "GET", auth: `Bearer ${SECRET}` })).status).toBe(405);
  });

  it("sends a valid push through this server's key and returns APNs' answer", async () => {
    const answer = await call(route([SECRET]), { auth: `Bearer ${SECRET}`, body: { token: TOKEN, environment: "production", ...request() } });
    expect(answer).toMatchObject({ status: 200, body: { ok: true } });
    expect(sent).toContain(TOKEN);
    expect((await call(route([SECRET]), { auth: `Bearer ${SECRET}`, body: "{" })).status).toBe(400);
    expect((await call(route([SECRET], false), { auth: `Bearer ${SECRET}`, body: { token: TOKEN, environment: "production", ...request() } })).status).toBe(503);
  });

  it("rate limits per secret", () => {
    const limiter = new RelayRateLimiter(2, 1000, () => 0);
    expect([limiter.allow("0"), limiter.allow("0"), limiter.allow("0"), limiter.allow("1")]).toEqual([true, true, false, true]);
  });
});

describe("push hub through the relay", () => {
  const dirs: string[] = [];
  afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

  it("a keyless server pushes a proactive needs-you to the phone through the relay", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sagax-relay-"));
    dirs.push(dir);
    const store = createPushDeviceStore(dir, () => 1);
    store.register("pr_bob", { token: TOKEN, platform: "ios", environment: "production", appVersion: "", deviceName: "" });
    const sent: Array<{ token: string; topic: string }> = [];
    const hub = new PushHub({
      config: { configured: false, reason: "SAGAX_APNS_KEY_PATH is not set" },
      relay: { bundleId: TOPIC, sender: { send: async (device, req) => { sent.push({ token: device.token, topic: req.headers["apns-topic"]! }); return { ok: true }; } } },
      store,
      connected: () => false,
      log: { info: () => {}, warn: () => {} },
    });
    expect(hub.enabled).toBe(true);
    expect(hub.relaySend({ token: TOKEN, environment: "production" }, request())).toBeNull();
    hub.submit({ kind: "approval", personId: "pr_bob", title: "Scout needs you", body: "sign it", threadId: "t1", at: 1 });
    await hub.drain();
    expect(sent).toEqual([{ token: TOKEN, topic: TOPIC }]);
  });
});
