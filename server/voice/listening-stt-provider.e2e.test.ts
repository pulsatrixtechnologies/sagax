// #5377: who transcribes a Listening session, end to end over real sockets.
// The page's listening channel is the `/voice/listen` socket with
// `purpose=listening`, else each utterance whole to `POST /voice/transcribe`
// (src/lib/voice-mode/stt-stream.ts). Both take the person's speech to text
// choice and give way to the next provider the person has a key for
// (server/voice/voice-mode.ts): a person with an OpenAI key transcribes while
// xAI answers `out_of_credits`. xAI and OpenAI are loopback fakes here: no
// real request, no real key.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import WebSocket, { WebSocketServer } from "ws";

import { json, readBody } from "../harness/http.ts";
import type { RequestAuth } from "../auth/request-auth.ts";
import { createDesktopViewer } from "../routes/desktop-viewer.ts";
import { PASS, type RouteContext } from "../routes/table.ts";
import type { SessionRecord } from "../auth/sessions.ts";
import { startFakeXaiVoice, type FakeXaiVoice } from "../testing/fake-xai-voice.ts";
import type { VoiceUsage } from "./voice-mode.ts";

const ORG_XAI_KEY = "xai-ORGfake4Kd8Zr2Lp6Wc0Je";
const OPENAI_KEY = "sk-FAKElisten1Zx2Cv3Bn8Qq";
const OUT_OF_CREDITS = { status: 503, body: { code: "out_of_credits", error: "The account has no credits left." } };

const auth: RequestAuth = {
  kind: "session", via: "cookie", scopes: ["client"],
  session: { id: "s-ada", label: "web", scopes: ["client"], createdAt: 1, lastSeenAt: 1, principalId: "p-ada" } as SessionRecord,
};

/** A loopback OpenAI: Realtime transcription and whole recordings. */
interface FakeOpenAi {
  api: string;
  /** every request refused for credits (429 `insufficient_quota`) */
  dry: boolean;
  sockets: number;
  uploads: number;
  close(): Promise<void>;
}

async function startFakeOpenAi(): Promise<FakeOpenAi> {
  const quota = JSON.stringify({ error: { code: "insufficient_quota", type: "insufficient_quota" } });
  const state = { dry: false, sockets: 0, uploads: 0 };
  const server = createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      state.uploads += 1;
      if (state.dry) {
        res.writeHead(429, { "content-type": "application/json" });
        res.end(quota);
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ text: "heard by the other provider" }));
    });
  });
  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req, socket, head) => {
    state.sockets += 1;
    if (state.dry) {
      socket.end(`HTTP/1.1 429 Refused\r\ncontent-type: application/json\r\ncontent-length: ${Buffer.byteLength(quota)}\r\nconnection: close\r\n\r\n${quota}`);
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      let item = 0;
      ws.send(JSON.stringify({ type: "session.created" }));
      ws.on("message", (data) => {
        const frame = JSON.parse(String(data)) as { type?: string };
        if (frame.type === "session.update") ws.send(JSON.stringify({ type: "session.updated" }));
        if (frame.type === "input_audio_buffer.commit") {
          const id = `item-${++item}`;
          ws.send(JSON.stringify({ type: "input_audio_buffer.committed", item_id: id }));
          ws.send(JSON.stringify({ type: "conversation.item.input_audio_transcription.completed", item_id: id, transcript: "heard by the other provider" }));
        }
      });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return Object.assign(state, {
    api: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
    close: () => new Promise<void>((resolve) => {
      for (const client of wss.clients) client.terminate();
      wss.close();
      server.closeAllConnections?.();
      server.close(() => resolve());
    }),
  });
}

let xai: FakeXaiVoice;
let openai: FakeOpenAi;
let server: Server;
let origin = "";
/** one person per test: the keys refused lately are remembered per person */
let person = "p-ada";
let people = 0;
let hasOpenAiKey = true;
let preference: Record<string, unknown> | undefined;
const usage: VoiceUsage[] = [];
const notices: string[] = [];
const pages = new Set<WebSocket>();

beforeAll(async () => {
  xai = await startFakeXaiVoice({ transcript: "heard by xAI", sttFinalizeMs: 20 });
  openai = await startFakeOpenAi();
  process.env.SAGAX_XAI_TTS_API = `${xai.url}/v1`;
  // imported after SAGAX_XAI_TTS_API is set: tts/grok.ts reads it on load
  const grok = await import("../tts/grok.ts");
  const { createOpenAiStt } = await import("../tts/openai-stt.ts");
  const voiceMode = await import("./voice-mode.ts");
  const openAiStt = createOpenAiStt({ api: openai.api });
  const viewer = createDesktopViewer({ target: () => undefined, live: () => true, acceptsUpgrade: voiceMode.isVoiceSocketPath });
  const route = voiceMode.createVoiceModeRoutes({
    organization: true,
    speaker: () => ({ principalId: person, sub: `sub-${person}` }),
    target: (_auth, botId, threadId) => ({ botId, botName: "Quasar", threadId: threadId ?? "t-1" }),
    // the organization's xAI key, given to everyone
    serverKey: () => ORG_XAI_KEY,
    hasOwnKey: () => false,
    resolveOwnKey: async () => ({ ok: false, error: "no_key" }),
    xai: {
      listVoices: grok.listVoices,
      synthesize: grok.synthesize,
      transcribe: grok.transcribe,
      openTranscription: (key, options, handlers) => grok.openTranscriptionStream(key, options, handlers),
    },
    openai: {
      synthesize: async () => ({ bytes: new Uint8Array([1]), mime: "audio/mpeg" }),
      transcribe: openAiStt.transcribe,
      openTranscription: openAiStt.openTranscription,
    },
    // the person's own OpenAI key (Settings > Providers)
    providerKeys: (provider) => (provider === "openai" && hasOpenAiKey
      ? [{ key: OPENAI_KEY, via: "speaker-key", source: "perspicax-key", last4: OPENAI_KEY.slice(-4), payerPrincipalId: person }]
      : []),
    preference: () => preference,
    notice: (_threadId, message) => { notices.push(message); },
    log: () => {},
    upgrade: (req) => viewer.upgradeOf(req),
    utterances: (text) => [text],
    recordUsage: (entry) => { usage.push(entry); },
  });
  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const ctx = { req, res, url, path: url.pathname, method: req.method ?? "GET", auth, json, readBody } as RouteContext;
    const answered = await route(ctx);
    if (answered === PASS && !res.headersSent) json(res, 404, { error: "not found" });
  };
  server = createServer((req, res) => void handle(req, res));
  viewer.attach(server, handle);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server?.closeAllConnections?.();
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  await xai?.close();
  await openai?.close();
});

beforeEach(() => {
  person = `p-ada-${++people}`;
  hasOpenAiKey = true;
  preference = undefined;
  xai.stt.refuse = null;
  xai.stt.failOnAudio = false;
  openai.dry = false;
  usage.length = 0;
  notices.length = 0;
});

afterEach(() => {
  for (const page of pages) page.terminate();
  pages.clear();
});

const LISTEN = "/api/bots/b-quasar/voice/listen?language=fr&threadId=t-1&purpose=listening";
const TRANSCRIBE = "/api/bots/b-quasar/voice/transcribe?language=fr&threadId=t-1";
const WAV = (() => {
  const bytes = new Uint8Array(64);
  bytes.set([..."RIFF"].map((c) => c.charCodeAt(0)), 0);
  bytes.set([..."WAVE"].map((c) => c.charCodeAt(0)), 8);
  return bytes;
})();

type Frames = Array<Record<string, unknown>>;

/** The page's listening socket: its frames, or the refusal the server answered instead. */
function listen(path = LISTEN): Promise<{ ws: WebSocket; frames: Frames; closed: () => number | null } | { refused: number; body: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${origin.replace("http", "ws")}${path}`, { headers: { origin } });
    const frames: Frames = [];
    let code: number | null = null;
    pages.add(ws);
    ws.on("message", (data, binary) => { if (!binary) frames.push(JSON.parse(String(data)) as Record<string, unknown>); });
    ws.on("close", (closeCode) => { code = closeCode; });
    ws.once("open", () => resolve({ ws, frames, closed: () => code }));
    ws.once("unexpected-response", (_req, res) => {
      let body = "";
      res.on("data", (chunk: Buffer) => { body += String(chunk); });
      res.on("end", () => resolve({ refused: res.statusCode ?? 0, body: JSON.parse(body || "{}") as Record<string, unknown> }));
    });
    ws.once("error", reject);
  });
}

async function until<T>(what: string, check: () => T | undefined | null | false, ms = 4000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const value = check();
    if (value) return value;
    if (Date.now() > end) throw new Error(`timed out: ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

const upload = () => fetch(`${origin}${TRANSCRIBE}`, { method: "POST", headers: { "content-type": "audio/wav", origin }, body: WAV });
const sttSocketsAtXai = () => xai.requests.filter((r) => r.websocket && r.path === "/v1/stt").length;

/** One utterance on an open listening socket: its final words. */
async function say(opened: { ws: WebSocket; frames: Frames }): Promise<Record<string, unknown>> {
  const before = opened.frames.length;
  opened.ws.send(Buffer.alloc(3200));
  opened.ws.send(JSON.stringify({ type: "finalize", requestId: `stt-${before}` }));
  return until("the final words", () => opened.frames.slice(before).find((f) => f.type === "transcript" && f.final && f.text));
}

describe("who transcribes a Listening session (#5377)", () => {
  it("xAI hears under Auto while its key has credits", async () => {
    const asked = openai.sockets;
    const opened = await listen();
    if ("refused" in opened) throw new Error(`refused ${opened.refused}`);
    const ready = await until("ready", () => opened.frames.find((f) => f.type === "ready"));
    expect(ready.key).toEqual({ source: "org-key", last4: ORG_XAI_KEY.slice(-4) });
    expect((await say(opened)).text).toBe("heard by xAI");
    opened.ws.close();
    const booked = await until("usage", () => usage.find((u) => u.model === "grok-stt"));
    expect(booked).toMatchObject({ purpose: "listening", via: "org-key" });
    expect(openai.sockets).toBe(asked);
  });

  it("goes on with the person's OpenAI key when xAI refuses the socket for credits", async () => {
    xai.stt.refuse = OUT_OF_CREDITS;
    const opened = await listen();
    if ("refused" in opened) throw new Error(`refused ${opened.refused}: ${JSON.stringify(opened.body)}`);
    const ready = await until("ready", () => opened.frames.find((f) => f.type === "ready"));
    expect(ready.key).toEqual({ source: "perspicax-key", last4: OPENAI_KEY.slice(-4), provider: "openai" });
    expect((await say(opened)).text).toBe("heard by the other provider");
    opened.ws.close();
    const booked = await until("usage", () => usage.find((u) => u.model === "openai-stt"));
    expect(booked).toMatchObject({ purpose: "listening", provider: "openai", via: "speaker-key", payerPrincipalId: person });
    // silent on the page, a line in the thread's Events lens
    expect(notices.filter((line) => line.includes("went on with"))).toEqual(["Voice: speech to text went on with OpenAI after xAI (no credits left)"]);
    expect(JSON.stringify(opened.frames)).not.toContain(OPENAI_KEY.slice(3, 12));
  });

  it("uploads a whole utterance to OpenAI when xAI refuses it for credits", async () => {
    xai.stt.refuse = OUT_OF_CREDITS;
    const res = await upload();
    expect(res.status).toBe(200);
    expect(res.headers.get("x-voice-provider")).toBe("openai");
    expect(((await res.json()) as { text: string }).text).toBe("heard by the other provider");
  });

  it("never asks xAI when the person chose OpenAI to hear (Settings > Voice)", async () => {
    preference = { voice: "", speed: 1, language: "auto", stt: "openai" };
    const before = sttSocketsAtXai();
    const opened = await listen();
    if ("refused" in opened) throw new Error(`refused ${opened.refused}`);
    const ready = await until("ready", () => opened.frames.find((f) => f.type === "ready"));
    expect((ready.key as { provider?: string }).provider).toBe("openai");
    expect((await say(opened)).text).toBe("heard by the other provider");
    opened.ws.close();
    expect(sttSocketsAtXai()).toBe(before);
  });

  it("leaves xAI for the session's next socket when xAI took the socket, then refused the audio for credits", async () => {
    xai.stt.failOnAudio = true;
    // its own conversation: a switch is said once a minute per conversation
    const path = LISTEN.replace("threadId=t-1", "threadId=t-2");
    const first = await listen(path);
    if ("refused" in first) throw new Error(`refused ${first.refused}`);
    await until("ready", () => first.frames.find((f) => f.type === "ready"));
    // the page speaks, and says it again each time the server replaced xAI's side (`reconnected`)
    first.ws.send(Buffer.alloc(3200));
    first.ws.on("message", (data) => { if (String(data).includes('"reconnected"')) first.ws.send(Buffer.alloc(3200)); });
    // then the page's socket is closed for it to reconnect (1011)
    await until("the page socket closed", () => first.closed(), 8000);
    expect(first.closed()).toBe(1011);
    expect(notices.filter((line) => line.includes("went on with"))).toEqual(["Voice: speech to text went on with OpenAI after xAI (an error)"]);
    const next = await listen(path);
    if ("refused" in next) throw new Error(`refused ${next.refused}`);
    const ready = await until("ready", () => next.frames.find((f) => f.type === "ready"));
    expect((ready.key as { provider?: string }).provider).toBe("openai");
    expect((await say(next)).text).toBe("heard by the other provider");
    next.ws.close();
  }, 15_000);

  it("names every key refused when no provider has credits, the last one by its provider", async () => {
    xai.stt.refuse = OUT_OF_CREDITS;
    openai.dry = true;
    const opened = await listen();
    expect(opened).toMatchObject({ refused: 502, body: { code: "out_of_credits", failure: "quota" } });
    const res = await upload();
    expect(res.status).toBe(502);
    // After listen() already refused both keys, upload() reports the org key
    // as `key` and every refusal in try order (org xAI, then personal OpenAI).
    // #5427 / M-20261126-145 keeps that chain; the last tried entry has no
    // provider field on the whole-utterance path.
    expect(await res.json()).toMatchObject({
      code: "out_of_credits",
      failure: "quota",
      key: { source: "org-key", last4: ORG_XAI_KEY.slice(-4) },
      tried: [
        { source: "org-key", last4: ORG_XAI_KEY.slice(-4), failure: "quota" },
        { source: "perspicax-key", last4: OPENAI_KEY.slice(-4), failure: "quota" },
      ],
    });
  });

  it("answers the organization's xAI key alone when the person has no other key to hear with", async () => {
    xai.stt.refuse = OUT_OF_CREDITS;
    hasOpenAiKey = false;
    const asked = openai.uploads + openai.sockets;
    const res = await upload();
    expect(res.status).toBe(502);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ code: "out_of_credits", key: { source: "org-key", last4: ORG_XAI_KEY.slice(-4) } });
    expect(body.tried).toBeUndefined();
    expect(openai.uploads + openai.sockets).toBe(asked);
  });
});
