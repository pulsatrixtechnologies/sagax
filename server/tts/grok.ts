// xAI TTS runs on the harness with the xAI key (one key for bots on Grok and Grok voice since 2026-10-14).
import { z } from "zod";
import { WebSocket as WsWebSocket } from "ws";
import type { Audio, Voice } from "./elevenlabs.ts";

const API = (process.env.SAGAX_XAI_TTS_API || "https://api.x.ai/v1").replace(/\/+$/, "");
const voicesSchema = z.object({
  voices: z.array(z.object({
    voice_id: z.string().min(1),
    name: z.string().min(1),
    description: z.string().optional(),
  })),
});

const sttSchema = z.object({ text: z.string(), language: z.string().optional() });

/** What kind of failure a Grok voice message is, for the page: `key`
 * (rejected key or permissions), `quota` (no credits), `busy` (rate
 * limited), `down` (xAI unreachable or failing), `voice` (unknown voice),
 * `other`. The messages below are this file's own, never xAI's words. */
export type GrokVoiceFailure = "key" | "quota" | "busy" | "down" | "voice" | "other";

export function grokVoiceFailure(message: string): GrokVoiceFailure {
  if (/rejected the key/.test(message)) return "key";
  if (/needs credits/.test(message)) return "quota";
  if (/rate-limiting/.test(message)) return "busy";
  if (/could not find that voice/.test(message)) return "voice";
  if (/Could not reach (?:Grok|OpenAI|ElevenLabs) voice|timed out|(?:Grok|OpenAI|ElevenLabs) voice failed \(HTTP 5\d\d[):]|not reachable/.test(message)) return "down";
  return "other";
}

/** The HTTP status `ws` reports when xAI refuses a socket's handshake
 * ("Unexpected server response: 401"), or null for a network error. */
export function handshakeStatus(event: unknown): number | null {
  const record = event as { message?: unknown; error?: { message?: unknown } } | null;
  const text = [record?.message, record?.error?.message].find((value): value is string => typeof value === "string") ?? "";
  const match = /Unexpected server response: (\d{3})/.exec(text);
  return match ? Number(match[1]) : null;
}

/** A socket error as a Grok voice message: a refused handshake says why
 * (key, credits, rate limit), anything else is the network. */
function socketFailure(event: unknown): string {
  const status = handshakeStatus(event);
  return status === null ? "Could not reach Grok voice. Check your connection." : refusal(status);
}

/** The most of an xAI error body read to sort a refusal. */
const REFUSAL_BODY_MAX = 2_048;

/** xAI's own reason in an error body (`{"code": ..., "error": ...}`), read
 * only to sort the refusal: an invalid key answers 400 "Incorrect API key
 * provided" (checked 2026-10-28), not 401. Never passed on verbatim: the
 * page and the log get this file's own words, plus xAI's `code` category
 * for a 400 that is none of the known kinds. */
export function refusalDetail(body: string): { code?: string; error?: string } {
  try {
    const parsed = JSON.parse(body.slice(0, REFUSAL_BODY_MAX)) as Record<string, unknown>;
    return {
      ...(typeof parsed.code === "string" ? { code: parsed.code } : {}),
      ...(typeof parsed.error === "string" ? { error: parsed.error } : {}),
    };
  } catch {
    return {};
  }
}

export function refusal(status: number, detail: { code?: string; error?: string } = {}): string {
  const said = `${detail.code ?? ""} ${detail.error ?? ""}`;
  if (status === 401 || status === 403 || /incorrect api key|invalid api key|api key (?:is )?(?:invalid|disabled|blocked|revoked)|unauthenticated|permission/i.test(said)) {
    if (/credit|spending limit|billing|exhausted/i.test(said)) return "The xAI account needs credits to generate speech.";
    return "xAI rejected the key or its TTS permissions. Check the xAI key in Settings.";
  }
  if (status === 402 || /credit|spending limit|billing/i.test(said)) return "The xAI account needs credits to generate speech.";
  if (status === 429 || /rate limit|too many requests/i.test(said)) return "xAI is rate-limiting speech. Wait a moment and try again.";
  if (status === 404) return "xAI could not find that voice. Refresh the voice list and select a voice again.";
  // xAI's category only ("Client specified an invalid argument"), never its message
  const category = detail.code && /^[\w .,:'()-]{1,100}$/.test(detail.code) ? `: ${detail.code}` : "";
  return `Grok voice failed (HTTP ${status}${category}). Try again later.`;
}

/** A refused handshake (`ws` "unexpected-response"): its status and body,
 * read up to REFUSAL_BODY_MAX, as a Grok voice message. */
function readRefusal(res: { statusCode?: number; on(event: string, cb: (chunk?: unknown) => void): unknown; destroy?(): void }): Promise<string> {
  return new Promise((resolve) => {
    let body = "";
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve(refusal(res.statusCode ?? 0, refusalDetail(body)));
    };
    res.on("data", (chunk) => {
      if (body.length < REFUSAL_BODY_MAX) body += String(chunk);
      else res.destroy?.();
    });
    res.on("end", done);
    res.on("close", done);
    res.on("error", done);
    setTimeout(done, 2_000).unref?.();
  });
}

/** Listen for a refused handshake on a `ws` socket (a test's fake has no
 * `on`: the error event's status is used then). */
function onRefused(socket: WebSocket, failWith: (message: string) => void): void {
  const node = socket as unknown as { on?: (event: string, cb: (req: unknown, res: Parameters<typeof readRefusal>[0]) => void) => void; terminate?: () => void };
  if (typeof node.on !== "function") return;
  // with this listener `ws` leaves the refused request to us: read why, then end it
  node.on("unexpected-response", (_req, res) => {
    void readRefusal(res).then((message) => {
      failWith(message);
      try { node.terminate?.(); } catch { /* already gone */ }
    });
  });
}

async function readLimitedText(response: Response, max: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let text = "";
  try {
    while (text.length < max) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
  } catch {
    /* what came is enough */
  } finally {
    void reader.cancel().catch(() => {});
  }
  return text.slice(0, max);
}

async function request(path: string, init: RequestInit): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(`${API}${path}`, { ...init, redirect: "error" });
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      throw new Error("Grok voice timed out. Try again.");
    }
    throw new Error("Could not reach Grok voice. Check your connection.");
  }
  if (!response.ok) {
    // read only to sort the refusal (an invalid key is a 400); remote error
    // bodies can echo credentials or request text, so none of it is passed on
    const body = await readLimitedText(response, REFUSAL_BODY_MAX);
    throw new Error(refusal(response.status, refusalDetail(body)));
  }
  return response;
}

export async function listVoices(key: string): Promise<Voice[]> {
  const response = await request("/tts/voices", {
    headers: { authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(20_000),
  });
  const parsed = voicesSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) throw new Error("Grok returned an invalid voice list. Try again later.");
  return parsed.data.voices.map((voice) => ({
    id: voice.voice_id, label: voice.name, description: voice.description,
  }));
}

/** Voice mode's choices for one utterance (shared/voice-mode.ts): xAI
 * takes `speed` from 0.7 to 1.5 and a BCP-47 `language` or "auto". */
export interface SynthesizeOptions {
  speed?: number;
  language?: string;
}

export async function synthesize(text: string, voiceId: string | undefined, key: string, options: SynthesizeOptions = {}): Promise<Audio> {
  const body: Record<string, unknown> = { text, language: options.language || "auto", output_format: { codec: "mp3" } };
  // no voice: xAI's default voice
  if (voiceId) body.voice_id = voiceId;
  if (typeof options.speed === "number" && options.speed !== 1) body.speed = options.speed;
  const response = await request("/tts", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json", accept: "audio/mpeg" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  const mime = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (mime !== "audio/mpeg" && mime !== "audio/mp3") {
    await response.body?.cancel();
    throw new Error("Grok returned an unexpected audio format. Try again later.");
  }
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await response.arrayBuffer());
  } catch {
    throw new Error("Grok audio download was interrupted. Try again.");
  }
  if (!bytes.byteLength) throw new Error("Grok returned empty audio. Try again.");
  return { bytes, mime: "audio/mpeg" };
}

/** Speech to text (POST /v1/stt, multipart): one recorded turn. `language`
 * is a hint; without it xAI detects the language. `format` (inverse text
 * normalization: "deux cents" as 200) needs a language, so it is only sent
 * with one. Fillers ("euh", "um") are kept, as on the live socket: the
 * caller removes them from what the bot reads (shared/voice-mode.ts). */
export async function transcribe(audio: Uint8Array, mime: string, key: string, language?: string, keyterms: readonly string[] = [], options: { format?: boolean } = {}): Promise<{ text: string; language?: string }> {
  const form = new FormData();
  const name = mime === "audio/wav" ? "turn.wav" : mime === "audio/webm" ? "turn.webm" : "turn.ogg";
  if (language) form.append("language", language);
  if (language && options.format) form.append("format", "true");
  form.append("filler_words", "true");
  for (const term of keyterms) form.append("keyterm", term);
  // xAI reads the fields before `file` only: it must be the last one
  form.append("file", new Blob([new Uint8Array(audio)], { type: mime }), name);
  const response = await request("/stt", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, accept: "application/json" },
    body: form,
    signal: AbortSignal.timeout(60_000),
  });
  const parsed = sttSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) throw new Error("Grok returned an invalid transcript. Try again later.");
  return { text: parsed.data.text, ...(parsed.data.language ? { language: parsed.data.language } : {}) };
}

/** The sample rate of the raw PCM voice mode's live calls play
 * (16-bit little-endian mono). */
export const VOICE_STREAM_RATE = 24_000;

/** Text to speech as it is generated: POST /v1/tts with a raw PCM
 * `output_format` answers the audio bytes as xAI produces them, so the first
 * chunk plays before the sentence is fully synthesized
 * (https://docs.x.ai/developers/model-capabilities/audio/text-to-speech).
 * The connection to api.x.ai is pooled by fetch (keep-alive), so the next
 * sentence of the same answer reuses a warm connection. */
export async function synthesizeStream(
  text: string,
  voiceId: string | undefined,
  key: string,
  options: SynthesizeOptions = {},
  signal?: AbortSignal,
): Promise<{ body: ReadableStream<Uint8Array>; sampleRate: number }> {
  const body: Record<string, unknown> = {
    text,
    language: options.language || "auto",
    output_format: { codec: "pcm", sample_rate: VOICE_STREAM_RATE },
  };
  if (voiceId) body.voice_id = voiceId;
  if (typeof options.speed === "number" && options.speed !== 1) body.speed = options.speed;
  const timeout = AbortSignal.timeout(60_000);
  const response = await request("/tts", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json", accept: "application/octet-stream" },
    body: JSON.stringify(body),
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  const mime = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (mime === "application/json" || mime.startsWith("text/") || !response.body) {
    await response.body?.cancel();
    throw new Error("Grok returned an unexpected audio format. Try again later.");
  }
  return { body: response.body, sampleRate: VOICE_STREAM_RATE };
}

/** One event of xAI's streaming speech to text (wss://api.x.ai/v1/stt). */
export interface TranscriptEvent {
  text: string;
  /** Client finalize that owns this result, when the provider exposes
   * committed item ids (OpenAI). xAI keeps its ordered chunk protocol. */
  requestId?: string;
  /** a chunk xAI will not revise */
  final: boolean;
  /** the speaker stopped (endpointing or Smart Turn) */
  speechFinal: boolean;
  /** xAI's confidence in a chunk (0..1), when it reports one: the frame's
   * own, else the lowest of its words' */
  confidence?: number;
  /** Smart Turn's estimate (0..1) that the speaker has finished, on a
   * partial that carries one. The page's turn detector reads it; xAI's
   * own threshold is set so high it never ends a turn by itself. */
  endOfTurnConfidence?: number;
}

function transcriptConfidence(frame: Record<string, unknown>): number | undefined {
  const own = frame.confidence;
  if (typeof own === "number" && Number.isFinite(own)) return Math.min(1, Math.max(0, own));
  if (!Array.isArray(frame.words)) return undefined;
  const scores = frame.words
    .map((word) => (word && typeof word === "object" ? (word as Record<string, unknown>).confidence : undefined))
    .filter((score): score is number => typeof score === "number" && Number.isFinite(score));
  return scores.length ? Math.min(1, Math.max(0, Math.min(...scores))) : undefined;
}

export interface TranscriptionStream {
  /** resolves once xAI says `transcript.created` (ready for audio) */
  ready: Promise<void>;
  /** 16-bit little-endian PCM at 16 kHz, mono */
  send(pcm: Uint8Array): void;
  /** end the current utterance now (`{"type":"finalize"}`) */
  finalize(requestId?: string): void;
  close(): void;
}

export interface TranscriptionHandlers {
  onTranscript(event: TranscriptEvent): void;
  onError(message: string): void;
  onClose(): void;
}

/** A WebSocket constructor that can send an Authorization header. Production
 * uses `ws` so idle `ping()` frames keep xAI from dropping the socket.
 * Injected in tests. */
export type HeaderWebSocket = new (url: string, init: { headers: Record<string, string> }) => WebSocket;

/** Idle protocol ping on the TTS socket so the next clause does not pay a
 * reconnect. Matches grok HTTP warmSession (GET /models every 2.5 s). */
export const SPEECH_PING_MS = 2_500;

function pingSocket(socket: WebSocket) {
  const keep = socket as WebSocket & { ping?: () => void };
  if (typeof keep.ping === "function") {
    try { keep.ping(); } catch { /* socket closing */ }
  }
}

/** Smart Turn's threshold on the live socket: high enough that xAI never
 * ends a turn itself (the page's detector does, reading the confidence). */
export const SMART_TURN_THRESHOLD = 0.9;
/** Smart Turn's own timeout, long for the same reason. */
export const SMART_TURN_TIMEOUT_MS = 5_000;

/** Streaming speech to text for a live call: one connection per call,
 * audio frames in, partial and final transcripts out. The session goes on
 * after a finalize, so every turn of the call reuses it.
 * https://docs.x.ai/developers/model-capabilities/audio/speech-to-text */
export function openTranscriptionStream(
  key: string,
  options: { language?: string; endpointingMs?: number; keyterms?: readonly string[]; format?: boolean },
  handlers: TranscriptionHandlers,
  Socket: HeaderWebSocket = WsWebSocket as unknown as HeaderWebSocket,
): TranscriptionStream {
  const query = new URLSearchParams({
    model: "grok-voice-transcribe-2.0",
    encoding: "pcm",
    sample_rate: "16000",
    interim_results: "true",
    endpointing: String(Math.max(0, Math.min(5000, Math.round(options.endpointingMs ?? 700)))),
    // "euh", "um" stay in the words: the page's turn detector reads a
    // trailing filler as a person still thinking, never as an ending. They
    // are removed only from the text the bot gets.
    filler_words: "true",
    // Smart Turn adds end_of_turn_confidence to every partial; the page
    // decides. A threshold this high and a long timeout keep xAI from
    // ending a turn on its own.
    smart_turn: String(SMART_TURN_THRESHOLD),
    smart_turn_timeout: String(SMART_TURN_TIMEOUT_MS),
  });
  if (options.language) query.set("language", options.language);
  // inverse text normalization needs a language
  if (options.language && options.format) query.set("format", "true");
  // vocabulary biasing: the bot's and the person's names, the thread's
  // proper nouns (server/voice-keyterms.ts)
  for (const term of options.keyterms ?? []) query.append("keyterm", term);
  const url = `${API.replace(/^http/, "ws")}/stt?${query}`;
  let socket: WebSocket;
  let closed = false;
  let ping: ReturnType<typeof setInterval> | null = null;
  let resolveReady!: () => void;
  let rejectReady!: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  ready.catch(() => {});
  const stopPing = () => {
    if (!ping) return;
    clearInterval(ping);
    ping = null;
  };
  const fail = (message: string) => {
    if (closed) return;
    closed = true;
    stopPing();
    rejectReady(new Error(message));
    handlers.onError(message);
    try { socket?.close(); } catch { /* already closed */ }
    handlers.onClose();
  };
  try {
    socket = new Socket(url, { headers: { authorization: `Bearer ${key}` } });
  } catch {
    queueMicrotask(() => fail("Could not reach Grok voice. Check your connection."));
    return { ready, send() {}, finalize() {}, close() {} };
  }
  socket.binaryType = "arraybuffer";
  onRefused(socket, fail);
  socket.addEventListener("open", () => {
    if (closed || ping) return;
    ping = setInterval(() => {
      if (!closed && socket.readyState === 1) pingSocket(socket);
    }, SPEECH_PING_MS);
    ping.unref?.();
  });
  socket.addEventListener("message", (event: MessageEvent) => {
    if (typeof event.data !== "string") return;
    let frame: Record<string, unknown>;
    try { frame = JSON.parse(event.data) as Record<string, unknown>; } catch { return; }
    if (frame.type === "transcript.created") resolveReady();
    else if (frame.type === "transcript.partial" || frame.type === "transcript.done") {
      const confidence = transcriptConfidence(frame);
      const endOfTurn = frame.end_of_turn_confidence;
      handlers.onTranscript({
        text: typeof frame.text === "string" ? frame.text : "",
        final: frame.type === "transcript.done" || frame.is_final === true,
        speechFinal: frame.type === "transcript.done" || frame.speech_final === true,
        ...(confidence !== undefined ? { confidence } : {}),
        ...(typeof endOfTurn === "number" && Number.isFinite(endOfTurn) ? { endOfTurnConfidence: Math.min(1, Math.max(0, endOfTurn)) } : {}),
      });
    } else if (frame.type === "error") {
      // xAI's message may echo request details; never pass it on verbatim
      fail("Grok speech to text reported an error. Try again.");
    }
  });
  socket.addEventListener("error", (event) => fail(socketFailure(event)));
  socket.addEventListener("close", () => {
    stopPing();
    if (closed) return;
    closed = true;
    rejectReady(new Error("closed"));
    handlers.onClose();
  });
  return {
    ready,
    send(pcm) {
      if (!closed && socket.readyState === 1) socket.send(new Uint8Array(pcm));
    },
    finalize() {
      if (!closed && socket.readyState === 1) socket.send(JSON.stringify({ type: "finalize" }));
    },
    close() {
      if (closed) return;
      closed = true;
      stopPing();
      try {
        if (socket.readyState === 1) socket.send(JSON.stringify({ type: "audio.done" }));
        socket.close();
      } catch { /* already closed */ }
      handlers.onClose();
    },
  };
}

/** What xAI's streaming text to speech socket says back. */
export interface SpeechStreamHandlers {
  /** raw 16-bit little-endian PCM at VOICE_STREAM_RATE */
  onAudio(pcm: Uint8Array): void;
  /** the utterance's audio is complete (`audio.done`) */
  onDone(): void;
  /** the utterance was cancelled (`audio.clear`, after `text.clear`) */
  onCleared(): void;
  onError(message: string): void;
  onClose(): void;
}

export interface SpeechStream {
  /** resolves once the socket is open (xAI takes text from then on) */
  ready: Promise<void>;
  /** one utterance: its text (`text.delta`), then `text.done` */
  speak(text: string): void;
  /** a chunk of the current utterance (`text.delta` only). Audio can start
   * before `done` (xAI buffers until it can pronounce). */
  delta(text: string): void;
  /** end the current utterance (`text.done`) */
  done(): void;
  /** cancel the utterance in progress (`text.clear`); xAI answers `audio.clear` */
  clear(): void;
  close(): void;
}

/** How hard xAI trades quality at chunk boundaries for an earlier first
 * chunk: 2 is its lowest time to first audio. */
export const SPEECH_STREAM_LATENCY = 2;

/** Streaming text to speech for a live call: one socket per call, one
 * utterance per clause of the bot's answer, raw PCM back as base64
 * `audio.delta` frames. The socket stays open between utterances, and
 * `text.clear` cancels the one playing without a reconnect (barge-in).
 * Voice, speed and language are fixed when it opens.
 * https://docs.x.ai/developers/model-capabilities/audio/text-to-speech#streaming-tts-websocket */
export function openSpeechStream(
  key: string,
  options: { voice?: string; speed?: number; language?: string },
  handlers: SpeechStreamHandlers,
  Socket: HeaderWebSocket = WsWebSocket as unknown as HeaderWebSocket,
): SpeechStream {
  const query = new URLSearchParams({
    language: options.language || "auto",
    codec: "pcm",
    sample_rate: String(VOICE_STREAM_RATE),
    optimize_streaming_latency: String(SPEECH_STREAM_LATENCY),
  });
  if (options.voice) query.set("voice", options.voice);
  if (typeof options.speed === "number" && options.speed !== 1) query.set("speed", String(options.speed));
  const url = `${API.replace(/^http/, "ws")}/tts?${query}`;
  let socket: WebSocket;
  let closed = false;
  let ping: ReturnType<typeof setInterval> | null = null;
  let resolveReady!: () => void;
  let rejectReady!: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  ready.catch(() => {});
  const stopPing = () => {
    if (!ping) return;
    clearInterval(ping);
    ping = null;
  };
  const end = () => {
    if (closed) return;
    closed = true;
    stopPing();
    rejectReady(new Error("closed"));
    try { socket?.close(); } catch { /* already closed */ }
    handlers.onClose();
  };
  try {
    socket = new Socket(url, { headers: { authorization: `Bearer ${key}` } });
  } catch {
    queueMicrotask(() => {
      handlers.onError("Could not reach Grok voice. Check your connection.");
      end();
    });
    return { ready, speak() {}, delta() {}, done() {}, clear() {}, close() {} };
  }
  socket.binaryType = "arraybuffer";
  onRefused(socket, (message) => {
    if (closed) return;
    handlers.onError(message);
    end();
  });
  socket.addEventListener("open", () => {
    resolveReady();
    if (closed || ping) return;
    ping = setInterval(() => {
      if (!closed && socket.readyState === 1) pingSocket(socket);
    }, SPEECH_PING_MS);
    ping.unref?.();
  });
  socket.addEventListener("message", (event: MessageEvent) => {
    if (typeof event.data !== "string") return;
    let frame: Record<string, unknown>;
    try { frame = JSON.parse(event.data) as Record<string, unknown>; } catch { return; }
    if (frame.type === "audio.delta" && typeof frame.delta === "string") {
      const pcm = Buffer.from(frame.delta, "base64");
      if (pcm.byteLength) handlers.onAudio(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength));
    } else if (frame.type === "audio.done") handlers.onDone();
    else if (frame.type === "audio.clear") handlers.onCleared();
    // xAI's message may echo request details; never pass it on verbatim
    else if (frame.type === "error") handlers.onError("Grok text to speech reported an error.");
  });
  socket.addEventListener("error", (event) => {
    if (closed) return;
    handlers.onError(socketFailure(event));
    end();
  });
  socket.addEventListener("close", end);
  const send = (message: Record<string, unknown>) => {
    if (!closed && socket.readyState === 1) socket.send(JSON.stringify(message));
  };
  return {
    ready,
    delta(text) {
      send({ type: "text.delta", delta: text });
    },
    done() {
      send({ type: "text.done" });
    },
    speak(text) {
      send({ type: "text.delta", delta: text });
      send({ type: "text.done" });
    },
    clear() {
      send({ type: "text.clear" });
    },
    close: end,
  };
}

/** wss://api.x.ai/v1/realtime for one call (server/realtime-call.ts): the
 * key in the Authorization header, never in the URL. A refused handshake
 * comes back on `onerror` as this file's own words (key, credits, rate
 * limit), so the call can say which key to fix. */
export function openRealtimeSocket(key: string, url: string): {
  readonly readyState: number;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
} {
  const socket = new WsWebSocket(url, { headers: { authorization: `Bearer ${key}` } });
  const adapter = {
    get readyState() { return socket.readyState; },
    onopen: null as ((event: unknown) => void) | null,
    onmessage: null as ((event: { data: unknown }) => void) | null,
    onclose: null as ((event: unknown) => void) | null,
    onerror: null as ((event: unknown) => void) | null,
    send: (data: string) => socket.send(data),
    close: (code?: number, reason?: string) => socket.close(code, reason),
  };
  socket.on("open", () => adapter.onopen?.({}));
  socket.on("message", (data: Buffer, binary: boolean) => adapter.onmessage?.({ data: binary ? data : data.toString("utf8") }));
  // the close code says why a call ended (realtimeDropReason)
  socket.on("close", (code: number) => adapter.onclose?.({ code }));
  socket.on("error", (error) => adapter.onerror?.({ message: socketFailure(error) }));
  socket.on("unexpected-response", (_request, response) => {
    adapter.onerror?.({ message: refusal(response.statusCode ?? 0) });
    socket.terminate();
  });
  return adapter;
}
