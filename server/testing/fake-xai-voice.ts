// A loopback fake of the xAI voice endpoints voice mode uses
// (server/tts/grok.ts): GET /v1/tts/voices, POST /v1/tts (MP3, or raw PCM
// streamed in chunks for a live call), POST /v1/stt and the streaming speech
// to text WebSocket (wss://.../v1/stt: transcript.created, then a final
// transcript after each {"type":"finalize"}) and the streaming text to speech
// WebSocket (wss://.../v1/tts: text.delta and text.done in, base64 PCM
// audio.delta then audio.done out, text.clear answered by audio.clear; the
// `speech` controls refuse, delay, drop or fail it for the stability tests).
// Every other path is recorded
// and refused, so a check can prove voice mode never asked xAI to answer
// (no chat, responses or realtime agent endpoint).
// It records what each request carried (never answering with the key) so a
// check can prove the voice, speed and language the person picked reached
// xAI, and that the audio was a WAV turn. Point the server at it with
// SAGAX_XAI_TTS_API=<url>/v1.
import { createServer, type Server } from "node:http";

import { WebSocketServer } from "ws";

export interface FakeXaiRequest {
  method: string;
  path: string;
  authorization?: string;
  /** /v1/tts: the JSON body */
  json?: Record<string, unknown>;
  /** /v1/stt: the multipart fields (text) and the file's first bytes */
  fields?: Record<string, string>;
  fileHead?: string;
  /** the streaming speech to text socket */
  websocket?: boolean;
  query?: Record<string, string>;
  audioBytes?: number;
  finalizes?: number;
  /** the text to speech socket: each utterance's text (text.done), in order */
  utterances?: string[];
  /** the text to speech socket: text.clear received */
  clears?: number;
}

/** Live switches of the fake text to speech socket (tests change them). */
export interface FakeSpeechControls {
  /** refuse the upgrade (the socket never opens) */
  refuse: boolean;
  /** hold the upgrade this long (a slow or distant xAI) */
  openDelayMs: number;
  /** drop the connection right after this many more utterances start (then 0: off) */
  dropAfter: number;
  /** answer the next utterance with an error frame */
  errorNext: boolean;
}

/** Live switches of the fake speech to text, the socket and the upload
 * alike (tests change them). */
export interface FakeSttControls {
  /** refuse every speech to text request with this status and JSON body
   * (an account out of credits answers 503 `out_of_credits`) */
  refuse: { status: number; body: Record<string, unknown> } | null;
  /** take the socket, then answer the first audio with an error and close */
  failOnAudio: boolean;
}

/** Paths a voice call may use. Anything else (chat, responses, realtime)
 * would mean xAI was asked to answer instead of the bot. */
export const XAI_VOICE_PATHS = new Set(["/v1/tts", "/v1/tts/voices", "/v1/stt"]);

export interface FakeXaiOptions {
  transcript?: string;
  /** one transcript per finalized utterance of the streaming socket, in order (then `transcript`) */
  transcripts?: string[];
  /** delay before the first PCM chunk of a streamed sentence */
  ttsFirstChunkMs?: number;
  /** delay between finalize and the final transcript */
  sttFinalizeMs?: number;
  /** a confidence on each final transcript, like xAI may report */
  sttConfidence?: number;
  /** seconds of tone per streamed sentence */
  ttsSeconds?: number;
  /** ms between two 0.1 s chunks of streamed speech (20: five times real
   * time; 100: real time) */
  ttsChunkMs?: number;
  /** interim words while audio streams in, like xAI's interim results: the
   * next transcript's words, one per `msPerWord` of audio, each sent
   * `latencyMs` after the audio that completes it */
  sttPartials?: { msPerWord: number; latencyMs: number };
  /** every new TCP connection waits this long before it is served (a TLS
   * handshake to a distant api.x.ai); a kept-alive one does not */
  newConnectionMs?: number;
}

/** One provider mark correlated to a scripted utterance. `atMs` is milliseconds
 * since this fake started. Control routes are not timings. */
export interface FakeXaiTiming {
  path: "/v1/stt" | "/v1/tts";
  atMs: number;
  utteranceId?: string;
}

export interface FakeXaiVoice {
  url: string;
  requests: FakeXaiRequest[];
  /** STT finals and TTS first bytes, in order, tagged with the utterance id
   * bound by POST /__utterance. */
  timings: FakeXaiTiming[];
  speech: FakeSpeechControls;
  stt: FakeSttControls;
  close(): Promise<void>;
}

export const FAKE_XAI_VOICES = [
  { voice_id: "altair", name: "Altair" },
  { voice_id: "ara", name: "Ara" },
  { voice_id: "atlas", name: "Atlas" },
  { voice_id: "eve", name: "Eve" },
];

/** A few silent MPEG-1 Layer III frames (128 kbit/s, 44.1 kHz). */
function silentMp3(frames = 12): Buffer {
  const frame = Buffer.alloc(417);
  frame.set([0xff, 0xfb, 0x90, 0x00], 0);
  return Buffer.concat(Array.from({ length: frames }, () => frame));
}

/** The text fields and the file of a multipart body (enough for a fake). */
function multipart(body: Buffer, contentType: string): { fields: Record<string, string>; fileHead?: string } {
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/.exec(contentType);
  const marker = `--${boundary?.[1] ?? boundary?.[2] ?? ""}`;
  const fields: Record<string, string> = {};
  let fileHead: string | undefined;
  const text = body.toString("latin1");
  for (const part of text.split(marker)) {
    const split = part.indexOf("\r\n\r\n");
    if (split < 0) continue;
    const head = part.slice(0, split);
    const value = part.slice(split + 4).replace(/\r\n$/, "");
    const name = /name="([^"]+)"/.exec(head)?.[1];
    if (!name) continue;
    if (/filename="/.test(head)) fileHead = value.slice(0, 4);
    else fields[name] = value;
  }
  return { fields, fileHead };
}

/** A 220 Hz tone at 24 kHz, 16-bit little-endian: what a streamed sentence "says". */
function tonePcm(seconds: number): Buffer {
  const rate = 24_000;
  const out = Buffer.alloc(Math.round(rate * seconds) * 2);
  for (let i = 0; i < out.length / 2; i++) out.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 220 * i) / rate) * 0.3 * 0x7fff), i * 2);
  return out;
}

/** The longest handshake delay a test may ask for: enough to model a slow
 * provider, never a timer that outlives the run. */
export const MAX_FAKE_OPEN_DELAY_MS = 30_000;

/** Copy only the known controls, each of its own type, from a test's JSON:
 * no other key (`__proto__` included) reaches the controls object, and the
 * delay is bounded. */
export function applySpeechControls(speech: FakeSpeechControls, input: unknown): void {
  if (!input || typeof input !== "object" || Array.isArray(input)) return;
  const next = input as Record<string, unknown>;
  if (typeof next.refuse === "boolean") speech.refuse = next.refuse;
  if (typeof next.errorNext === "boolean") speech.errorNext = next.errorNext;
  if (typeof next.dropAfter === "number" && Number.isFinite(next.dropAfter)) speech.dropAfter = Math.max(0, Math.floor(next.dropAfter));
  if (typeof next.openDelayMs === "number" && Number.isFinite(next.openDelayMs)) {
    speech.openDelayMs = Math.min(MAX_FAKE_OPEN_DELAY_MS, Math.max(0, Math.floor(next.openDelayMs)));
  }
}

export async function startFakeXaiVoice(options: FakeXaiOptions = {}): Promise<FakeXaiVoice> {
  const requests: FakeXaiRequest[] = [];
  const timings: FakeXaiTiming[] = [];
  const startedAt = Date.now();
  const speech: FakeSpeechControls = { refuse: false, openDelayMs: 0, dropAfter: 0, errorNext: false };
  const stt: FakeSttControls = { refuse: null, failOnAudio: false };
  const transcripts = [...(options.transcripts ?? [])];
  let currentTranscript: string | undefined;
  let boundUtteranceId: string | undefined;
  const takeText = () => {
    if (transcripts.length) return transcripts.shift()!;
    if (currentTranscript !== undefined) return currentTranscript;
    return options.transcript ?? "Hello from voice mode";
  };
  const takeUtterance = () => {
    const id = boundUtteranceId;
    boundUtteranceId = undefined;
    return id;
  };
  const stamp = (path: "/v1/stt" | "/v1/tts", utteranceId?: string) => {
    timings.push({ path, atMs: Date.now() - startedAt, ...(utteranceId ? { utteranceId } : {}) });
  };
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      const path = (req.url ?? "").split("?")[0]!;
      // for the check in another process (the Electron side); not recorded
      if (req.method === "POST" && path === "/__speech") {
        try { applySpeechControls(speech, JSON.parse(body.toString("utf8"))); } catch { /* ignored */ }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(speech));
        return;
      }
      if (req.method === "GET" && path === "/__requests") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(requests));
        return;
      }
      if (req.method === "POST" && path === "/__transcript") {
        try {
          const bodyJson = JSON.parse(body.toString("utf8")) as { text?: unknown };
          currentTranscript = typeof bodyJson.text === "string" ? bodyJson.text : undefined;
        } catch {
          currentTranscript = undefined;
        }
        res.writeHead(204);
        res.end();
        return;
      }
      if (req.method === "POST" && path === "/__utterance") {
        try {
          const bodyJson = JSON.parse(body.toString("utf8")) as { utteranceId?: unknown };
          boundUtteranceId = typeof bodyJson.utteranceId === "string" && bodyJson.utteranceId.trim()
            ? bodyJson.utteranceId.trim()
            : undefined;
        } catch {
          boundUtteranceId = undefined;
        }
        res.writeHead(204);
        res.end();
        return;
      }
      if (req.method === "GET" && path === "/__timings") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(timings));
        return;
      }
      const record: FakeXaiRequest = { method: req.method ?? "", path, authorization: req.headers.authorization };
      requests.push(record);
      if (req.method === "GET" && path === "/v1/tts/voices") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ voices: FAKE_XAI_VOICES }));
        return;
      }
      if (req.method === "POST" && path === "/v1/tts") {
        try {
          record.json = JSON.parse(body.toString("utf8")) as Record<string, unknown>;
        } catch {
          record.json = {};
        }
        const format = record.json.output_format as { codec?: string } | undefined;
        if (format?.codec === "pcm") {
          // streamed as it is "made": a first chunk after a short delay, then the rest
          const audio = tonePcm(options.ttsSeconds ?? 0.6);
          res.writeHead(200, { "content-type": "application/octet-stream" });
          const chunk = 4800;
          let at = 0;
          const next = () => {
            if (res.destroyed) return;
            if (at >= audio.length) { res.end(); return; }
            res.write(audio.subarray(at, at + chunk));
            at += chunk;
            setTimeout(next, options.ttsChunkMs ?? 20);
          };
          setTimeout(next, options.ttsFirstChunkMs ?? 120);
          return;
        }
        res.writeHead(200, { "content-type": "audio/mpeg" });
        res.end(silentMp3());
        return;
      }
      if (req.method === "POST" && path === "/v1/stt") {
        const parsed = multipart(body, String(req.headers["content-type"] ?? ""));
        record.fields = parsed.fields;
        record.fileHead = parsed.fileHead;
        if (stt.refuse) {
          res.writeHead(stt.refuse.status, { "content-type": "application/json" });
          res.end(JSON.stringify(stt.refuse.body));
          return;
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ text: takeText(), language: parsed.fields.language ?? "en", duration: 1.2 }));
        return;
      }
      res.writeHead(404, { "content-type": "application/json" });
      res.end("{}");
    });
  });
  const sockets = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "", "http://fake");
    const record: FakeXaiRequest = {
      method: "GET", path: url.pathname, authorization: req.headers.authorization, websocket: true,
      query: Object.fromEntries(url.searchParams), audioBytes: 0, finalizes: 0,
    };
    requests.push(record);
    if (url.pathname === "/v1/tts") {
      record.utterances = [];
      record.clears = 0;
      if (speech.refuse) { socket.destroy(); return; }
      const accept = () => sockets.handleUpgrade(req, socket, head, (ws) => serveSpeech(ws, record));
      if (speech.openDelayMs) setTimeout(accept, speech.openDelayMs);
      else accept();
      return;
    }
    if (url.pathname !== "/v1/stt") { socket.destroy(); return; }
    if (stt.refuse) {
      // a refused handshake, as xAI answers an account it will not serve
      const body = JSON.stringify(stt.refuse.body);
      socket.end(`HTTP/1.1 ${stt.refuse.status} Refused\r\ncontent-type: application/json\r\ncontent-length: ${Buffer.byteLength(body)}\r\nconnection: close\r\n\r\n${body}`);
      return;
    }
    sockets.handleUpgrade(req, socket, head, (ws) => {
      ws.send(JSON.stringify({ type: "transcript.created" }));
      // the utterance being heard: its audio so far and the words already said
      let utteranceBytes = 0;
      let wordsSent = 0;
      ws.on("message", (data, binary) => {
        if (binary) {
          record.audioBytes = (record.audioBytes ?? 0) + (data as Buffer).length;
          if (stt.failOnAudio) {
            ws.send(JSON.stringify({ type: "error", message: "fake transcription error" }));
            ws.close();
            return;
          }
          const partials = options.sttPartials;
          if (partials) {
            utteranceBytes += (data as Buffer).length;
            const words = (transcripts[0] ?? options.transcript ?? "Hello from voice mode").split(/\s+/);
            const heardWords = Math.min(words.length, Math.floor(utteranceBytes / (32 * partials.msPerWord)));
            if (heardWords > wordsSent) {
              wordsSent = heardWords;
              const text = words.slice(0, heardWords).join(" ");
              setTimeout(() => {
                if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: "transcript.partial", text, is_final: false, speech_final: false, start: 0, duration: 1 }));
              }, partials.latencyMs);
            }
          }
          return;
        }
        let message: { type?: string } = {};
        try { message = JSON.parse(String(data)) as { type?: string }; } catch { /* ignored */ }
        if (message.type === "finalize") {
          record.finalizes = (record.finalizes ?? 0) + 1;
          utteranceBytes = 0;
          wordsSent = 0;
          const text = takeText();
          const utteranceId = takeUtterance();
          setTimeout(() => {
            stamp("/v1/stt", utteranceId);
            if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: "transcript.partial", text, is_final: true, speech_final: true, start: 0, duration: 1, ...(options.sttConfidence !== undefined ? { confidence: options.sttConfidence } : {}) }));
          }, options.sttFinalizeMs ?? 80);
        } else if (message.type === "audio.done") {
          ws.send(JSON.stringify({ type: "transcript.done", text: "" }));
          ws.close();
        }
      });
    });
  });
  /** One text to speech socket: utterances one after the other, as xAI. */
  function serveSpeech(ws: import("ws").WebSocket, record: FakeXaiRequest): void {
    let text = "";
    let timer: ReturnType<typeof setTimeout> | null = null;
    const stop = () => {
      if (timer) clearTimeout(timer);
      timer = null;
    };
    const say = (json: Record<string, unknown>) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(json));
    };
    ws.on("close", stop);
    ws.on("message", (data, binary) => {
      if (binary) return;
      let message: { type?: string; delta?: string } = {};
      try { message = JSON.parse(String(data)) as typeof message; } catch { return; }
      if (message.type === "text.delta") text += message.delta ?? "";
      else if (message.type === "text.clear") {
        record.clears = (record.clears ?? 0) + 1;
        stop();
        text = "";
        say({ type: "audio.clear" });
      } else if (message.type === "text.done") {
        record.utterances!.push(text);
        const utteranceId = takeUtterance();
        let stamped = false;
        text = "";
        if (speech.errorNext) {
          speech.errorNext = false;
          say({ type: "error", message: "fake synthesis error" });
          return;
        }
        if (speech.dropAfter > 0 && --speech.dropAfter === 0) {
          ws.terminate();
          return;
        }
        // made like the POST: a first chunk after a delay, then the rest
        const audio = tonePcm(options.ttsSeconds ?? 0.6);
        const chunk = 4800;
        let at = 0;
        const next = () => {
          if (ws.readyState !== ws.OPEN) return;
          if (at >= audio.length) {
            timer = null;
            say({ type: "audio.done", trace_id: "fake" });
            return;
          }
          if (!stamped) {
            stamped = true;
            stamp("/v1/tts", utteranceId);
          }
          say({ type: "audio.delta", delta: audio.subarray(at, at + chunk).toString("base64") });
          at += chunk;
          timer = setTimeout(next, options.ttsChunkMs ?? 20);
        };
        timer = setTimeout(next, options.ttsFirstChunkMs ?? 120);
      }
    });
  }

  if (options.newConnectionMs) {
    const handshake = options.newConnectionMs;
    server.on("connection", (socket) => {
      socket.pause();
      setTimeout(() => socket.resume(), handshake);
    });
  }
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fake xAI did not get a TCP port");
  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    timings,
    speech,
    stt,
    close: () => new Promise<void>((resolve) => {
      for (const client of sockets.clients) client.terminate();
      sockets.close();
      server.closeAllConnections?.();
      server.close(() => resolve());
    }),
  };
}
