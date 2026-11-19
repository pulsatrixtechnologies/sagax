// A person's own xAI key out of credits, end to end over real sockets: the
// app's realtime call (GET /voice/realtime, the real route and the real
// socket opener) against a loopback xAI that answers each key its own HTTP
// status on the handshake.
//
// The case: a person with no connected Grok account, whose own xAI key in
// Perspicax answers 402, on an organization server whose key has credits.
// The call opens on the organization's key (the ledger says `org-key`).
// What used to go wrong: the refused handshake was read as "xAI is down"
// whatever its status, so the key was never remembered as refused, was tried
// again on every call, and the person was never told their key was dry.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Duplex } from "node:stream";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import WebSocket, { WebSocketServer } from "ws";

import { json, readBody } from "../harness/http.ts";
import type { RequestAuth } from "../auth/request-auth.ts";
import type { SessionRecord } from "../auth/sessions.ts";
import { createDesktopViewer } from "../routes/desktop-viewer.ts";
import { PASS, type RouteContext } from "../routes/table.ts";
import { openRealtimeSocket, grokVoiceFailure } from "../tts/grok.ts";
import { RealtimeCallBridge } from "./realtime-call.ts";
import { VOICE_KEY_REFUSAL_TTL_MS } from "./voice-keys.ts";
import { createVoiceModeRoutes, isVoiceSocketPath, type VoiceUsage } from "./voice-mode.ts";

// Fake keys only, long and distinct.
const ORG_KEY = "xai-ORGfake7Lm2Pq9Wz4Rt6Yb";
const ADA_KEY = "xai-ADAfake3Kd8Hs1Vn5Xc0Je";
const BEN_KEY = "xai-BENfake5Tg7Yh9Uj1Ik3Ol";

const session = (principalId: string): RequestAuth => ({
  kind: "session", via: "cookie", scopes: ["client"],
  session: { id: `s-${principalId}`, label: "web", scopes: ["client"], createdAt: 1, lastSeenAt: 1, principalId } as SessionRecord,
});

/** The status each bearer's handshake gets (101: accepted), and what was asked. */
const answers: Record<string, number> = {};
const asked: string[] = [];
let xai: Server;
let xaiSockets: WebSocketServer;
let realtimeUrl = "";
let server: Server;
let origin = "";
let clock = 1_000_000;
const usage: VoiceUsage[] = [];
const log: string[] = [];

/** xAI's own words on a refused handshake, as its API writes them. */
function refusalBody(status: number): string {
  if (status === 402) return JSON.stringify({ code: "Some resource has been exhausted", error: "Your team has either used all available credits or reached its monthly spending limit. To continue making API requests, please purchase more credits or raise your spending limit." });
  if (status === 400) return JSON.stringify({ code: "Client specified an invalid argument", error: "Incorrect API key provided. You can obtain an API key from the console." });
  return JSON.stringify({ code: "refused", error: "refused" });
}

beforeAll(async () => {
  xaiSockets = new WebSocketServer({ noServer: true });
  xaiSockets.on("connection", (socket) => {
    socket.send(JSON.stringify({ type: "session.created", session: { model: "grok-voice-fake" } }));
    socket.on("message", (raw) => {
      const event = JSON.parse(String(raw)) as { type: string };
      if (event.type === "session.update") socket.send(JSON.stringify({ type: "session.updated", session: {} }));
    });
  });
  xai = createServer((_req, res) => { res.writeHead(404); res.end(); });
  xai.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const bearer = String(req.headers.authorization ?? "").replace(/^Bearer /, "");
    asked.push(bearer);
    const status = answers[bearer] ?? 401;
    if (status === 101) {
      xaiSockets.handleUpgrade(req, socket, head, (ws) => xaiSockets.emit("connection", ws, req));
      return;
    }
    const body = refusalBody(status);
    socket.end(`HTTP/1.1 ${status} Refused\r\ncontent-type: application/json\r\ncontent-length: ${Buffer.byteLength(body)}\r\nconnection: close\r\n\r\n${body}`);
  });
  await new Promise<void>((resolve) => xai.listen(0, "127.0.0.1", resolve));
  const xaiAddress = xai.address();
  if (!xaiAddress || typeof xaiAddress === "string") throw new Error("no xai port");
  realtimeUrl = `ws://127.0.0.1:${xaiAddress.port}/v1/realtime`;

  const viewer = createDesktopViewer({ target: () => undefined, live: () => true, acceptsUpgrade: isVoiceSocketPath });
  const own: Record<string, string> = { "sub-ada": ADA_KEY, "sub-ben": BEN_KEY };
  const unused = async () => { throw new Error("not used by a realtime call"); };
  const route = createVoiceModeRoutes({
    organization: true,
    speaker: (auth) => (auth.kind === "session" && auth.session.principalId ? { principalId: auth.session.principalId, sub: `sub-${auth.session.principalId.slice(2)}` } : { principalId: "" }),
    target: (_auth, botId, threadId) => ({ botId, botName: "Quasar", threadId: threadId ?? "t-1", ownerPrincipalId: "p-ada" }),
    serverKey: () => ORG_KEY,
    hasOwnKey: () => true,
    resolveOwnKey: async (sub) => (own[sub] ? { ok: true, key: own[sub]!, fingerprint: "fp" } : { ok: false, error: "no_key" }),
    serverKeyAllowed: () => true,
    xai: { listVoices: async () => [], synthesize: unused, transcribe: unused },
    upgrade: (req) => viewer.upgradeOf(req),
    utterances: (text) => [text],
    recordUsage: (entry) => { usage.push(entry); },
    log: (line) => log.push(line),
    now: () => clock,
    realtime: {
      openUpstream: (key) => openRealtimeSocket(key, realtimeUrl),
      session: () => ({ bot: { name: "Quasar" }, history: [], work: async () => ({ kind: "answer", text: "Done." }), respond: async () => true }),
    },
  });
  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const auth = session(String(req.headers["x-test-person"] ?? "p-ada"));
    const ctx = { req, res, url, path: url.pathname, method: req.method ?? "GET", auth, json, readBody } as RouteContext;
    const answered = await route(ctx);
    if (answered === PASS && !res.headersSent) json(res, 404, { error: "not found" });
  };
  server = createServer((req, res) => void handle(req, res));
  viewer.attach(server, handle);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no port");
  origin = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  server?.closeAllConnections?.();
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  for (const client of xaiSockets?.clients ?? []) client.terminate();
  xai?.closeAllConnections?.();
  await new Promise<void>((resolve) => xai?.close(() => resolve()));
});

beforeEach(() => {
  for (const key of Object.keys(answers)) delete answers[key];
  asked.length = 0;
  usage.length = 0;
  log.length = 0;
});

async function until<T>(what: string, check: () => T | undefined | null | false, ms = 4000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const value = check();
    if (value) return value;
    if (Date.now() > end) throw new Error(`timed out: ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

/** One call of `person` to the bot: the frame that opened or refused it, then a hang-up. */
async function placeCall(person: string): Promise<Record<string, any>> {
  const ws = new WebSocket(`${origin.replace("http", "ws")}/api/bots/b-quasar/voice/realtime?language=fr&threadId=t-1`, { headers: { origin, "x-test-person": person } });
  const frames: Array<Record<string, any>> = [];
  ws.on("message", (data, binary) => { if (!binary) frames.push(JSON.parse(String(data)) as Record<string, any>); });
  await new Promise<void>((resolve, reject) => { ws.once("open", () => resolve()); ws.once("error", reject); });
  const first = await until("ready or refused", () => frames.find((f) => f.type === "ready" || f.type === "refused"));
  if (first.type === "ready") {
    ws.send(JSON.stringify({ type: "hangup" }));
    await until("ended", () => frames.find((f) => f.type === "ended"));
  }
  ws.close();
  return first;
}

async function status(person: string): Promise<Record<string, any>> {
  const res = await fetch(`${origin}/api/bots/b-quasar/voice/status`, { headers: { "x-test-person": person } });
  return await res.json() as Record<string, any>;
}

describe("a person's own xAI key out of credits, on a realtime call", () => {
  it("opens on the organization's key, says why once, and stops trying the dry key at every call", async () => {
    answers[ADA_KEY] = 402;
    answers[ORG_KEY] = 101;
    const first = await placeCall("p-ada");
    expect(first).toMatchObject({ type: "ready", key: { source: "org-key" } });
    // the person's key first, then the organization's: the app's order
    expect(asked).toEqual([ADA_KEY, ORG_KEY]);
    // the reason is the one xAI gave (no credits), never "down"
    expect(first.skipped).toEqual([{ source: "perspicax-key", last4: ADA_KEY.slice(-4), failure: "quota" }]);
    expect(log.filter((line) => line.includes("refused"))).toEqual([`[voice-realtime] xAI realtime refused the person's Perspicax key ···${ADA_KEY.slice(-4)} (quota)`]);
    // the call is booked on the key that served it
    const booked = await until("usage", () => usage.find((entry) => entry.model === "grok-realtime" && entry.via === "org-key"));
    expect(booked.payerPrincipalId).toBeUndefined();
    // the state surface of the keys says it too
    const state = await status("p-ada");
    expect(state.key).toMatchObject({ source: "org-key" });
    expect(state.keys).toEqual([
      { source: "org-key", last4: ORG_KEY.slice(-4) },
      { source: "perspicax-key", last4: ADA_KEY.slice(-4), refused: "quota" },
    ]);

    // the next call goes straight to the key that works: the refusal is remembered
    asked.length = 0;
    const second = await placeCall("p-ada");
    expect(second).toMatchObject({ type: "ready", key: { source: "org-key" } });
    expect(asked).toEqual([ORG_KEY]);
    expect(second.skipped).toBeUndefined();

    // once the memory lapses the key is tried again (it may have been refilled); still dry, it is not said again
    clock += VOICE_KEY_REFUSAL_TTL_MS + 1;
    asked.length = 0;
    const third = await placeCall("p-ada");
    expect(third).toMatchObject({ type: "ready", key: { source: "org-key" } });
    expect(asked).toEqual([ADA_KEY, ORG_KEY]);
    expect(third.skipped).toBeUndefined();

    // refilled: it serves again, and a later refusal would be said anew
    clock += VOICE_KEY_REFUSAL_TTL_MS + 1;
    answers[ADA_KEY] = 101;
    asked.length = 0;
    expect(await placeCall("p-ada")).toMatchObject({ type: "ready", key: { source: "perspicax-key" } });
    answers[ADA_KEY] = 402;
    const again = await placeCall("p-ada");
    expect(again.skipped).toEqual([{ source: "perspicax-key", last4: ADA_KEY.slice(-4), failure: "quota" }]);
    // nothing of a key reaches the page
    for (const frame of [first, second, third, again]) expect(JSON.stringify(frame)).not.toContain(ORG_KEY.slice(4, 14));
  });

  it("is one person's state: another person's key and what they are told stay their own", async () => {
    clock += 10 * VOICE_KEY_REFUSAL_TTL_MS;
    answers[ADA_KEY] = 402;
    answers[BEN_KEY] = 101;
    answers[ORG_KEY] = 101;
    await placeCall("p-ada");
    asked.length = 0;
    const ben = await placeCall("p-ben");
    expect(ben).toMatchObject({ type: "ready", key: { source: "perspicax-key", last4: BEN_KEY.slice(-4) } });
    expect(ben.skipped).toBeUndefined();
    expect(asked).toEqual([BEN_KEY]);
    expect(JSON.stringify(await status("p-ben"))).not.toContain(ADA_KEY.slice(-4));
  });

  it("a rejected key (401, 403, xAI's 400) is the key's fault, an outage is not", async () => {
    clock += 10 * VOICE_KEY_REFUSAL_TTL_MS;
    answers[ORG_KEY] = 101;
    for (const status of [401, 403, 400]) {
      clock += 10 * VOICE_KEY_REFUSAL_TTL_MS;
      answers[BEN_KEY] = status;
      // served between two refusals, so each one is a refusal of its own
      const call = await placeCall("p-ben");
      expect(call.skipped, String(status)).toEqual([{ source: "perspicax-key", last4: BEN_KEY.slice(-4), failure: "key" }]);
      clock += 10 * VOICE_KEY_REFUSAL_TTL_MS;
      answers[BEN_KEY] = 101;
      await placeCall("p-ben");
    }
    // xAI failing is not a refusal of the key: nothing to fix, nothing said, nothing remembered
    answers[BEN_KEY] = 503;
    asked.length = 0;
    const down = await placeCall("p-ben");
    expect(down).toMatchObject({ type: "ready", key: { source: "org-key" } });
    expect(down.skipped).toBeUndefined();
    expect(log.some((line) => line.includes("refused the person's Perspicax key") && line.endsWith("(down)"))).toBe(true);
    asked.length = 0;
    await placeCall("p-ben");
    expect(asked[0]).toBe(BEN_KEY);
  });
});

describe("a refused realtime handshake keeps the reason xAI gave", () => {
  async function refusedWith(status: number): Promise<string> {
    answers["a-key"] = status;
    const bridge = new RealtimeCallBridge({
      openUpstream: () => openRealtimeSocket("a-key", realtimeUrl),
      sendText: () => {}, sendBinary: () => {}, closePage: () => {},
      work: async () => ({ kind: "timeout" }), respond: async () => true, bot: { name: "x" }, history: [], log: () => {},
    });
    bridge.start();
    expect(await bridge.ready).toBe(false);
    return bridge.lastError ?? "";
  }

  it("no credits (402), a rejected key (401, 403) and an outage (5xx) are three different things", async () => {
    expect(grokVoiceFailure(await refusedWith(402))).toBe("quota");
    expect(grokVoiceFailure(await refusedWith(401))).toBe("key");
    expect(grokVoiceFailure(await refusedWith(403))).toBe("key");
    expect(grokVoiceFailure(await refusedWith(400))).toBe("key");
    expect(grokVoiceFailure(await refusedWith(429))).toBe("busy");
    expect(grokVoiceFailure(await refusedWith(503))).toBe("down");
  });

  it("an unreachable xAI is still down", async () => {
    const bridge = new RealtimeCallBridge({
      openUpstream: () => openRealtimeSocket("a-key", "ws://127.0.0.1:1/v1/realtime"),
      sendText: () => {}, sendBinary: () => {}, closePage: () => {},
      work: async () => ({ kind: "timeout" }), respond: async () => true, bot: { name: "x" }, history: [], log: () => {},
    });
    bridge.start();
    expect(await bridge.ready).toBe(false);
    expect(grokVoiceFailure(bridge.lastError ?? "")).toBe("down");
  });
});
