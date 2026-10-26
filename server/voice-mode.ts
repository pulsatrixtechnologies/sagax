// Voice mode (the floating voice bar) on any server, solo or organization:
// xAI does the voice, the bot stays the brain.
//
//   GET  /api/bots/<id>/voice/status      can this person talk to this bot by voice, and who pays
//   GET  /api/bots/<id>/voice/voices      xAI's voices (labels only)
//   POST /api/bots/<id>/voice/prepare     {text} -> {utterances}
//   POST /api/bots/<id>/voice/speak       {text, voice?, speed?, language?, threadId?} -> audio/mpeg
//   POST /api/bots/<id>/voice/transcribe  raw audio/wav (?language=&locale=&threadId=) -> {text}
//   POST /api/bots/<id>/voice/stream      {text, voice?, speed?, language?, threadId?} -> raw PCM as xAI makes it
//   GET  /api/bots/<id>/voice/listen      WebSocket (?language=&locale=&threadId=): PCM frames in, transcripts out
//   GET  /api/bots/<id>/voice/speech      WebSocket (?voice=&speed=&language=&threadId=): clauses in, PCM out
//   POST /api/bots/<id>/voice/call        {threadId, callId, state: start|alive|end, language?}: the thread is on a call
//
// A live call (src/lib/voice-mode/call.ts) uses the last two: the person's
// audio streams to xAI's streaming speech to text while they speak, and each
// sentence of the bot's answer is synthesized as soon as the bot has written
// it, its audio streamed back while xAI produces it. xAI is only ears and a
// voice here, never the one who answers: no route calls a chat, responses or
// realtime agent endpoint of xAI (server/voice-mode.test.ts checks it).
//
// The microphone and the speaker are the person's own (the desktop app or a
// browser); what they say goes to the bot as an ordinary message through the
// usual send route, so the turn is theirs and the private-thread rules apply
// exactly as for a typed message. These routes only turn speech into text
// and text into speech, with xAI, and the key never leaves the server:
// xAI's own guidance is to proxy speech to text through a backend rather
// than put a key in a client
// (https://docs.x.ai/developers/model-capabilities/audio/speech-to-text).
// Its ephemeral client secrets (POST /v1/realtime/client_secrets) open only
// the realtime speech-to-speech agent, where Grok itself would answer instead
// of the bot, its tools, approvals and memory, so voice mode does not use them.
//
// Who pays (the order of engine-credentials.ts, for the person who speaks):
//   organization server: the speaker's own xAI key in Perspicax, else the
//   organization's xAI key (Settings > Models and voice, xai.key), else
//   refused with an access card shown only to that person; a disabled
//   person is refused. Solo server: the server's xAI key. Since
//   2026-10-14 Grok voice and Grok bots share that one key.
// Every request names a bot the person may use (the visibility gate already
// hides the others) and, when given, a thread they may post to. Each speak
// and transcribe is recorded in the usage ledger with `access` (the via).
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";

import {
  VOICE_ID,
  VOICE_MODE_MAX_AUDIO_BYTES,
  VOICE_MODE_MAX_SPEED,
  VOICE_MODE_MAX_TEXT,
  VOICE_MODE_MIN_SPEED,
  isVoiceModeLanguage,
  stripFillers,
  sttRequest,
  ttsLanguage,
  type VoiceModeRefusalCause,
  type VoiceModeStatus,
  type VoiceModeVia,
} from "../shared/voice-mode.ts";
import { accessCardVisibleTo } from "./engine-access.ts";
import { isSameOrigin } from "./request-auth.ts";
import { websocketAccept } from "./ws-bridge.ts";
import { webSocketSession } from "./ws-session.ts";
import { readForVoice } from "./tts/voice-reading.ts";
import { speakableDelta } from "./tts/speech-text.ts";
import { createListenSession } from "./voice-listen-session.ts";
import type { SpeechStream, SpeechStreamHandlers, SynthesizeOptions, TranscriptionHandlers, TranscriptionStream } from "./tts/grok.ts";
import { createSpeechSession } from "./voice-speech-session.ts";
import type { ProviderKeyResult } from "./perspicax-link.ts";
import type { RequestAuth } from "./request-auth.ts";
import { PASS, type RouteHandler } from "./routes/table.ts";
import type { Audio, Voice } from "./tts/elevenlabs.ts";

const ROUTE = /^\/api\/bots\/([\w-]+)\/voice\/(status|voices|prepare|speak|transcribe|stream|listen|speech|call)$/;
type Action = "status" | "voices" | "prepare" | "speak" | "transcribe" | "stream" | "listen" | "speech" | "call";
const CALL_ID = /^[A-Za-z0-9_-]{8,80}$/;
/** A turn's end warms the connection to xAI's speech at most this often. */
export const LISTEN_WARM_EVERY_MS = 2_000;
/** The most audio one live call may stream (16 kHz 16-bit mono: 2 hours). */
export const VOICE_LISTEN_MAX_BYTES = 16_000 * 2 * 60 * 60 * 2;
const LISTEN_READY_MS = 8_000;
/** xAI's speech socket must open this soon, else the page speaks over POST. */
export const SPEECH_READY_MS = 1_500;
/** The PCM rate of the streaming voice (tts/grok.ts VOICE_STREAM_RATE). */
const VOICE_SPEECH_RATE = 24_000;
const THREAD_ID = /^[\w-]{1,128}$/;
/** Requests per person per minute (speak, transcribe and voices together). */
export const VOICE_MODE_RATE = { max: 120, windowMs: 60_000 } as const;

export interface VoiceSpeaker {
  /** The person who speaks (principal id), "" for the solo operator's console. */
  principalId: string;
  /** Their Perspicax subject (organization server). */
  sub?: string;
  disabled?: boolean;
}

export interface VoiceTarget {
  botId: string;
  botName: string;
  threadId: string;
  /** The bot's owner (organization server), for the access card's audience. */
  ownerPrincipalId?: string;
}

export type VoiceKey =
  | { ok: true; key: string; via: VoiceModeVia; payerPrincipalId?: string }
  | { ok: false; cause: VoiceModeRefusalCause };

export interface VoiceUsage {
  target: VoiceTarget;
  speaker: VoiceSpeaker;
  via: VoiceModeVia;
  payerPrincipalId?: string;
  model: "grok-tts" | "grok-stt";
  /** characters spoken, or bytes of audio heard */
  input: number;
}

export interface VoiceModeDeps {
  organization: boolean;
  /** The person behind a request, or null for a caller who is not one (a local service). */
  speaker(auth: RequestAuth): VoiceSpeaker | null;
  /** The bot and thread the person talks to, or why not (404 hides a bot
   * they may not use, like every other bot route). */
  target(auth: RequestAuth, botId: string, threadId: string | undefined): VoiceTarget | { status: number; error: string };
  /** The organization's (or solo server's) xAI key: Settings > Models and voice. */
  serverKey(): string | undefined;
  /** The speaker's own keys listed in Perspicax (names only). */
  hasOwnKey(sub: string): boolean;
  /** Organization server, 2026-10-16: whether the organization's xAI key
   * may serve this speaker's voice (`sagax_server_engines`). Absent: yes. */
  serverKeyAllowed?(speaker: VoiceSpeaker): boolean;
  resolveOwnKey(sub: string): Promise<ProviderKeyResult>;
  /** An organization admin: their access card also names the organization's key. */
  isAdmin?(auth: RequestAuth): boolean;
  /** Where a person adds their own key in Perspicax. */
  keysUrl?(): string | undefined;
  xai: {
    listVoices(key: string): Promise<Voice[]>;
    synthesize(text: string, voice: string | undefined, key: string, options: { speed?: number; language?: string }): Promise<Audio>;
    transcribe(audio: Uint8Array, mime: string, key: string, language?: string, keyterms?: readonly string[], options?: { format?: boolean }): Promise<{ text: string }>;
    /** POST /v1/tts with raw PCM out, streamed as xAI produces it. */
    synthesizeStream?(text: string, voice: string | undefined, key: string, options: SynthesizeOptions, signal?: AbortSignal): Promise<{ body: ReadableStream<Uint8Array>; sampleRate: number }>;
    /** wss://api.x.ai/v1/tts: streaming text to speech for one call. */
    openSpeech?(key: string, options: { voice?: string; speed?: number; language?: string }, handlers: SpeechStreamHandlers): SpeechStream;
    /** wss://api.x.ai/v1/stt: streaming speech to text for one call. */
    openTranscription?(key: string, options: { language?: string; endpointingMs?: number; keyterms?: readonly string[]; format?: boolean }, handlers: TranscriptionHandlers): TranscriptionStream;
    /** Open a pooled connection to xAI's speech endpoint at the start of a
     * call, so the first sentence of the first answer skips the TLS handshake. */
    warm?(key: string): void;
  };
  /** The upgraded socket of a WebSocket request (routes/desktop-viewer.ts
   * attach runs upgrades through the same authentication as HTTP). */
  upgrade?(req: IncomingMessage): { socket: Duplex; head: Buffer; release(): void } | undefined;
  utterances(text: string): string[];
  /** Words speech to text should expect on this call: names of the bot,
   * the person, the other bots, the thread's proper nouns
   * (server/voice-keyterms.ts). Never a secret. */
  keyterms?(target: VoiceTarget, speaker: VoiceSpeaker): string[];
  recordUsage(usage: VoiceUsage): void;
  /** Throws the spend-limit refusal (409 `spend_cap`) when the limit is reached. */
  assertWithinBudget?(): void;
  /** A line for the server log (a call's speech falling back to POST). */
  log?(line: string): void;
  /** The thread is on a live call (server/voice-call-session.ts): every
   * send to it while the call lasts is a call turn. */
  callSession?: {
    /** `heartbeat`: the page's "alive", which never reopens a call that ended */
    start(target: VoiceTarget, callId: string, language?: string, auth?: RequestAuth, heartbeat?: boolean): void;
    end(target: VoiceTarget, callId: string, auth?: RequestAuth): void;
  };
  now?: () => number;
}

/** The order above, for one person. Never returns a key to anyone but the caller of xAI. */
export async function resolveVoiceKey(deps: Pick<VoiceModeDeps, "organization" | "serverKey" | "hasOwnKey" | "resolveOwnKey" | "serverKeyAllowed">, speaker: VoiceSpeaker): Promise<VoiceKey> {
  const serverKey = deps.serverKey()?.trim();
  if (!deps.organization) return serverKey ? { ok: true, key: serverKey, via: "server" } : { ok: false, cause: "no_credentials" };
  if (speaker.disabled) return { ok: false, cause: "payer_disabled" };
  if (speaker.sub && deps.hasOwnKey(speaker.sub)) {
    const own = await deps.resolveOwnKey(speaker.sub);
    if (own.ok) return { ok: true, key: own.key, via: "speaker-key", payerPrincipalId: speaker.principalId };
    if (own.error === "user_inactive") return { ok: false, cause: "payer_disabled" };
    if (own.error !== "no_key") return { ok: false, cause: "perspicax_unreachable" };
  }
  if (!serverKey) return { ok: false, cause: "no_credentials" };
  // 2026-10-16 (JC): the organization's xAI key serves voice only for the
  // people it was given to (`sagax_server_engines` lists VOICE_SERVER_ENGINE).
  if (deps.serverKeyAllowed && !deps.serverKeyAllowed(speaker)) return { ok: false, cause: "server_engine_not_allowed" };
  return { ok: true, key: serverKey, via: "org-key" };
}

const REFUSAL_TEXT: Record<VoiceModeRefusalCause, string> = {
  no_credentials: "Voice mode needs an xAI key. Add one in Settings > Models and voice.",
  server_engine_not_allowed: "Your organization has not given you its xAI voice. Add your own xAI key, or ask an admin.",
  payer_disabled: "Your access is turned off in your organization.",
  perspicax_unreachable: "Perspicax could not be reached to read your xAI key. Try again in a moment.",
};

/** A refusal: an access card, never a key or a part of one. The card follows
 * the audience rule of every access card (engine-access.ts
 * accessCardAudience): it is about the person whose credentials the voice
 * needed, the speaker, and reaches only them. It is answered to their own
 * request, never stored in a thread nor sent as a live frame. */
function refusalBody(cause: VoiceModeRefusalCause, keysUrl: string | undefined, target: VoiceTarget, speaker: VoiceSpeaker, admin: boolean) {
  const access = { reason: "no_access", ownerPrincipalId: target.ownerPrincipalId ?? "", payerPrincipalId: speaker.principalId };
  const forThem = !speaker.principalId || accessCardVisibleTo({ kind: "access", access }, speaker.principalId);
  return {
    code: "voice_no_access",
    cause,
    error: REFUSAL_TEXT[cause],
    ...(forThem
      ? { card: { kind: "access" as const, cause, ...(speaker.principalId ? { payerPrincipalId: speaker.principalId } : {}), ...(admin ? { admin: true } : {}), ...(keysUrl ? { keysUrl } : {}) } }
      : {}),
  };
}

async function readRaw(req: IncomingMessage, limit: number): Promise<Buffer | null> {
  const declared = Number(req.headers["content-length"] ?? "");
  if (Number.isFinite(declared) && declared > limit) return null;
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    size += buffer.byteLength;
    if (size > limit) return null;
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

/** A RIFF/WAVE header, or an Ogg/WebM container: the formats the bar sends. */
export function audioMime(bytes: Uint8Array, declared: string): string | null {
  const type = declared.split(";")[0]!.trim().toLowerCase();
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  if (bytes.byteLength >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WAVE") return "audio/wav";
  if (bytes.byteLength >= 4 && ascii(0, 4) === "OggS" && (type === "audio/ogg" || type === "")) return "audio/ogg";
  if (bytes.byteLength >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return "audio/webm";
  return null;
}

/** A provider error, without any secret the request may have carried. */
function scrub(message: string, key: string): string {
  const out = key ? message.split(key).join("[redacted]") : message;
  return out.length > 300 ? `${out.slice(0, 300)}...` : out;
}

type Usage = (model: VoiceUsage["model"], input: number) => void;
type Json = (res: import("node:http").ServerResponse, status: number, body: unknown) => unknown;

/** What the listen socket says to the page (JSON text frames). */
export type { ListenFrame } from "./voice-listen-session.ts";
export { listenTranscriptFrame } from "./voice-listen-session.ts";

/** One xAI transcript as the listen socket hands it to the page: the words,
 * fillers included, xAI's confidence and Smart Turn's end of turn
 * confidence when it gives them. */

/** A same-origin, well formed WebSocket handshake: its key, or why not. */
function handshake(req: IncomingMessage): { key: string } | { status: number; error: string } {
  // a WebSocket is not bound by CORS: only this origin's own page may open one
  if (!isSameOrigin(req)) return { status: 403, error: "forbidden" };
  const wsKey = req.headers["sec-websocket-key"];
  if (req.headers.upgrade?.toLowerCase() !== "websocket" || req.headers["sec-websocket-version"] !== "13"
    || typeof wsKey !== "string" || !/^[A-Za-z0-9+/]{22}==$/.test(wsKey)) return { status: 400, error: "Invalid WebSocket handshake" };
  return { key: wsKey };
}

/** At most this many keyterms go back with a call's start (the same cap as
 * server/voice-keyterms.ts, and what SFSpeechRecognizer takes well). */
export const VOICE_CALL_KEYTERM_MAX = 100;

export function createVoiceModeRoutes(deps: VoiceModeDeps): RouteHandler {
  const now = deps.now ?? Date.now;

  /** GET /voice/speech: one live call's streaming voice
   * (voice-speech-session.ts). Opens xAI's speech socket first; when it is
   * not open within SPEECH_READY_MS the page gets a 502 and speaks over
   * POST /voice/stream. The key stays here. */
  async function speech(req: IncomingMessage, res: import("node:http").ServerResponse, url: URL, json: Json, key: string, usage: Usage): Promise<void> {
    const upgrade = deps.upgrade?.(req);
    if (!upgrade || !deps.xai.openSpeech) { json(res, 426, { error: "WebSocket upgrade required" }); return; }
    const shake = handshake(req);
    if ("status" in shake) { json(res, shake.status, { error: shake.error }); return; }
    const language = url.searchParams.get("language") ?? "auto";
    if (!isVoiceModeLanguage(language)) { json(res, 400, { error: "unknown language" }); return; }
    const voice = url.searchParams.get("voice") || undefined;
    if (voice !== undefined && !VOICE_ID.test(voice)) { json(res, 400, { error: "voice must be an xAI voice id" }); return; }
    const speed = Number(url.searchParams.get("speed") ?? "1");
    if (!Number.isFinite(speed) || speed < VOICE_MODE_MIN_SPEED || speed > VOICE_MODE_MAX_SPEED) {
      json(res, 400, { error: `speed must be between ${VOICE_MODE_MIN_SPEED} and ${VOICE_MODE_MAX_SPEED}` });
      return;
    }
    const openSpeech = deps.xai.openSpeech;
    let page: ReturnType<typeof webSocketSession> | null = null;
    const session = createSpeechSession({
      open: (handlers) => openSpeech(key, { voice, speed, language: ttsLanguage(language) }, handlers),
      speakable: (text) => {
        if (text.length > VOICE_MODE_MAX_TEXT * 4) return "";
        const joined = deps.utterances(text).join(" ").trim();
        const read = readForVoice(language, joined);
        return read.slice(0, VOICE_MODE_MAX_TEXT);
      },
      // words appended to an open utterance: their edges kept, read as
      // French or English when the utterance so far is (voice-reading.ts)
      speakableDelta: (text, before) => {
        const clean = speakableDelta(text);
        return clean ? readForVoice(language, clean, before) : clean;
      },
      usage: (characters) => usage("grok-tts", characters),
      sendText: (frame) => page?.sendText(JSON.stringify(frame)),
      sendBinary: (pcm) => page?.sendBinary(pcm),
      closePage: (code) => page?.close(code),
      log: (line) => (deps.log ?? console.warn)(line),
      sampleRate: VOICE_SPEECH_RATE,
    });
    const opened = await Promise.race([
      session.ready,
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), SPEECH_READY_MS).unref()),
    ]);
    const { socket } = upgrade;
    if (!opened || socket.destroyed) {
      session.close();
      if (!socket.destroyed) json(res, 502, { error: "Grok streaming speech is not reachable." });
      return;
    }
    upgrade.release();
    const head = upgrade.head;
    res.detachSocket(socket as import("node:net").Socket);
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${websocketAccept(shake.key)}\r\n\r\n`);
    page = webSocketSession(socket, {
      onBinary: () => page?.close(1003),
      onText: (text) => session.message(text),
      onClose: () => session.close(),
    });
    if (head.length) socket.unshift(head);
    page.sendText(JSON.stringify({ type: "ready", sampleRate: VOICE_SPEECH_RATE }));
  }

  /** GET /voice/listen: one live call's streaming speech to text. The page
   * sends 16 kHz 16-bit PCM frames while the person speaks (its own voice
   * activity detector decides when) and `{"type":"finalize"}` when they
   * stop; xAI's transcripts come back as they are made. The key stays here. */
  async function listen(req: IncomingMessage, res: import("node:http").ServerResponse, url: URL, json: Json, key: string, usage: Usage, keyterms: readonly string[]): Promise<void> {
    const upgrade = deps.upgrade?.(req);
    if (!upgrade || !deps.xai.openTranscription) { json(res, 426, { error: "WebSocket upgrade required" }); return; }
    const shake = handshake(req);
    if ("status" in shake) { json(res, shake.status, { error: shake.error }); return; }
    const wsKey = shake.key;
    const language = url.searchParams.get("language") ?? "auto";
    if (!isVoiceModeLanguage(language)) { json(res, 400, { error: "unknown language" }); return; }
    let session: ReturnType<typeof webSocketSession> | null = null;
    let heard = 0;
    let total = 0;
    const book = () => {
      if (heard > 0) usage("grok-stt", heard);
      heard = 0;
    };
    deps.xai.warm?.(key);
    let warmedAt = now();
    const openTranscription = deps.xai.openTranscription;
    // "auto" on a French computer is French with formatting (sttRequest)
    const stt = sttRequest(language, url.searchParams.get("locale") ?? undefined);
    // xAI's socket is reopened behind the page's when it drops, and rotated
    // before its session limit (voice-listen-session.ts)
    const ears = createListenSession({
      // the page's own detector ends turns (and sends finalize); xAI's
      // endpointing is only a backstop for a very long pause
      open: (handlers) => openTranscription(key, { ...stt, endpointingMs: 1500, keyterms }, handlers),
      sendText: (frame) => session?.sendText(JSON.stringify(frame)),
      closePage: (code) => session?.close(code),
      log: (line) => (deps.log ?? console.warn)(line),
      onUpstreamClosed: book,
      scrub: (message) => scrub(message, key),
      now,
    });
    const opened = await Promise.race([
      ears.ready,
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), LISTEN_READY_MS).unref()),
    ]);
    const { socket } = upgrade;
    if (!opened || socket.destroyed) {
      ears.close();
      if (!socket.destroyed) json(res, 502, { error: "Grok speech to text is not reachable. Try again." });
      return;
    }
    upgrade.release();
    const head = upgrade.head;
    res.detachSocket(socket as import("node:net").Socket);
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${websocketAccept(wsKey)}\r\n\r\n`);
    session = webSocketSession(socket, {
      onBinary: (data) => {
        total += data.byteLength;
        if (total > VOICE_LISTEN_MAX_BYTES) { session?.close(1009); return; }
        heard += data.byteLength;
        ears.audio(new Uint8Array(data));
      },
      onText: (text) => {
        let message: { type?: unknown } | null = null;
        try { message = JSON.parse(text) as { type?: unknown }; } catch { /* ignored */ }
        // The page's keepalive keeps a proxy from dropping the listen
        // socket. It is never forwarded to xAI.
        if (message?.type === "keepalive") return;
        if (message?.type === "finalize") {
          ears.finalize();
          book();
          // the answer's first sentence goes to xAI's speech a second or
          // two from now: have a connection open by then (a pooled one
          // idles out in a few seconds, and the person spoke longer)
          const at = now();
          if (at - warmedAt >= LISTEN_WARM_EVERY_MS) {
            warmedAt = at;
            deps.xai.warm?.(key);
          }
        }
      },
      onClose: () => { book(); ears.close(); },
    });
    if (head.length) socket.unshift(head);
    session.sendText(JSON.stringify({ type: "ready" }));
  }

  const hits = new Map<string, number[]>();
  const limited = (who: string): boolean => {
    const at = now();
    const recent = (hits.get(who) ?? []).filter((t) => at - t < VOICE_MODE_RATE.windowMs);
    if (recent.length >= VOICE_MODE_RATE.max) {
      hits.set(who, recent);
      return true;
    }
    recent.push(at);
    if (hits.size >= 10_000) hits.clear();
    hits.set(who, recent);
    return false;
  };

  return async ({ req, res, url, path, method, auth, json, readBody }) => {
    const match = ROUTE.exec(path);
    if (!match) return PASS;
    const [, botId, action] = match as unknown as [string, string, Action];
    res.setHeader("cache-control", "no-store");
    const expected = action === "status" || action === "voices" || action === "listen" || action === "speech" ? "GET" : "POST";
    if (method !== expected) return json(res, 405, { error: "method not allowed" });

    const speaker = deps.speaker(auth);
    if (!speaker || (deps.organization && !speaker.principalId)) return json(res, 403, { error: "sign in as a person first", code: "sign_in" });

    const jsonBody = action === "prepare" || action === "speak" || action === "stream" || action === "call";
    const body = jsonBody ? await readBody(req).catch(() => null) : null;
    if (jsonBody && (!body || typeof body !== "object")) return json(res, 400, { error: "a JSON body is required" });
    const rawThread = action === "transcribe" || action === "listen" || action === "speech" ? url.searchParams.get("threadId") ?? undefined : (body as Record<string, unknown> | null)?.threadId;
    if (rawThread !== undefined && rawThread !== null && (typeof rawThread !== "string" || !THREAD_ID.test(rawThread))) return json(res, 400, { error: "threadId must be a task id" });
    const target = deps.target(auth, botId, typeof rawThread === "string" ? rawThread : undefined);
    if ("status" in target) return json(res, target.status, { error: target.error });

    // the call's start and end need no key: they only say the thread is on a call
    if (action === "call") {
      const record = body as Record<string, unknown>;
      const callId = record.callId;
      const state = record.state;
      if (typeof callId !== "string" || !CALL_ID.test(callId)) return json(res, 400, { error: "callId must be a call id" });
      if (state !== "start" && state !== "alive" && state !== "end") return json(res, 400, { error: "state must be start, alive or end" });
      const language = record.language === undefined ? undefined : record.language;
      if (language !== undefined && !isVoiceModeLanguage(language)) return json(res, 400, { error: "unknown language" });
      if (!deps.callSession) return json(res, 404, { error: "call sessions are not available" });
      if (state === "end") deps.callSession.end(target, callId, auth);
      else deps.callSession.start(target, callId, language as string | undefined, auth, state === "alive");
      if (state !== "start") return json(res, 200, { ok: true });
      // the phone recognizes speech itself: the same words the server's
      // speech to text expects, for its own recognizer (target() already
      // checked this person may use this thread)
      let keyterms: string[] = [];
      try { keyterms = (deps.keyterms?.(target, speaker) ?? []).slice(0, VOICE_CALL_KEYTERM_MAX); } catch { keyterms = []; }
      return json(res, 200, { ok: true, keyterms });
    }

    const keysUrl = deps.keysUrl?.();
    const admin = deps.isAdmin?.(auth) === true;
    const resolved = await resolveVoiceKey(deps, speaker);
    if (action === "status") {
      const org = deps.organization ? { organization: true } : {};
      const status: VoiceModeStatus = resolved.ok
        ? { provider: "xai", available: true, ...org, via: resolved.via }
        : { provider: "xai", available: false, ...org, refusal: { cause: resolved.cause, ...(admin ? { admin: true } : {}), ...(keysUrl ? { keysUrl } : {}) } };
      return json(res, 200, status);
    }
    if (!resolved.ok) return json(res, 403, refusalBody(resolved.cause, keysUrl, target, speaker, admin));
    const who = speaker.principalId || "operator";

    if (action === "prepare") {
      const text = String((body as Record<string, unknown>).text ?? "");
      return json(res, 200, { ready: true, utterances: deps.utterances(text) });
    }
    if (limited(who)) return json(res, 429, { error: "Too many voice requests. Wait a moment." });
    // Voice costs money like a turn does: a reached spend limit stops it too.
    try {
      deps.assertWithinBudget?.();
    } catch (error) {
      return json(res, 409, { error: error instanceof Error ? error.message : String(error), code: "spend_cap" });
    }

    if (action === "voices") {
      try {
        return json(res, 200, { voices: await deps.xai.listVoices(resolved.key) });
      } catch (error) {
        return json(res, 502, { voices: [], error: scrub(error instanceof Error ? error.message : String(error), resolved.key) });
      }
    }

    const usage: Usage = (model, input) => deps.recordUsage({
      target, speaker, via: resolved.via, model, input,
      ...(resolved.payerPrincipalId ? { payerPrincipalId: resolved.payerPrincipalId } : {}),
    });

    const keyterms = (): string[] => {
      try { return deps.keyterms?.(target, speaker) ?? []; } catch { return []; }
    };
    if (action === "listen") return listen(req, res, url, json, resolved.key, usage, keyterms());
    if (action === "speech") return speech(req, res, url, json, resolved.key, usage);

    if (action === "speak" || action === "stream") {
      const record = body as Record<string, unknown>;
      const raw = String(record.text ?? "").trim();
      if (!raw) return json(res, 400, { error: "text required" });
      // a live call sends the bot's own sentence: made speakable here, like /prepare
      let text = action === "stream" ? deps.utterances(raw).join(" ").trim() : raw;
      if (action === "stream" && raw.length > VOICE_MODE_MAX_TEXT * 4) return json(res, 413, { error: `voice sentences are limited to ${VOICE_MODE_MAX_TEXT * 4} characters` });
      if (text.length > VOICE_MODE_MAX_TEXT) return json(res, 413, { error: `voice utterances are limited to ${VOICE_MODE_MAX_TEXT} characters` });
      const voice = record.voice === undefined || record.voice === "" ? undefined : record.voice;
      if (voice !== undefined && (typeof voice !== "string" || !VOICE_ID.test(voice))) return json(res, 400, { error: "voice must be an xAI voice id" });
      const speed = record.speed === undefined ? 1 : record.speed;
      if (typeof speed !== "number" || !Number.isFinite(speed) || speed < VOICE_MODE_MIN_SPEED || speed > VOICE_MODE_MAX_SPEED) {
        return json(res, 400, { error: `speed must be between ${VOICE_MODE_MIN_SPEED} and ${VOICE_MODE_MAX_SPEED}` });
      }
      const language = record.language === undefined ? "auto" : record.language;
      if (!isVoiceModeLanguage(language)) return json(res, 400, { error: "unknown language" });
      if (action === "stream") {
        text = readForVoice(language, text);
        if (text.length > VOICE_MODE_MAX_TEXT) return json(res, 413, { error: `voice utterances are limited to ${VOICE_MODE_MAX_TEXT} characters` });
      }
      if (action === "stream") {
        // nothing to say once made speakable (a code block, a link): silence
        if (!text) { res.writeHead(204, { "cache-control": "no-store" }); res.end(); return; }
        if (!deps.xai.synthesizeStream) return json(res, 404, { error: "streaming speech is not available" });
        const controller = new AbortController();
        res.once("close", () => controller.abort());
        let audio: { body: ReadableStream<Uint8Array>; sampleRate: number };
        try {
          audio = await deps.xai.synthesizeStream(text, voice as string | undefined, resolved.key, { speed, language: ttsLanguage(language) }, controller.signal);
        } catch (error) {
          return json(res, 502, { error: scrub(error instanceof Error ? error.message : String(error), resolved.key) });
        }
        usage("grok-tts", text.length);
        res.writeHead(200, { "content-type": "audio/pcm", "x-voice-sample-rate": String(audio.sampleRate), "cache-control": "no-store" });
        // flush every chunk at once: the first one is the first thing heard
        res.flushHeaders?.();
        try {
          for await (const chunk of audio.body as unknown as AsyncIterable<Uint8Array>) {
            if (res.destroyed) break;
            res.write(Buffer.from(chunk));
          }
        } catch {
          // the person interrupted (aborted), or xAI cut the stream: what was heard stays heard
        } finally {
          controller.abort();
          if (!res.destroyed) res.end();
        }
        return;
      }
      try {
        const audio = await deps.xai.synthesize(text, voice, resolved.key, { speed, language: ttsLanguage(language) });
        usage("grok-tts", text.length);
        res.writeHead(200, { "content-type": audio.mime, "content-length": String(audio.bytes.byteLength), "cache-control": "no-store" });
        res.end(Buffer.from(audio.bytes));
        return;
      } catch (error) {
        return json(res, 502, { error: scrub(error instanceof Error ? error.message : String(error), resolved.key) });
      }
    }

    // transcribe
    const language = url.searchParams.get("language") ?? "auto";
    if (!isVoiceModeLanguage(language)) return json(res, 400, { error: "unknown language" });
    const audio = await readRaw(req, VOICE_MODE_MAX_AUDIO_BYTES);
    if (!audio) return json(res, 413, { error: "the recording is too long" });
    if (!audio.byteLength) return json(res, 400, { error: "audio required" });
    const mime = audioMime(audio, String(req.headers["content-type"] ?? ""));
    if (!mime) return json(res, 415, { error: "send WAV, Ogg or WebM audio" });
    try {
      const stt = sttRequest(language, url.searchParams.get("locale") ?? undefined);
      const heard = await deps.xai.transcribe(new Uint8Array(audio), mime, resolved.key, stt.language, keyterms(), { format: stt.format });
      usage("grok-stt", audio.byteLength);
      // xAI keeps fillers (filler_words); whoever reads this text does not need them
      return json(res, 200, { text: stripFillers(heard.text) });
    } catch (error) {
      return json(res, 502, { error: scrub(error instanceof Error ? error.message : String(error), resolved.key) });
    }
  };
}
