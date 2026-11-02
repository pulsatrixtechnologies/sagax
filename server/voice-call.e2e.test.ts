// Voice mode's live call routes end to end over real sockets: the page's
// streaming speech to text (GET /voice/listen, a WebSocket through the same
// upgrade gate as the desktop viewer) and the streamed speech of one sentence
// (POST /voice/stream), and the streaming voice of a whole call
// (GET /voice/speech: clauses in, PCM out, over xAI's text to speech
// WebSocket, with barge-in, a dropped socket and a refused one), against a
// loopback fake of xAI. The key stays on the
// server, and xAI is only ears and a voice: no chat, responses or realtime
// agent endpoint is ever called during a call.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket, { WebSocketServer } from "ws";

import { json, readBody } from "./harness/http.ts";
import type { RequestAuth } from "./request-auth.ts";
import { createDesktopViewer } from "./routes/desktop-viewer.ts";
import { PASS, type RouteContext } from "./routes/table.ts";
import type { SessionRecord } from "./sessions.ts";
import { startFakeXaiVoice, XAI_VOICE_PATHS, type FakeXaiVoice } from "./testing/fake-xai-voice.ts";
import type { VoiceUsage } from "./voice-mode.ts";

const KEY = "xai-CALLfake8Hq2Zr5Lp7Wd3";
const ada: RequestAuth = {
  kind: "session", via: "cookie", scopes: ["client"],
  session: { id: "s-ada", label: "web", scopes: ["client"], createdAt: 1, lastSeenAt: 1, principalId: "p-ada" } as SessionRecord,
};

let xai: FakeXaiVoice;
/** A loopback xAI Voice Agent API: session.created on connect, session.updated on session.update. */
let realtimeXai: WebSocketServer;
let realtimeUrl = "";
let socketGate: Pick<typeof import("./voice-mode.ts"), "isVoiceSocketPath" | "VOICE_SOCKET_ACTIONS">;
const realtimeSeen: Array<{ authorization?: string; events: string[]; session?: Record<string, unknown> }> = [];
let server: Server;
let origin = "";
const usage: VoiceUsage[] = [];
const speechLog: string[] = [];

beforeAll(async () => {
  xai = await startFakeXaiVoice({ transcripts: ["first turn", "second turn"], sttFinalizeMs: 30, ttsFirstChunkMs: 40, ttsSeconds: 0.3, sttConfidence: 0.92 });
  process.env.SAGAX_XAI_TTS_API = `${xai.url}/v1`;
  realtimeXai = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  realtimeXai.on("connection", (socket, request) => {
    const seen: (typeof realtimeSeen)[number] = { authorization: request.headers.authorization, events: [] };
    realtimeSeen.push(seen);
    socket.send(JSON.stringify({ type: "session.created", session: { model: "grok-voice-fake" } }));
    socket.on("message", (raw) => {
      const event = JSON.parse(String(raw)) as { type: string; session?: Record<string, unknown> };
      seen.events.push(event.type);
      if (event.type === "session.update") {
        seen.session = event.session;
        socket.send(JSON.stringify({ type: "session.updated", session: {} }));
      }
    });
  });
  await new Promise<void>((resolve) => realtimeXai.once("listening", () => resolve()));
  const realtimeAddress = realtimeXai.address();
  if (!realtimeAddress || typeof realtimeAddress === "string") throw new Error("no realtime port");
  realtimeUrl = `ws://127.0.0.1:${realtimeAddress.port}/v1/realtime`;
  const grok = await import("./tts/grok.ts");
  // imported after SAGAX_XAI_TTS_API is set: tts/grok.ts reads it on load
  const voiceMode = await import("./voice-mode.ts");
  const { createVoiceModeRoutes } = voiceMode;
  socketGate = voiceMode;
  const viewer = createDesktopViewer({
    target: () => undefined,
    live: () => true,
    // the very check server/index.ts gives its upgrade gate
    acceptsUpgrade: voiceMode.isVoiceSocketPath,
  });
  const route = createVoiceModeRoutes({
    organization: false,
    speaker: () => ({ principalId: "p-ada" }),
    target: (_auth, botId, threadId) => ({ botId, botName: "Quasar", threadId: threadId ?? "t-1" }),
    serverKey: () => KEY,
    hasOwnKey: () => false,
    resolveOwnKey: async () => ({ ok: false, error: "no_key" }),
    xai: {
      listVoices: grok.listVoices,
      synthesize: grok.synthesize,
      transcribe: grok.transcribe,
      synthesizeStream: grok.synthesizeStream,
      openTranscription: (key, options, handlers) => grok.openTranscriptionStream(key, options, handlers),
      openSpeech: (key, options, handlers) => grok.openSpeechStream(key, options, handlers),
    },
    log: (line) => speechLog.push(line),
    upgrade: (req) => viewer.upgradeOf(req),
    utterances: (text) => (text.startsWith("```") ? [] : [text.replace(/\*\*/g, "")]),
    recordUsage: (entry) => { usage.push(entry); },
    realtime: {
      openUpstream: (key) => grok.openRealtimeSocket(key, realtimeUrl),
      session: () => ({
        bot: { name: "Quasar" },
        history: [],
        work: async () => ({ kind: "answer", text: "Done." }),
        respond: async () => true,
      }),
    },
  });
  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const ctx = { req, res, url, path: url.pathname, method: req.method ?? "GET", auth: ada, json, readBody } as RouteContext;
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
  await xai?.close();
  await new Promise<void>((resolve) => (realtimeXai ? realtimeXai.close(() => resolve()) : resolve()));
});

function open(path: string, headers: Record<string, string> = {}): Promise<{ ws: WebSocket; frames: Array<Record<string, unknown>>; audio: number[] }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${origin.replace("http", "ws")}${path}`, { headers: { origin, ...headers } });
    const frames: Array<Record<string, unknown>> = [];
    const audio: number[] = [];
    ws.on("message", (data, binary) => {
      if (binary) audio.push((data as Buffer).length);
      else frames.push(JSON.parse(String(data)) as Record<string, unknown>);
    });
    ws.once("open", () => resolve({ ws, frames, audio }));
    ws.once("unexpected-response", (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
    ws.once("error", reject);
  });
}

async function until<T>(what: string, check: () => T | undefined | null | false, ms = 3000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const value = check();
    if (value) return value;
    if (Date.now() > end) throw new Error(`timed out: ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe("voice mode live call (streaming)", () => {
  it("streams the person's audio to xAI and answers each finalized utterance, on one socket", async () => {
    const { ws, frames } = await open("/api/bots/b-quasar/voice/listen?language=fr&threadId=t-1");
    await until("ready", () => frames.find((f) => f.type === "ready"));
    const pcm = Buffer.alloc(3200); // 100 ms of 16 kHz 16-bit audio
    ws.send(pcm);
    ws.send(pcm);
    const started = Date.now();
    ws.send(JSON.stringify({ type: "finalize" }));
    const first = await until("first transcript", () => frames.find((f) => f.type === "transcript" && f.text === "first turn"));
    // xAI's confidence reaches the page (noise fragments are dropped by it)
    expect(first).toMatchObject({ final: true, speechFinal: true, confidence: 0.92 });
    expect(Date.now() - started).toBeLessThan(1000);
    ws.send(pcm);
    ws.send(JSON.stringify({ type: "finalize" }));
    await until("second transcript", () => frames.find((f) => f.type === "transcript" && f.text === "second turn"));
    ws.close();
    const socket = await until("the xAI socket", () => xai.requests.find((r) => r.websocket && r.path === "/v1/stt"));
    expect(socket.authorization).toBe(`Bearer ${KEY}`);
    expect(socket.query).toMatchObject({ encoding: "pcm", sample_rate: "16000", interim_results: "true", language: "fr" });
    await until("audio forwarded", () => socket.audioBytes === 3 * 3200);
    expect(socket.finalizes).toBe(2);
    // booked as heard, never with a key
    await until("usage", () => usage.filter((u) => u.model === "grok-stt").length >= 2);
    expect(usage.filter((u) => u.model === "grok-stt").reduce((sum, u) => sum + u.input, 0)).toBe(3 * 3200);
    expect(JSON.stringify(frames)).not.toContain(KEY.slice(6, 14));
  });

  it("refuses a WebSocket from another origin (no CORS for WebSockets)", async () => {
    await expect(open("/api/bots/b-quasar/voice/listen", { origin: "https://evil.example" })).rejects.toThrow(/403/);
  });

  it("lets every voice socket route through the upgrade gate (0.8.29: /voice/realtime was a bare 404)", () => {
    const { isVoiceSocketPath, VOICE_SOCKET_ACTIONS } = socketGate;
    for (const action of VOICE_SOCKET_ACTIONS) expect(isVoiceSocketPath(`/api/bots/b-1/voice/${action}`), action).toBe(true);
    expect(VOICE_SOCKET_ACTIONS).toContain("realtime");
    expect(isVoiceSocketPath("/api/bots/b-1/voice/status")).toBe(false);
    expect(isVoiceSocketPath("/api/bots/b-1/voice/realtime/x")).toBe(false);
  });

  it("opens a realtime call through the same upgrade gate as the server, the key only on the xAI side", async () => {
    const { ws, frames } = await open("/api/bots/b-quasar/voice/realtime?language=fr&threadId=t-1");
    const ready = await until("ready", () => frames.find((f) => f.type === "ready" || f.type === "refused"));
    expect(ready).toMatchObject({ type: "ready", sampleRate: 24_000 });
    const seen = await until("session.update at xAI", () => realtimeSeen.find((entry) => entry.session));
    expect(seen.authorization).toBe(`Bearer ${KEY}`);
    expect(seen.session).toMatchObject({ audio: { input: { format: { type: "audio/pcm", rate: 24_000 } } } });
    ws.send(JSON.stringify({ type: "hangup" }));
    await until("ended", () => frames.find((f) => f.type === "ended"));
    expect(JSON.stringify(frames)).not.toContain(KEY.slice(6, 14));
    ws.close();
  });

  it("refuses a plain GET without an upgrade", async () => {
    const res = await fetch(`${origin}/api/bots/b-quasar/voice/listen`);
    expect(res.status).toBe(426);
  });

  it("streams one sentence's speech as raw PCM while xAI makes it", async () => {
    const started = Date.now();
    const res = await fetch(`${origin}/api/bots/b-quasar/voice/stream`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "**Bonjour** Ada.", voice: "ara", speed: 1.25, language: "fr" }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("audio/pcm");
    expect(res.headers.get("x-voice-sample-rate")).toBe("24000");
    const reader = res.body!.getReader();
    const first = await reader.read();
    const firstAt = Date.now() - started;
    expect(first.value!.byteLength).toBeGreaterThan(0);
    let total = first.value!.byteLength;
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
    }
    // the first chunk arrives long before the whole sentence is done
    expect(firstAt).toBeLessThan(600);
    expect(total).toBe(Math.round(24_000 * 0.3) * 2);
    const tts = xai.requests.filter((r) => r.path === "/v1/tts").at(-1)!;
    expect(tts.json).toMatchObject({ text: "Bonjour Ada.", voice_id: "ara", speed: 1.25, language: "fr", output_format: { codec: "pcm", sample_rate: 24000 } });
    expect(tts.authorization).toBe(`Bearer ${KEY}`);
  });

  it("answers silence for a sentence with nothing speakable", async () => {
    const res = await fetch(`${origin}/api/bots/b-quasar/voice/stream`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "```js\nx()\n```" }),
    });
    expect(res.status).toBe(204);
  });

  it("streaming voice: one xAI socket for the call, each clause's PCM between start and done", async () => {
    const { ws, frames, audio } = await open("/api/bots/b-quasar/voice/speech?language=fr&voice=ara&speed=1.25&threadId=t-1");
    await until("ready", () => frames.find((f) => f.type === "ready"));
    // the ready frame names the key in use by its last four characters (#1573)
    expect(frames[0]).toEqual({ type: "ready", sampleRate: 24_000, key: { last4: KEY.slice(-4), source: "server" } });
    const started = Date.now();
    ws.send(JSON.stringify({ type: "say", id: "c1", text: "**Bonjour** Ada," }));
    ws.send(JSON.stringify({ type: "say", id: "c2", text: "voici la suite." }));
    await until("first audio", () => audio.length > 0);
    expect(Date.now() - started).toBeLessThan(600);
    await until("both done", () => frames.filter((f) => f.type === "done").length === 2);
    expect(frames.slice(1).map((f) => `${f.type}:${f.id}`)).toEqual(["start:c1", "done:c1", "start:c2", "done:c2"]);
    expect(audio.reduce((a, b) => a + b, 0)).toBe(2 * Math.round(24_000 * 0.3) * 2);
    const socket = xai.requests.find((r) => r.websocket && r.path === "/v1/tts")!;
    expect(socket.authorization).toBe(`Bearer ${KEY}`);
    expect(socket.query).toMatchObject({ language: "fr", voice: "ara", speed: "1.25", codec: "pcm", sample_rate: "24000", optimize_streaming_latency: "2" });
    // made speakable on the server, like POST /voice/stream
    expect(socket.utterances).toEqual(["Bonjour Ada,", "voici la suite."]);
    expect(usage.filter((u) => u.model === "grok-tts").slice(-2).map((u) => u.input)).toEqual([12, 15]);
    ws.close();
    expect(JSON.stringify(frames)).not.toContain(KEY.slice(6, 14));
  });

  it("streaming voice barge-in: the clause speaking is cleared at xAI (text.clear), the socket carries on", async () => {
    const { ws, frames, audio } = await open("/api/bots/b-quasar/voice/speech?language=en");
    await until("ready", () => frames.find((f) => f.type === "ready"));
    ws.send(JSON.stringify({ type: "say", id: "c1", text: "A long answer that the person cuts." }));
    ws.send(JSON.stringify({ type: "say", id: "c2", text: "Never said." }));
    await until("first audio", () => audio.length > 0);
    ws.send(JSON.stringify({ type: "cancel", id: "c2" }));
    ws.send(JSON.stringify({ type: "cancel", id: "c1" }));
    await until("cleared", () => frames.filter((f) => f.type === "done").length === 2);
    const socket = xai.requests.filter((r) => r.websocket && r.path === "/v1/tts").at(-1)!;
    expect(socket.clears).toBe(1);
    const heard = audio.length;
    await new Promise((r) => setTimeout(r, 150));
    expect(audio.length).toBe(heard);
    ws.send(JSON.stringify({ type: "say", id: "c3", text: "The next answer." }));
    await until("next done", () => frames.some((f) => f.type === "done" && f.id === "c3"));
    expect(socket.utterances).toEqual(["A long answer that the person cuts.", "The next answer."]);
    ws.close();
  });

  it("streaming voice: a dropped xAI socket fails the clause, then reconnects for the next one", async () => {
    const { ws, frames } = await open("/api/bots/b-quasar/voice/speech?language=en");
    await until("ready", () => frames.find((f) => f.type === "ready"));
    const before = xai.requests.filter((r) => r.websocket && r.path === "/v1/tts").length;
    xai.speech.dropAfter = 1;
    ws.send(JSON.stringify({ type: "say", id: "c1", text: "Dropped." }));
    await until("error", () => frames.find((f) => f.type === "error"));
    expect(frames.find((f) => f.type === "error")).toEqual({ type: "error", ids: ["c1"] });
    await until("reconnected", () => xai.requests.filter((r) => r.websocket && r.path === "/v1/tts").length === before + 1, 3000);
    ws.send(JSON.stringify({ type: "say", id: "c2", text: "After the drop." }));
    await until("spoken after the reconnect", () => frames.some((f) => f.type === "done" && f.id === "c2"), 3000);
    ws.close();
  });

  it("streaming voice: an xAI socket that does not open is refused (502), so the page speaks over POST", async () => {
    const logged = speechLog.length;
    xai.speech.refuse = true;
    try {
      await expect(open("/api/bots/b-quasar/voice/speech?language=en")).rejects.toThrow(/502/);
    } finally {
      xai.speech.refuse = false;
    }
    await expect(open("/api/bots/b-quasar/voice/speech?language=en", { origin: "https://evil.example" })).rejects.toThrow(/403/);
    // the refusal is logged with the source of the key (#1573), never the key
    const refused = speechLog.slice(logged);
    expect(refused.some((line) => line.includes(`server's key ···${KEY.slice(-4)}`))).toBe(true);
    expect(refused.join("\n")).not.toContain(KEY.slice(6, 14));
  });

  it("never asks xAI to answer: only speech to text and text to speech endpoints were called", () => {
    expect(xai.requests.length).toBeGreaterThan(0);
    const other = xai.requests.filter((r) => !XAI_VOICE_PATHS.has(r.path));
    expect(other).toEqual([]);
    expect(xai.requests.some((r) => /chat|responses|realtime|completions/.test(r.path))).toBe(false);
  });
});
