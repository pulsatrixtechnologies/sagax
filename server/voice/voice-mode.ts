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
//   GET  /api/bots/<id>/voice/realtime    WebSocket (?voice=&language=&threadId=): a call, PCM16 24 kHz both ways,
//                                         at xAI's realtime voice (server/voice/realtime-call.ts)
//   POST /api/bots/<id>/voice/call        {threadId, callId, state: start|alive|end, language?}: the thread is on a call
//                                         {threadId, callId, state: heard, audio}: a call turn's audio stages (ms)
//   GET  /api/voice/status, GET /api/voice/voices, POST /api/voice/speak: the same for no bot (Settings > Voice)
//
// 2026-11-02 (the maintainer): a call is a realtime voice session, never text to
// speech: GET /voice/realtime bridges the page to xAI's Voice Agent API and
// the bot's work to its `work` function (server/voice/realtime-call.ts). The
// paragraphs below describe the older pipeline, kept for reading a message
// aloud and for clients that have not moved yet.
// A live call (src/lib/voice-mode/call.ts) uses the last two: the person's
// audio streams to xAI's streaming speech to text while they speak, and each
// sentence of the bot's answer is synthesized as soon as the bot has written
// it, its audio streamed back while xAI produces it. xAI is only ears and a
// voice here, never the one who answers: no route calls a chat, responses or
// realtime agent endpoint of xAI (server/voice/voice-mode.test.ts checks it).
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
//   organization server: the speaker's own xAI voice key saved in Sagax
//   (Settings > Models and voice > My voice keys, server/voice/person-voice-keys.ts,
//   2026-10-28), else their own xAI key in Perspicax, else the
//   organization's xAI key (Settings > Models and voice, xai.key), else
//   refused with an access card shown only to that person; a disabled
//   person is refused. Solo server: the server's xAI key. Since
//   2026-10-14 Grok voice and bots on Grok share that one key.
//   A key xAI refuses for credits or for itself gives way to the next one
//   at once (server/voice/voice-keys.ts), and every answer says which key served
//   or failed: its source and last four characters, never more.
// Every request names a bot the person may use (the visibility gate already
// hides the others) and, when given, a thread they may post to. Each speak
// and transcribe is recorded in the usage ledger with `access` (the via).
import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";

import {
  VOICE_MODE_MAX_AUDIO_BYTES,
  VOICE_MODE_MAX_SPEED,
  VOICE_MODE_MAX_TEXT,
  VOICE_MODE_MIN_SPEED,
  isVoiceModeLanguage,
  stripFillers,
  sttRequest,
  ttsLanguage,
  type VoiceKeyInfo,
  type VoiceKeyState,
  type VoiceModeRefusalCause,
  type VoiceModeStatus,
  type VoiceModeVia,
} from "../../shared/voice-mode.ts";
import { accessCardVisibleTo } from "../engines/engine-access.ts";
import { isSameOrigin } from "../auth/request-auth.ts";
import { websocketAccept } from "../streams/ws-bridge.ts";
import { webSocketSession } from "../streams/ws-session.ts";
import { readForVoice } from "../tts/voice-reading.ts";
import { speakableDelta } from "../tts/speech-text.ts";
import { createListenSession } from "./voice-listen-session.ts";
import { grokVoiceFailure, type GrokVoiceFailure, type SpeechStream, type SpeechStreamHandlers, type SynthesizeOptions, type TranscriptionHandlers, type TranscriptionStream } from "../tts/grok.ts";
import { createSpeechSession } from "./voice-speech-session.ts";
import { RealtimeCallBridge, REALTIME_SAMPLE_RATE, type RealtimeBot, type RealtimeHistoryLine, type RealtimeSocket, type RealtimeWorkResult } from "./realtime-call.ts";
import { firstAudioNotice, parseVoiceAudioTiming, providerFallbackNotice, streamedTranscriptNotice, uploadedTranscriptNotice, type VoiceAudioTiming } from "./voice-timing.ts";
import { openHttpSpeechStream } from "../tts/http-speech-stream.ts";
import {
  cleanSttChoice,
  cleanTtsChoice,
  decodeProviderVoices,
  cleanProviderVoices,
  effectiveVoiceChoice,
  isProviderVoiceId,
  providerOrder,
  VOICE_PROVIDER_LABELS,
  VOICE_STT_PROVIDERS,
  VOICE_TTS_PROVIDERS,
  type EffectiveVoiceChoice,
  type ProviderVoices,
  type VoiceProviderId,
  type VoiceSttProvider,
  type VoiceTtsProvider,
} from "../../shared/voice-providers.ts";
import { cleanVoiceModeSettings } from "../../shared/voice-mode.ts";
import {
  candidateProvider,
  describeVoiceKey,
  keyLast4,
  nextCandidateIndex,
  VoiceKeyFailure,
  VoiceKeyRefusals,
  VOICE_PROVIDER_REFUSAL_TTL_MS,
  voiceKeyFailureIsFinal,
  voiceKeyRef,
  withVoiceKeys,
  type VoiceKeyCandidate,
  type VoiceKeyRefusal,
  type VoiceKeys,
} from "./voice-keys.ts";
import type { ProviderKeyResult } from "../perspicax/perspicax-link.ts";
import type { RequestAuth } from "../auth/request-auth.ts";
import { PASS, type RouteHandler } from "../routes/table.ts";
import type { Audio, Voice } from "../tts/elevenlabs.ts";

const ROUTE = /^\/api\/bots\/([\w-]+)\/voice\/(status|voices|prepare|speak|transcribe|stream|listen|speech|call|realtime)$/;
type Action = "status" | "voices" | "prepare" | "speak" | "transcribe" | "stream" | "listen" | "speech" | "call" | "realtime";
/** The voice routes that are WebSockets: the server's upgrade gate
 * (createDesktopViewer acceptsUpgrade in server/index.ts) must let each one
 * through, or the upgrade is a bare 404 the page only sees as a dropped
 * socket (0.8.29: /voice/realtime was left out, every call "dropped"). */
export const VOICE_SOCKET_ACTIONS = ["listen", "speech", "realtime"] as const satisfies readonly Action[];
const VOICE_SOCKET_ROUTE = /^\/api\/bots\/[\w-]+\/voice\/(?:listen|speech|realtime)$/;
export function isVoiceSocketPath(path: string): boolean {
  return VOICE_SOCKET_ROUTE.test(path);
}
/** The same answers for no bot: GET /api/voice/status, GET /api/voice/voices, POST /api/voice/speak. */
const OWN_ROUTE = /^\/api\/voice\/(status|voices|speak)$/;
const LEGACY_ROUTE = /^\/api\/tts\/(prepare|voices|speak)$/;
const CALL_ID = /^[A-Za-z0-9_-]{8,80}$/;
/** A turn's end warms the connection to xAI's speech at most this often. */
export const LISTEN_WARM_EVERY_MS = 2_000;
/** The most audio one live call may stream (16 kHz 16-bit mono: 2 hours). */
export const VOICE_LISTEN_MAX_BYTES = 16_000 * 2 * 60 * 60 * 2;
const LISTEN_READY_MS = 8_000;
/** xAI's speech socket must open this soon, else the page speaks over POST. */
export const SPEECH_READY_MS = 1_500;
/** The realtime session must answer its configuration within this. */
export const REALTIME_READY_MS = 5_000;
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
  /** #2125: the bot's own voice chat speed and language (bot panel > Voice chat).
   * When set they win over what the device sends. */
  speed?: number;
  language?: string;
}

export type VoiceKey =
  | { ok: true; key: string; via: VoiceModeVia; payerPrincipalId?: string }
  | { ok: false; cause: VoiceModeRefusalCause };

export type VoiceUsageModel = "grok-realtime" | "grok-tts" | "grok-stt" | "openai-tts" | "openai-stt" | "elevenlabs-tts" | "fish-tts" | "system-tts" | "chatterbox-tts";

export interface VoiceUsage {
  target: VoiceTarget;
  speaker: VoiceSpeaker;
  via: VoiceModeVia;
  payerPrincipalId?: string;
  model: VoiceUsageModel;
  /** characters spoken, or bytes of audio heard */
  input: number;
  /** whose key paid (2026-10-29): xAI when absent */
  provider?: VoiceProviderId;
}

/** The ledger's model for one provider's speech or hearing. */
export function usageModel(provider: VoiceProviderId, role: "tts" | "stt"): VoiceUsageModel {
  if (provider === "openai") return role === "tts" ? "openai-tts" : "openai-stt";
  if (provider === "elevenlabs") return "elevenlabs-tts";
  if (provider === "fish" || provider === "system" || provider === "chatterbox") return `${provider}-tts`;
  return role === "tts" ? "grok-tts" : "grok-stt";
}

/** One provider's voice and ears (2026-10-29), the shape of `deps.xai`:
 * what it lacks it does not offer (ElevenLabs only speaks). Every method
 * takes the key the route picked and throws this side's own words, sorted
 * by grokVoiceFailure. */
export interface VoiceProviderAdapter {
  listVoices?(key: string): Promise<Voice[]>;
  synthesize?(text: string, voice: string | undefined, key: string, options: { speed?: number; language?: string }): Promise<Audio>;
  transcribe?(audio: Uint8Array, mime: string, key: string, language?: string, keyterms?: readonly string[], options?: { format?: boolean }): Promise<{ text: string }>;
  synthesizeStream?(text: string, voice: string | undefined, key: string, options: SynthesizeOptions, signal?: AbortSignal): Promise<{ body: ReadableStream<Uint8Array>; sampleRate: number }>;
  /** a provider's own streaming voice socket (xAI); without it a live
   * call's voice runs over synthesizeStream (tts/http-speech-stream.ts) */
  openSpeech?(key: string, options: { voice?: string; speed?: number; language?: string }, handlers: SpeechStreamHandlers): SpeechStream;
  openTranscription?(key: string, options: { language?: string; endpointingMs?: number; keyterms?: readonly string[]; format?: boolean }, handlers: TranscriptionHandlers): TranscriptionStream;
  /** a cheap check of the key, before a live call's voice says ready */
  verify?(key: string): Promise<void>;
  warm?(key: string): void;
}

export interface VoiceModeDeps {
  organization: boolean;
  /** The person behind a request, or null for a caller who is not one (a local service). */
  speaker(auth: RequestAuth): VoiceSpeaker | null;
  /** The bot and thread the person talks to, or why not (404 hides a bot
   * they may not use, like every other bot route). */
  target(auth: RequestAuth, botId: string, threadId: string | undefined): VoiceTarget | { status: number; error: string };
  /** The organization's (or solo server's) xAI key: Settings > Models and voice. */
  serverKey(): string | undefined | Promise<string | undefined>;
  /** The speaker's own keys listed in Perspicax (names only). */
  hasOwnKey(sub: string): boolean;
  /** Organization server: the speaker's own xAI voice key saved in Sagax
   * (My voice keys, server/voice/person-voice-keys.ts). It comes first: the
   * person added it for their voice. */
  personalKey?(speaker: VoiceSpeaker): string | undefined;
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
  /** OpenAI and ElevenLabs (2026-10-29): another voice, other ears. */
  openai?: VoiceProviderAdapter;
  elevenlabs?: VoiceProviderAdapter;
  fish?: VoiceProviderAdapter;
  system?: VoiceProviderAdapter;
  chatterbox?: VoiceProviderAdapter;
  /** The keys of OpenAI or ElevenLabs that may serve this person, in order
   * (their own voice key, their Perspicax key, the organization's or the
   * server's), each with its `provider`. Never a key to anyone but the
   * caller of the provider. */
  providerKeys?(provider: Exclude<VoiceTtsProvider, "xai">, speaker: VoiceSpeaker): Promise<VoiceKeyCandidate[]> | VoiceKeyCandidate[];
  /** The installed TTS choice for clients still using /api/tts/*. */
  legacyChoice?(speaker: VoiceSpeaker): { provider: VoiceTtsProvider; voice?: string };
  /** The person's synced voice preference (`omb.voiceMode.v1`): a client
   * that does not say which provider (the iPhone) gets the person's own
   * choice for this bot. */
  preference?(speaker: VoiceSpeaker): unknown;
  /** The upgraded socket of a WebSocket request (routes/desktop-viewer.ts
   * attach runs upgrades through the same authentication as HTTP). */
  upgrade?(req: IncomingMessage): { socket: Duplex; head: Buffer; release(): void } | undefined;
  utterances(text: string): string[];
  /** Words speech to text should expect on this call: names of the bot,
   * the person, the other bots, the thread's proper nouns
   * (server/voice/voice-keyterms.ts). Never a secret. */
  keyterms?(target: VoiceTarget, speaker: VoiceSpeaker): string[];
  recordUsage(usage: VoiceUsage): void;
  /** Throws the spend-limit refusal (409 `spend_cap`) when the limit is reached. */
  assertWithinBudget?(): void;
  /** A line for the server log (a call's speech falling back to POST). */
  log?(line: string): void;
  /** A timing note for the thread's Events lens (runtime.notice): how long
   * speech to text took, numbers only, never the words
   * (server/voice/voice-timing.ts). */
  notice?(threadId: string, message: string): void;
  /** A realtime call's link to the bot (server/voice/realtime-call-host.ts): its
   * name and recent lines for the voice, and its `work` and permission
   * answers as the person who speaks. Absent: no realtime calls. */
  realtime?: {
    openUpstream(key: string): RealtimeSocket;
    session(target: VoiceTarget, auth: RequestAuth, callId: string): {
      bot: RealtimeBot;
      history: RealtimeHistoryLine[];
      work(request: string, signal: AbortSignal): Promise<RealtimeWorkResult>;
      respond(requestId: string, behavior: "allow" | "deny"): Promise<boolean>;
    };
  };
  /** The thread is on a live call (server/voice/voice-call-session.ts): every
   * send to it while the call lasts is a call turn. */
  callSession?: {
    /** `heartbeat`: the page's "alive", which never reopens a call that ended */
    start(target: VoiceTarget, callId: string, language?: string, auth?: RequestAuth, heartbeat?: boolean): void;
    end(target: VoiceTarget, callId: string, auth?: RequestAuth): void;
    /** The page heard the first words of a call turn's answer: its audio
     * stages (numbers only) for the Events lens. */
    heard?(target: VoiceTarget, callId: string, audio: VoiceAudioTiming): void;
  };
  now?: () => number;
}

type KeyDeps = Pick<VoiceModeDeps, "organization" | "serverKey" | "hasOwnKey" | "resolveOwnKey" | "serverKeyAllowed" | "personalKey">;

/** Every key that may serve this person, in the order above (the person's
 * voice key, their Perspicax key, the organization's), or why none does.
 * Never returns a key to anyone but the caller of xAI. */
export async function resolveVoiceKeys(deps: KeyDeps, speaker: VoiceSpeaker): Promise<VoiceKeys> {
  const serverKey = (await deps.serverKey())?.trim();
  if (!deps.organization) return serverKey ? { ok: true, keys: [{ key: serverKey, via: "server", source: "server", last4: keyLast4(serverKey) }] } : { ok: false, cause: "no_credentials" };
  if (speaker.disabled) return { ok: false, cause: "payer_disabled" };
  const keys: VoiceKeyCandidate[] = [];
  // the person's own voice key (My voice keys): theirs, no grant needed
  const personal = speaker.principalId ? deps.personalKey?.(speaker)?.trim() : undefined;
  if (personal) keys.push({ key: personal, via: "speaker-key", source: "voice-key", last4: keyLast4(personal), payerPrincipalId: speaker.principalId });
  let perspicax: VoiceModeRefusalCause | null = null;
  if (speaker.sub && deps.hasOwnKey(speaker.sub)) {
    const own = await deps.resolveOwnKey(speaker.sub);
    if (own.ok) keys.push({ key: own.key, via: "speaker-key", source: "perspicax-key", last4: keyLast4(own.key), payerPrincipalId: speaker.principalId });
    else if (own.error === "user_inactive") return { ok: false, cause: "payer_disabled" };
    else if (own.error !== "no_key") perspicax = "perspicax_unreachable";
  }
  // 2026-10-16: the organization's xAI key serves voice only for the
  // people it was given to (`sagax_server_engines` lists VOICE_SERVER_ENGINE).
  const orgAllowed = !deps.serverKeyAllowed || deps.serverKeyAllowed(speaker);
  if (serverKey && orgAllowed) keys.push({ key: serverKey, via: "org-key", source: "org-key", last4: keyLast4(serverKey) });
  if (keys.length) return { ok: true, keys };
  // Perspicax could not say: their key there may well exist
  if (perspicax) return { ok: false, cause: perspicax };
  if (!serverKey) return { ok: false, cause: "no_credentials" };
  return { ok: false, cause: "server_engine_not_allowed" };
}

/** The first key of the order above, for one person (the meeting notetaker). */
export async function resolveVoiceKey(deps: KeyDeps, speaker: VoiceSpeaker): Promise<VoiceKey> {
  const resolved = await resolveVoiceKeys(deps, speaker);
  if (!resolved.ok) return resolved;
  const first = resolved.keys[0]!;
  return { ok: true, key: first.key, via: first.via, ...(first.payerPrincipalId ? { payerPrincipalId: first.payerPrincipalId } : {}) };
}

const REFUSAL_TEXT: Record<VoiceModeRefusalCause, string> = {
  no_credentials: "Voice mode needs an xAI or OpenAI key. Add one in Settings > Voice.",
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
/** The usage booker for the key a request ends up on. */
type UsageFor = (candidate: VoiceKeyCandidate) => Usage;
type Json = (res: import("node:http").ServerResponse, status: number, body: unknown) => unknown;

/** What the listen socket says to the page (JSON text frames). */
export type { ListenFrame } from "./voice-listen-session.ts";
export { listenTranscriptFrame } from "./voice-listen-session.ts";

/** One xAI transcript as the listen socket hands it to the page: the words,
 * fillers included, xAI's confidence and Smart Turn's end of turn
 * confidence when it gives them. */

/** What a provider failure says about the keys: the one it is about and
 * every one tried (a refusal each), so the page can name them. */
export interface VoiceProviderKeys {
  key: VoiceKeyInfo;
  tried?: VoiceKeyRefusal[];
}

/** xAI failed a voice request: the page gets the reason in this side's own
 * words and its kind (`failure`: key, quota, busy, down, voice, other), so
 * it can say what is wrong instead of "didn't come through", and which key
 * it was (source and last four, never more; `tried` lists every key that
 * was refused on the way). The server log keeps the line. */
export function providerFailureBody(message: string, keys?: VoiceProviderKeys): { error: string; code: "voice_provider"; failure: GrokVoiceFailure; key?: VoiceKeyInfo; tried?: VoiceKeyRefusal[] } {
  return {
    error: message,
    code: "voice_provider",
    failure: grokVoiceFailure(message),
    ...(keys ? { key: keys.key, ...(keys.tried && keys.tried.length > 1 ? { tried: keys.tried } : {}) } : {}),
  };
}

/** A key as the page sees it in a response header: `source:last4`. */
export function voiceKeyHeader(key: VoiceKeyInfo): string {
  return `${key.source}:${key.last4 ?? ""}`;
}

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
 * server/voice/voice-keyterms.ts, and what SFSpeechRecognizer takes well). */
export const VOICE_CALL_KEYTERM_MAX = 100;

export function createVoiceModeRoutes(deps: VoiceModeDeps): RouteHandler {
  const now = deps.now ?? Date.now;
  /** keys xAI refused lately, per person (server/voice/voice-keys.ts) */
  const refusals = new VoiceKeyRefusals({ now });

  /** The adapter of one provider, when this server has it. */
  const adapterOf = (provider: VoiceProviderId): VoiceProviderAdapter | undefined =>
    deps[provider];

  /** Fallen back to another provider: a line in the thread's Events lens,
   * at most once a minute per thread and switch (each sentence of a call
   * would say it again otherwise). Silent on the page. */
  const fallbackSaid = new Map<string, number>();
  const sayFallback = (threadId: string, role: "speech to text" | "voice", from: readonly VoiceKeyRefusal[], to: VoiceKeyCandidate) => {
    if (!from.length || !threadId) return;
    const at = now();
    const id = `${threadId}\u0000${role}\u0000${from.map((entry) => candidateProvider(entry)).join(",")}>${candidateProvider(to)}`;
    if (at - (fallbackSaid.get(id) ?? -Infinity) < 60_000) return;
    if (fallbackSaid.size >= 10_000) fallbackSaid.clear();
    fallbackSaid.set(id, at);
    const named = from.map((entry) => ({ provider: VOICE_PROVIDER_LABELS[candidateProvider(entry)], failure: entry.failure }));
    deps.notice?.(threadId, providerFallbackNotice(role, named, VOICE_PROVIDER_LABELS[candidateProvider(to)]));
  };

  /** A failed socket open as the page and the log get it. */
  function socketRefusal(what: "speech" | "listen", lastError: string | undefined, fallback: string, used: VoiceKeyCandidate, tried: VoiceKeyRefusal[]) {
    const message = lastError ?? fallback;
    (deps.log ?? console.warn)(`[voice-mode] ${VOICE_PROVIDER_LABELS[candidateProvider(used)]} ${what} socket failed (${describeVoiceKey(used)}): ${message}`);
    return providerFailureBody(message, { key: voiceKeyRef(used), tried: [...tried, { ...voiceKeyRef(used), failure: grokVoiceFailure(message) }] });
  }

  /** GET /voice/speech: one live call's streaming voice
   * (voice-speech-session.ts). Opens the provider's speech first (xAI's
   * socket; OpenAI and ElevenLabs speak over HTTP behind the same session,
   * tts/http-speech-stream.ts); when it is not open within SPEECH_READY_MS
   * the page gets a 502 and speaks over POST /voice/stream. A key refused
   * for credits or for itself gives way to the next one before that, and a
   * provider that fails to another provider. The keys stay here. */
  async function speech(req: IncomingMessage, res: import("node:http").ServerResponse, url: URL, json: Json, keys: VoiceKeyCandidate[], refusals: VoiceKeyRefusals, who: string, usageFor: UsageFor, voiceFor: (provider: VoiceProviderId) => string | undefined, threadId: string, botVoice: { speed?: number; language?: string } = {}): Promise<void> {
    const upgrade = deps.upgrade?.(req);
    const speaks = (candidate: VoiceKeyCandidate) => {
      const adapter = adapterOf(candidateProvider(candidate));
      return Boolean(adapter?.openSpeech || adapter?.synthesizeStream);
    };
    const usable = keys.filter(speaks);
    if (!upgrade || !usable.length) { json(res, 426, { error: "WebSocket upgrade required" }); return; }
    const shake = handshake(req);
    if ("status" in shake) { json(res, shake.status, { error: shake.error }); return; }
    const language = botVoice.language ?? url.searchParams.get("language") ?? "auto";
    if (!isVoiceModeLanguage(language)) { json(res, 400, { error: "unknown language" }); return; }
    const speed = botVoice.speed ?? Number(url.searchParams.get("speed") ?? "1");
    if (!Number.isFinite(speed) || speed < VOICE_MODE_MIN_SPEED || speed > VOICE_MODE_MAX_SPEED) {
      json(res, 400, { error: `speed must be between ${VOICE_MODE_MIN_SPEED} and ${VOICE_MODE_MAX_SPEED}` });
      return;
    }
    let page: ReturnType<typeof webSocketSession> | null = null;
    const { socket } = upgrade;
    const tried: VoiceKeyRefusal[] = [];
    const fellBack: VoiceKeyRefusal[] = [];
    const ordered = refusals.order(who, usable).map((entry) => entry.candidate);
    for (let i = 0; i >= 0 && i < ordered.length;) {
      const candidate = ordered[i]!;
      const provider = candidateProvider(candidate);
      const adapter = adapterOf(provider)!;
      const voice = voiceFor(provider);
      const options = { voice, speed, language: ttsLanguage(language) };
      const usage = usageFor(candidate);
      const session = createSpeechSession({
        open: (handlers) => adapter.openSpeech
          ? adapter.openSpeech(candidate.key, options, handlers)
          : openHttpSpeechStream({
            synthesize: (text, signal) => adapter.synthesizeStream!(text, voice, candidate.key, { speed, language: options.language }, signal),
            ...(adapter.verify ? { verify: () => adapter.verify!(candidate.key) } : {}),
          }, handlers),
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
        usage: (characters) => usage(usageModel(provider, "tts"), characters),
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
      if (!opened || socket.destroyed) {
        session.close();
        if (socket.destroyed) return;
        const message = scrub(session.lastError ?? "", candidate.key);
        const failure = grokVoiceFailure(message || "not reachable");
        const next = session.lastError ? nextCandidateIndex(ordered, i, failure) : -1;
        if (session.lastError && voiceKeyFailureIsFinal(failure)) refusals.remember(who, voiceKeyRef(candidate), failure);
        else if (next >= 0) refusals.remember(who, voiceKeyRef(candidate), failure, VOICE_PROVIDER_REFUSAL_TTL_MS);
        if (next >= 0) {
          const refusal = { ...voiceKeyRef(candidate), failure };
          if (candidateProvider(ordered[next]!) === provider) tried.push(refusal);
          else fellBack.push(refusal);
          (deps.log ?? console.warn)(`[voice-mode] ${VOICE_PROVIDER_LABELS[provider]} speech refused the ${describeVoiceKey(candidate)} (${failure}): trying the ${describeVoiceKey(ordered[next]!)}`);
          i = next;
          continue;
        }
        json(res, 502, socketRefusal("speech", session.lastError ? message : undefined, `${VOICE_PROVIDER_LABELS[provider]} streaming speech is not reachable.`, candidate, tried));
        return;
      }
      refusals.forget(who, voiceKeyRef(candidate));
      sayFallback(threadId, "voice", fellBack, candidate);
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
      const sameProvider = tried.filter((entry) => candidateProvider(entry) === provider);
      page.sendText(JSON.stringify({ type: "ready", sampleRate: VOICE_SPEECH_RATE, key: voiceKeyRef(candidate), ...(sameProvider.length ? { skipped: sameProvider } : {}) }));
      return;
    }
    json(res, 502, { error: "no voice key" });
  }

  /** GET /voice/realtime: one call as a realtime voice session
   * (server/voice/realtime-call.ts). The page sends PCM16 at 24 kHz and JSON
   * (interrupt, ping, hangup); it gets the voice's PCM16 and the call's
   * state. The socket is accepted first, so a refusal reaches the page in
   * words ({"type":"refused","code"}): a browser never reads the body of a
   * refused upgrade. A key refused for itself gives way to the next xAI
   * key. Never text to speech: no realtime voice, no call. */
  async function realtime(req: IncomingMessage, res: import("node:http").ServerResponse, url: URL, json: Json, keys: VoiceKeyCandidate[], refusals: VoiceKeyRefusals, who: string, usageFor: UsageFor, target: VoiceTarget, auth: RequestAuth, blocked?: string): Promise<void> {
    const upgrade = deps.upgrade?.(req);
    if (!upgrade) { json(res, 426, { error: "WebSocket upgrade required" }); return; }
    const shake = handshake(req);
    if ("status" in shake) { json(res, shake.status, { error: shake.error }); return; }
    const language = url.searchParams.get("language") ?? "auto";
    if (!isVoiceModeLanguage(language)) { json(res, 400, { error: "unknown language" }); return; }
    const voice = url.searchParams.get("voice") ?? undefined;
    const { socket } = upgrade;
    upgrade.release();
    const head = upgrade.head;
    res.detachSocket(socket as import("node:net").Socket);
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${websocketAccept(shake.key)}\r\n\r\n`);
    let bridge: RealtimeCallBridge | null = null;
    let gone = false;
    const page = webSocketSession(socket, {
      onBinary: (data) => bridge?.audio(new Uint8Array(data)),
      onText: (text) => bridge?.pageMessage(text),
      onClose: () => { gone = true; bridge?.end("page"); },
    });
    if (head.length) socket.unshift(head);
    const refuse = (code: string, message: string, extra: Record<string, unknown> = {}) => {
      page.sendText(JSON.stringify({ type: "refused", code, error: message, ...extra }));
      page.close(4000);
    };
    if (!deps.realtime) return refuse("realtime_unavailable", "Realtime calls are not available on this server.");
    if (blocked) return refuse("spend_cap", blocked);
    if (!keys.length) return refuse("realtime_not_configured", "No realtime voice is set up for you. Add an xAI key in Settings > Voice.");
    const callId = randomUUID();
    const link = deps.realtime.session(target, auth, callId);
    const tried: VoiceKeyRefusal[] = [];
    const ordered = refusals.order(who, keys).map((entry) => entry.candidate);
    for (const candidate of ordered) {
      const early: Array<Record<string, unknown>> = [];
      let live = false;
      const usage = usageFor(candidate);
      const attempt = new RealtimeCallBridge({
        callId,
        openUpstream: () => deps.realtime!.openUpstream(candidate.key),
        sendText: (frame) => (live ? page.sendText(JSON.stringify(frame)) : early.push(frame)),
        sendBinary: (pcm) => { if (live) page.sendBinary(pcm); },
        closePage: (code) => { if (live) page.close(code); },
        work: link.work,
        respond: link.respond,
        bot: link.bot,
        history: link.history,
        ...(voice ? { voice } : {}),
        language,
        usage: (seconds) => usage("grok-realtime", Math.round(seconds.input + seconds.output)),
        log: (line) => (deps.log ?? console.warn)(line),
        now,
      });
      attempt.start();
      const opened = await Promise.race([
        attempt.ready,
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), REALTIME_READY_MS).unref()),
      ]);
      if (gone) { attempt.end("page"); return; }
      if (!opened) {
        attempt.end("upstream");
        const message = scrub(attempt.lastError ?? "not reachable", candidate.key);
        const failure = grokVoiceFailure(message);
        tried.push({ ...voiceKeyRef(candidate), failure });
        if (voiceKeyFailureIsFinal(failure)) refusals.remember(who, voiceKeyRef(candidate), failure);
        (deps.log ?? console.warn)(`[voice-realtime] xAI realtime refused the ${describeVoiceKey(candidate)} (${failure})`);
        continue;
      }
      refusals.forget(who, voiceKeyRef(candidate));
      bridge = attempt;
      live = true;
      page.sendText(JSON.stringify({ type: "ready", sampleRate: REALTIME_SAMPLE_RATE, callId, key: voiceKeyRef(candidate), ...(tried.length ? { skipped: tried } : {}) }));
      for (const frame of early.splice(0)) page.sendText(JSON.stringify(frame));
      return;
    }
    // every key refused for itself: say which to fix, never fall back to text to speech
    const keyRefused = tried.length > 0 && tried.every((entry) => entry.failure === "key" || entry.failure === "quota");
    refuse(keyRefused ? "realtime_key_refused" : "realtime_unreachable",
      keyRefused ? "The realtime voice key was refused. Fix it in Settings > Voice." : "The realtime voice is not reachable. Try the call again.",
      { tried });
  }

  /** GET /voice/listen: one live call's streaming speech to text. The page
   * sends 16 kHz 16-bit PCM frames while the person speaks (its own voice
   * activity detector decides when) and `{"type":"finalize"}` when they
   * stop; the provider's transcripts come back as they are made. A key
   * refused for credits or for itself gives way to the next one, a
   * provider that fails to another provider. The keys stay here. */
  async function listen(req: IncomingMessage, res: import("node:http").ServerResponse, url: URL, json: Json, keys: VoiceKeyCandidate[], refusals: VoiceKeyRefusals, who: string, usageFor: UsageFor, keyterms: readonly string[], threadId: string): Promise<void> {
    const upgrade = deps.upgrade?.(req);
    const usable = keys.filter((candidate) => Boolean(adapterOf(candidateProvider(candidate))?.openTranscription));
    if (!upgrade || !usable.length) { json(res, 426, { error: "WebSocket upgrade required" }); return; }
    const shake = handshake(req);
    if ("status" in shake) { json(res, shake.status, { error: shake.error }); return; }
    const wsKey = shake.key;
    const language = url.searchParams.get("language") ?? "auto";
    if (!isVoiceModeLanguage(language)) { json(res, 400, { error: "unknown language" }); return; }
    let session: ReturnType<typeof webSocketSession> | null = null;
    let heard = 0;
    let total = 0;
    /** when the page last said the person stopped (finalize) */
    let finalizedAt: number | null = null;
    // "auto" on a French computer is French with formatting (sttRequest)
    const stt = sttRequest(language, url.searchParams.get("locale") ?? undefined);
    const { socket } = upgrade;
    const tried: VoiceKeyRefusal[] = [];
    const fellBack: VoiceKeyRefusal[] = [];
    const ordered = refusals.order(who, usable).map((entry) => entry.candidate);
    for (let i = 0; i >= 0 && i < ordered.length;) {
      const candidate = ordered[i]!;
      const provider = candidateProvider(candidate);
      const adapter = adapterOf(provider)!;
      const openTranscription = adapter.openTranscription!;
      const key = candidate.key;
      const usage = usageFor(candidate);
      const book = () => {
        if (heard > 0) usage(usageModel(provider, "stt"), heard);
        heard = 0;
      };
      adapter.warm?.(key);
      let warmedAt = now();
      // the provider's socket is reopened behind the page's when it drops,
      // and rotated before its session limit (voice-listen-session.ts)
      const ears = createListenSession({
        // the page's own detector ends turns (and sends finalize); the
        // provider's endpointing is only a backstop for a very long pause
        open: (handlers) => openTranscription(key, { ...stt, endpointingMs: 1500, keyterms }, handlers),
        sendText: (frame) => {
          // the end of speech (the page's finalize) to the final words:
          // the person's wait for their text, in the Events lens
          if (frame.type === "transcript" && frame.speechFinal && finalizedAt !== null) {
            const waited = now() - finalizedAt;
            finalizedAt = null;
            deps.notice?.(threadId, streamedTranscriptNotice(waited, VOICE_PROVIDER_LABELS[provider]));
          }
          session?.sendText(JSON.stringify(frame));
        },
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
      if (!opened || socket.destroyed) {
        ears.close();
        if (socket.destroyed) return;
        const failure = grokVoiceFailure(ears.lastError ?? "not reachable");
        const next = ears.lastError ? nextCandidateIndex(ordered, i, failure) : -1;
        if (ears.lastError && voiceKeyFailureIsFinal(failure)) refusals.remember(who, voiceKeyRef(candidate), failure);
        else if (next >= 0) refusals.remember(who, voiceKeyRef(candidate), failure, VOICE_PROVIDER_REFUSAL_TTL_MS);
        if (next >= 0) {
          const refusal = { ...voiceKeyRef(candidate), failure };
          if (candidateProvider(ordered[next]!) === provider) tried.push(refusal);
          else fellBack.push(refusal);
          (deps.log ?? console.warn)(`[voice-mode] ${VOICE_PROVIDER_LABELS[provider]} listen socket refused the ${describeVoiceKey(candidate)} (${failure}): trying the ${describeVoiceKey(ordered[next]!)}`);
          i = next;
          continue;
        }
        json(res, 502, socketRefusal("listen", ears.lastError, `${VOICE_PROVIDER_LABELS[provider]} speech to text is not reachable. Try again.`, candidate, tried));
        return;
      }
      refusals.forget(who, voiceKeyRef(candidate));
      sayFallback(threadId, "speech to text", fellBack, candidate);
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
          let message: { type?: unknown; requestId?: unknown } | null = null;
          try { message = JSON.parse(text) as { type?: unknown; requestId?: unknown }; } catch { /* ignored */ }
          // The page's keepalive keeps a proxy from dropping the listen
          // socket. It is never forwarded to the provider.
          if (message?.type === "keepalive") return;
          if (message?.type === "finalize") {
            finalizedAt = now();
            const requestId = typeof message.requestId === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(message.requestId) ? message.requestId : undefined;
            ears.finalize(requestId);
            book();
            // the answer's first sentence goes to the voice a second or
            // two from now: have a connection open by then (a pooled one
            // idles out in a few seconds, and the person spoke longer)
            const at = now();
            if (at - warmedAt >= LISTEN_WARM_EVERY_MS) {
              warmedAt = at;
              adapter.warm?.(key);
            }
          }
        },
        onClose: () => { book(); ears.close(); },
      });
      if (head.length) socket.unshift(head);
      const sameProvider = tried.filter((entry) => candidateProvider(entry) === provider);
      session.sendText(JSON.stringify({ type: "ready", key: voiceKeyRef(candidate), ...(sameProvider.length ? { skipped: sameProvider } : {}) }));
      return;
    }
    json(res, 502, { error: "no voice key" });
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
    // Settings > Voice (2026-10-29): the person's providers, a provider's
    // voices and "Test the voice", for no bot in particular
    const legacy = LEGACY_ROUTE.exec(path);
    const own = OWN_ROUTE.exec(path) ?? legacy;
    const match = own ? [path, "", own[1]] : ROUTE.exec(path);
    if (!match) return PASS;
    const [, botId, action] = match as unknown as [string, string, Action];
    res.setHeader("cache-control", "no-store");
    const expected = action === "status" || action === "voices" || action === "listen" || action === "speech" || action === "realtime" ? "GET" : "POST";
    if (method !== expected) return json(res, 405, { error: "method not allowed" });

    const speaker = deps.speaker(auth);
    if (!speaker || (deps.organization && !speaker.principalId)) return json(res, 403, { error: "sign in as a person first", code: "sign_in" });

    const jsonBody = action === "prepare" || action === "speak" || action === "stream" || action === "call";
    const body = jsonBody ? await readBody(req).catch(() => null) : null;
    if (jsonBody && (!body || typeof body !== "object")) return json(res, 400, { error: "a JSON body is required" });
    // The installed TTS choice remains the default for an older client,
    // while key resolution, fallback and synthesis use this one path.
    const preference = deps.preference?.(speaker);
    if (legacy && preference == null) {
      const installed = deps.legacyChoice?.(speaker);
      if (installed) {
        if (!url.searchParams.has("tts")) url.searchParams.set("tts", installed.provider);
        if (action === "voices" && !url.searchParams.has("provider")) url.searchParams.set("provider", installed.provider);
        if (body) {
          const record = body as Record<string, unknown>;
          record.tts ??= installed.provider;
          record.voice ??= record.voiceId ?? installed.voice;
        }
      }
    }
    const rawThread = action === "transcribe" || action === "listen" || action === "speech" || action === "realtime" ? url.searchParams.get("threadId") ?? undefined : (body as Record<string, unknown> | null)?.threadId;
    if (rawThread !== undefined && rawThread !== null && (typeof rawThread !== "string" || !THREAD_ID.test(rawThread))) return json(res, 400, { error: "threadId must be a task id" });
    const target: VoiceTarget | { status: number; error: string } = own
      ? { botId: "", botName: "", threadId: "" }
      : deps.target(auth, botId, typeof rawThread === "string" ? rawThread : undefined);
    if ("status" in target) return json(res, target.status, { error: target.error });

    // the call's start and end need no key: they only say the thread is on a call
    if (action === "call") {
      const record = body as Record<string, unknown>;
      const callId = record.callId;
      const state = record.state;
      if (typeof callId !== "string" || !CALL_ID.test(callId)) return json(res, 400, { error: "callId must be a call id" });
      if (state !== "start" && state !== "alive" && state !== "end" && state !== "heard") return json(res, 400, { error: "state must be start, alive, end or heard" });
      if (state === "heard") {
        const audio = parseVoiceAudioTiming(record.audio);
        if (!audio) return json(res, 400, { error: "audio must carry the stages in milliseconds" });
        deps.callSession?.heard?.(target, callId, audio);
        return json(res, 200, { ok: true });
      }
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
    const resolved = await resolveVoiceKeys(deps, speaker);
    const who = speaker.principalId || "operator";
    // every provider's keys for this person: xAI's in the order above, then
    // OpenAI's and ElevenLabs' (2026-10-29), none for a person turned off
    const byProvider = new Map<VoiceProviderId, VoiceKeyCandidate[]>();
    if (resolved.ok) byProvider.set("xai", resolved.keys);
    if (resolved.ok || resolved.cause !== "payer_disabled") {
      for (const provider of VOICE_TTS_PROVIDERS.filter((id): id is Exclude<VoiceTtsProvider, "xai"> => id !== "xai")) {
        if (!adapterOf(provider) || !deps.providerKeys) continue;
        let found: VoiceKeyCandidate[] = [];
        try { found = await deps.providerKeys(provider, speaker); } catch { found = []; }
        const tagged = found.filter((candidate) => candidate.key).map((candidate) => ({ ...candidate, provider }));
        if (tagged.length) byProvider.set(provider, tagged);
      }
    }
    const choice = requestedChoice(action, url, body as Record<string, unknown> | null, preference, target.botId);
    /** a role's keys, the chosen provider first, then the other providers */
    const roleKeys = <P extends VoiceProviderId>(role: "tts" | "stt", picked: "auto" | P, all: readonly P[]): VoiceKeyCandidate[] => {
      const serving = all.filter((provider) => {
        const adapter = adapterOf(provider);
        return (byProvider.get(provider)?.length ?? 0) > 0 && Boolean(role === "tts" ? adapter?.synthesize || adapter?.synthesizeStream : adapter?.transcribe || adapter?.openTranscription);
      });
      return providerOrder(picked, serving, all).flatMap((provider) => byProvider.get(provider) ?? []);
    };
    const ttsKeys = roleKeys("tts", choice.tts, VOICE_TTS_PROVIDERS);
    const sttKeys = roleKeys("stt", choice.stt, VOICE_STT_PROVIDERS);
    const voiceFor = (provider: VoiceProviderId): string | undefined => choice.voices[provider as VoiceTtsProvider] || undefined;
    const refusedCause: VoiceModeRefusalCause | null = ttsKeys.length && sttKeys.length
      ? null
      : resolved.ok ? "no_credentials" : resolved.cause === "payer_disabled" || (!ttsKeys.length && !sttKeys.length) ? resolved.cause : "no_credentials";
    if (action === "status") {
      const org = deps.organization ? { organization: true } : {};
      let status: VoiceModeStatus;
      if (!refusedCause) {
        const ordered = refusals.order(who, ttsKeys);
        const first = ordered[0]!.candidate;
        const keys: VoiceKeyState[] = ordered.map((entry) => ({ ...voiceKeyRef(entry.candidate), ...(entry.refused ? { refused: entry.refused } : {}) }));
        // a provider is offered while one of its keys is not refused for itself
        const offered = <P extends VoiceProviderId>(list: VoiceKeyCandidate[]): P[] => [...new Set(list
          .filter((candidate) => refusals.failure(who, voiceKeyRef(candidate)) !== "key")
          .map((candidate) => candidateProvider(candidate) as P))];
        const firstStt = refusals.order(who, sttKeys)[0]!.candidate;
        status = {
          provider: "xai", available: true, ...org, via: first.via, key: voiceKeyRef(first), keys,
          // a call is a realtime voice session (xAI's Voice Agent API)
          ...(deps.realtime && (byProvider.get("xai")?.length ?? 0) > 0 ? { realtime: true } : {}),
          providers: {
            tts: VOICE_TTS_PROVIDERS.filter((provider) => offered<VoiceTtsProvider>(ttsKeys).includes(provider)),
            stt: VOICE_STT_PROVIDERS.filter((provider) => offered<VoiceSttProvider>(sttKeys).includes(provider)),
          },
          tts: candidateProvider(first) as VoiceTtsProvider,
          stt: candidateProvider(firstStt) as VoiceSttProvider,
        };
      } else {
        status = { provider: "xai", available: false, ...org, refusal: { cause: refusedCause, ...(admin ? { admin: true } : {}), ...(keysUrl ? { keysUrl } : {}) } };
        // what the person could still pick (a voice without ears, say)
        if (ttsKeys.length || sttKeys.length) {
          status.providers = {
            tts: VOICE_TTS_PROVIDERS.filter((provider) => ttsKeys.some((candidate) => candidateProvider(candidate) === provider)),
            stt: VOICE_STT_PROVIDERS.filter((provider) => sttKeys.some((candidate) => candidateProvider(candidate) === provider)),
          };
        }
      }
      return json(res, 200, status);
    }
    if (action === "realtime") {
      let blocked: string | undefined;
      try { deps.assertWithinBudget?.(); } catch (error) { blocked = error instanceof Error ? error.message : String(error); }
      const usageFor: UsageFor = (candidate) => (model, input) => deps.recordUsage({
        target, speaker, via: candidate.via, model, input,
        ...(candidate.payerPrincipalId ? { payerPrincipalId: candidate.payerPrincipalId } : {}),
      });
      const xaiKeys = speaker.disabled ? [] : byProvider.get("xai") ?? [];
      return realtime(req, res, url, json, xaiKeys, refusals, who, usageFor, target, auth, blocked);
    }
    const roleOf = action === "transcribe" || action === "listen" ? "stt" : "tts";
    const keys = roleOf === "stt" ? sttKeys : ttsKeys;
    if (legacy && action === "prepare") {
      return json(res, 200, { ready: keys.length > 0 && !speaker.disabled, utterances: deps.utterances(String((body as Record<string, unknown>).text ?? "")) });
    }
    // a voice alone (read aloud, the voice test) needs no ears
    if (!keys.length || (refusedCause && (action === "listen" || action === "transcribe" || !ttsKeys.length))) {
      return json(res, 403, refusalBody(refusedCause ?? "no_credentials", keysUrl, target, speaker, admin));
    }
    /** a provider error without any of this person's keys */
    const allKeys = [...byProvider.values()].flat();
    const scrubAll = (message: string): string => allKeys.reduce((out, candidate) => scrub(out, candidate.key), message);
    /** the provider refused or failed this request on every key it could:
     * logged (the kind of key, never the key) and answered with its
     * reason, its kind and the key it is about. */
    const failed = (what: string, error: unknown) => {
      if (error instanceof VoiceKeyFailure) {
        (deps.log ?? console.warn)(`[voice-mode] ${VOICE_PROVIDER_LABELS[candidateProvider(error.used)]} ${what} failed (${error.used.via}, ${describeVoiceKey(error.used)}): ${error.message}`);
        return providerFailureBody(error.message, { key: voiceKeyRef(error.used), tried: error.tried });
      }
      const message = scrubAll(error instanceof Error ? error.message : String(error));
      (deps.log ?? console.warn)(`[voice-mode] ${VOICE_PROVIDER_LABELS[candidateProvider(keys[0]!)]} ${what} failed (${keys[0]!.via}): ${message}`);
      return providerFailureBody(message, { key: voiceKeyRef(keys[0]!) });
    };
    /** run `attempt` on the first key that takes it (server/voice/voice-keys.ts),
     * another provider taking over silently when one fails */
    const tryKeys = async <T,>(what: string, list: VoiceKeyCandidate[], attempt: (candidate: VoiceKeyCandidate) => Promise<T>) => {
      const out = await withVoiceKeys(who, list, refusals, attempt, { log: deps.log ?? console.warn, what, scrub: scrubAll });
      sayFallback(target.threadId, roleOf === "stt" ? "speech to text" : "voice", out.fellBack, out.used);
      return out;
    };
    /** which key answered, for the page: a header on an HTTP answer */
    const keyHeaders = (used: VoiceKeyCandidate, skipped: VoiceKeyRefusal[]): Record<string, string> => ({
      "x-voice-key": voiceKeyHeader(voiceKeyRef(used)),
      "x-voice-provider": candidateProvider(used),
      ...(skipped.length ? { "x-voice-key-skipped": skipped.map((entry) => `${voiceKeyHeader(entry)}:${entry.failure}`).join(",") } : {}),
    });

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
      // one provider's voices: the one asked, else the one the voice starts with
      const asked = url.searchParams.get("provider");
      const provider = (cleanTtsChoice(asked) && asked !== "auto" ? asked : candidateProvider(refusals.order(who, ttsKeys)[0]!.candidate)) as VoiceTtsProvider;
      const listing = adapterOf(provider)?.listVoices;
      const own = ttsKeys.filter((candidate) => candidateProvider(candidate) === provider);
      if (!listing || !own.length) return json(res, 404, { voices: [], provider, error: `No ${VOICE_PROVIDER_LABELS[provider]} key serves you.` });
      try {
        const { value, used, skipped } = await withVoiceKeys(who, own, refusals, (candidate) => listing(candidate.key), { log: deps.log ?? console.warn, what: "voices", scrub: scrubAll });
        for (const [name, value_] of Object.entries(keyHeaders(used, skipped))) res.setHeader(name, value_);
        return json(res, 200, { voices: value, provider, key: voiceKeyRef(used), ...(skipped.length ? { skipped } : {}) });
      } catch (error) {
        return json(res, 502, { voices: [], provider, ...failed("voices", error) });
      }
    }

    const usageFor: UsageFor = (candidate) => (model, input) => deps.recordUsage({
      target, speaker, via: candidate.via, model, input,
      ...(candidate.payerPrincipalId ? { payerPrincipalId: candidate.payerPrincipalId } : {}),
      ...(candidateProvider(candidate) !== "xai" ? { provider: candidateProvider(candidate) } : {}),
    });

    const keyterms = (): string[] => {
      try { return deps.keyterms?.(target, speaker) ?? []; } catch { return []; }
    };
    if (choice.badVoice && action !== "listen") return json(res, 400, { error: "voice must be a voice id" });
    if (action === "listen") return listen(req, res, url, json, sttKeys, refusals, who, usageFor, keyterms(), target.threadId);
    if (action === "speech") return speech(req, res, url, json, ttsKeys, refusals, who, usageFor, voiceFor, target.threadId, { speed: target.speed, language: target.language });

    if (action === "speak" || action === "stream") {
      const record = body as Record<string, unknown>;
      const raw = String(record.text ?? "").trim();
      if (!raw) return json(res, 400, { error: "text required" });
      // a live call sends the bot's own sentence: made speakable here, like /prepare
      let text = action === "stream" ? deps.utterances(raw).join(" ").trim() : raw;
      if (action === "stream" && raw.length > VOICE_MODE_MAX_TEXT * 4) return json(res, 413, { error: `voice sentences are limited to ${VOICE_MODE_MAX_TEXT * 4} characters` });
      if (text.length > VOICE_MODE_MAX_TEXT) return json(res, 413, { error: `voice utterances are limited to ${VOICE_MODE_MAX_TEXT} characters` });
      const speed = target.speed ?? (record.speed === undefined ? 1 : record.speed);
      if (typeof speed !== "number" || !Number.isFinite(speed) || speed < VOICE_MODE_MIN_SPEED || speed > VOICE_MODE_MAX_SPEED) {
        return json(res, 400, { error: `speed must be between ${VOICE_MODE_MIN_SPEED} and ${VOICE_MODE_MAX_SPEED}` });
      }
      const language = target.language ?? (record.language === undefined ? "auto" : record.language);
      if (!isVoiceModeLanguage(language)) return json(res, 400, { error: "unknown language" });
      if (action === "stream") {
        text = readForVoice(language, text);
        if (text.length > VOICE_MODE_MAX_TEXT) return json(res, 413, { error: `voice utterances are limited to ${VOICE_MODE_MAX_TEXT} characters` });
      }
      const options = { speed, language: ttsLanguage(language) };
      if (action === "stream") {
        // nothing to say once made speakable (a code block, a link): silence
        if (!text) { res.writeHead(204, { "cache-control": "no-store" }); res.end(); return; }
        const streaming = ttsKeys.filter((candidate) => Boolean(adapterOf(candidateProvider(candidate))?.synthesizeStream));
        if (!streaming.length) return json(res, 404, { error: "streaming speech is not available" });
        const controller = new AbortController();
        res.once("close", () => controller.abort());
        let audio: { body: ReadableStream<Uint8Array>; sampleRate: number };
        let used: VoiceKeyCandidate;
        let skipped: VoiceKeyRefusal[];
        const askedAt = now();
        try {
          ({ value: audio, used, skipped } = await tryKeys(action, streaming, (candidate) => {
            const provider = candidateProvider(candidate);
            return adapterOf(provider)!.synthesizeStream!(text, voiceFor(provider), candidate.key, options, controller.signal);
          }));
        } catch (error) {
          if (controller.signal.aborted) { if (!res.destroyed) res.end(); return; }
          return json(res, 502, failed(action, error));
        }
        const provider = candidateProvider(used);
        usageFor(used)(usageModel(provider, "tts"), text.length);
        res.writeHead(200, { "content-type": "audio/pcm", "x-voice-sample-rate": String(audio.sampleRate), "cache-control": "no-store", ...keyHeaders(used, skipped) });
        // flush every chunk at once: the first one is the first thing heard
        res.flushHeaders?.();
        let first = true;
        try {
          for await (const chunk of audio.body as unknown as AsyncIterable<Uint8Array>) {
            if (res.destroyed) break;
            if (first) {
              first = false;
              // xAI's own timing stays with the call turn's line; another
              // provider's first audio is said, so a slow one shows
              if (provider !== "xai") deps.notice?.(target.threadId, firstAudioNotice(now() - askedAt, VOICE_PROVIDER_LABELS[provider]));
            }
            res.write(Buffer.from(chunk));
          }
        } catch {
          // the person interrupted (aborted), or the provider cut the stream: what was heard stays heard
        } finally {
          controller.abort();
          if (!res.destroyed) res.end();
        }
        return;
      }
      const speaking = ttsKeys.filter((candidate) => Boolean(adapterOf(candidateProvider(candidate))?.synthesize));
      try {
        const { value: audio, used, skipped } = await tryKeys(action, speaking, (candidate) => {
          const provider = candidateProvider(candidate);
          return adapterOf(provider)!.synthesize!(text, voiceFor(provider), candidate.key, options);
        });
        usageFor(used)(usageModel(candidateProvider(used), "tts"), text.length);
        res.writeHead(200, { "content-type": audio.mime, "content-length": String(audio.bytes.byteLength), "cache-control": "no-store", ...keyHeaders(used, skipped) });
        res.end(Buffer.from(audio.bytes));
        return;
      } catch (error) {
        return json(res, 502, failed(action, error));
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
    const hearing = sttKeys.filter((candidate) => Boolean(adapterOf(candidateProvider(candidate))?.transcribe));
    if (!hearing.length) return json(res, 403, refusalBody("no_credentials", keysUrl, target, speaker, admin));
    try {
      const stt = sttRequest(language, url.searchParams.get("locale") ?? undefined);
      const terms = keyterms();
      const askedAt = now();
      const { value: heard, used, skipped } = await tryKeys(action, hearing, (candidate) => adapterOf(candidateProvider(candidate))!.transcribe!(new Uint8Array(audio), mime, candidate.key, stt.language, terms, { format: stt.format }));
      const provider = candidateProvider(used);
      deps.notice?.(target.threadId, uploadedTranscriptNotice({ bytes: audio.byteLength, mime, ms: now() - askedAt, provider: VOICE_PROVIDER_LABELS[provider] }));
      usageFor(used)(usageModel(provider, "stt"), audio.byteLength);
      for (const [name, value] of Object.entries(keyHeaders(used, skipped))) res.setHeader(name, value);
      // the provider keeps fillers (filler_words); whoever reads this text does not need them
      return json(res, 200, { text: stripFillers(heard.text), key: voiceKeyRef(used), ...(skipped.length ? { skipped } : {}) });
    } catch (error) {
      return json(res, 502, failed(action, error));
    }
  };
}

/** What one request asks for: the providers and the voices. A client that
 * names no provider (an older page, the iPhone) gets the person's synced
 * choice for this bot (`omb.voiceMode.v1`), so every device follows the
 * same setting. `voice` is the voice of the provider asked for (xAI's when
 * none is): an older page's xAI voice keeps working. */
export function requestedChoice(action: string, url: URL, body: Record<string, unknown> | null, preference: unknown, botId: string): EffectiveVoiceChoice & { badVoice?: true } {
  const query = action === "status" || action === "speech" || action === "listen" || action === "transcribe" || action === "voices";
  const read = (name: string): unknown => (query ? url.searchParams.get(name) ?? undefined : body?.[name]);
  const saved = effectiveVoiceChoice(preference === undefined || preference === null ? {} : cleanVoiceModeSettings(preference), botId || undefined);
  const tts = cleanTtsChoice(read("tts"));
  const stt = cleanSttChoice(read("stt"));
  const rawVoices = read("voices");
  const voices: ProviderVoices = {
    ...saved.voices,
    ...(typeof rawVoices === "string" ? decodeProviderVoices(rawVoices) : cleanProviderVoices(rawVoices)),
  };
  const voice = read("voice");
  let badVoice = false;
  if (voice !== undefined && voice !== null && voice !== "") {
    const provider = tts && tts !== "auto" ? tts : saved.tts !== "auto" ? saved.tts : "xai";
    if (typeof voice !== "string" || !isProviderVoiceId(provider, voice)) badVoice = true;
    else voices[provider] = voice;
  } else if (voice === "" && (!tts || tts === "auto" || tts === "xai")) {
    // "" is the provider's default voice (xAI's Not set)
    delete voices.xai;
  }
  return { tts: tts ?? saved.tts, stt: stt ?? saved.stt, voices, ...(badVoice ? { badVoice: true as const } : {}) };
}
