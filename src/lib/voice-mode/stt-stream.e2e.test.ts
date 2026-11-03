// The real page transcriber, HTTP upgrade route and provider adapter with a
// loopback OpenAI stand-in. No user data, credentials or provider traffic.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { expect, it } from "vitest";
import WebSocket, { WebSocketServer } from "ws";

import { LiveTranscriber } from "./stt-stream";
import { json, readBody } from "../../../server/harness/http.ts";
import type { RequestAuth } from "../../../server/auth/request-auth.ts";
import { createDesktopViewer } from "../../../server/routes/desktop-viewer.ts";
import { PASS, type RouteContext } from "../../../server/routes/table.ts";
import { createOpenAiStt } from "../../../server/tts/openai-stt.ts";
import { createVoiceModeRoutes } from "../../../server/voice/voice-mode.ts";

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function close(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

it("keeps two spoken turns with their own transcripts through the real listen route when provider results reverse", async () => {
  const provider = createServer();
  const upstream = new WebSocketServer({ server: provider });
  upstream.on("connection", (socket) => {
    let commits = 0;
    socket.send(JSON.stringify({ type: "session.created" }));
    socket.on("message", (raw) => {
      const frame = JSON.parse(String(raw)) as { type: string };
      if (frame.type === "session.update") socket.send(JSON.stringify({ type: "session.updated" }));
      if (frame.type !== "input_audio_buffer.commit") return;
      commits += 1;
      socket.send(JSON.stringify({ type: "input_audio_buffer.committed", item_id: `item-${commits}` }));
      if (commits === 2) {
        for (const [id, text] of [[2, "Finalement, annule."], [1, "Cherche le billet."]]) {
          socket.send(JSON.stringify({ type: "conversation.item.input_audio_transcription.completed", item_id: `item-${id}`, transcript: text }));
        }
      }
    });
  });
  const providerOrigin = await listen(provider);
  const viewer = createDesktopViewer({
    target: () => undefined, live: () => true,
    acceptsUpgrade: (path) => path === "/api/bots/b-voice/voice/listen",
  });
  const auth: RequestAuth = { kind: "loopback", trust: "service", scopes: ["client", "admin"] };
  const route = createVoiceModeRoutes({
    organization: false,
    speaker: () => ({ principalId: "p-voice" }),
    target: (_auth, botId, threadId) => ({ botId, botName: "Voice", threadId: threadId ?? "t-voice" }),
    serverKey: () => "xai-FAKEvoice", hasOwnKey: () => false,
    resolveOwnKey: async () => ({ ok: false, error: "no_key" }),
    xai: {
      listVoices: async () => [],
      synthesize: async () => ({ bytes: new Uint8Array(), mime: "audio/mpeg" }),
      transcribe: async () => ({ text: "unused xAI fallback" }),
    },
    openai: createOpenAiStt({ api: `${providerOrigin}/v1` }),
    providerKeys: (id) => id === "openai" ? [{ key: "sk-FAKEvoice", source: "voice-key", via: "speaker-key", last4: null }] : [],
    utterances: (text) => [text], recordUsage: () => {},
    upgrade: (req) => viewer.upgradeOf(req),
    log: () => {},
  });
  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const result = await route({ req, res, url, path: url.pathname, method: req.method ?? "GET", auth, json, readBody } as RouteContext);
    if (result === PASS && !res.headersSent) json(res, 404, { error: "not found" });
  };
  const app = createServer((req, res) => void handle(req, res));
  viewer.attach(app, handle);
  const origin = await listen(app);
  let page: WebSocket | undefined;
  const transcriber = new LiveTranscriber({
    botId: "b-voice", threadId: () => "t-voice", language: () => "fr",
    socket: (url) => {
      const path = new URL(url);
      path.searchParams.set("stt", "openai");
      page = new WebSocket(`${origin.replace(/^http/, "ws")}${path.pathname}?${path.searchParams}`, { origin });
      return page as unknown as globalThis.WebSocket;
    },
    transcribe: async () => { throw new Error("unexpected whole-turn fallback"); },
  });
  try {
    expect(await transcriber.connect()).toBe(true);
    transcriber.begin([]);
    transcriber.push(new Float32Array(3200).fill(0.05));
    const first = transcriber.finishHeard();
    transcriber.begin([]);
    transcriber.push(new Float32Array(3200).fill(0.05));
    const second = transcriber.finishHeard();
    const heard = await Promise.all([first, second]);
    expect(heard.map((turn) => turn.text)).toEqual(["Cherche le billet.", "Finalement, annule."]);
  } finally {
    transcriber.close();
    page?.terminate();
    for (const socket of upstream.clients) socket.terminate();
    upstream.close();
    await close(app);
    await close(provider);
  }
});
