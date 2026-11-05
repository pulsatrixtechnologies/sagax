// The voice bar's calls to the server (server/voice/voice-mode.ts). Same origin,
// session cookie: the xAI key stays on the server and never reaches here.
import { useEffect, useState } from "react";

import type { VoiceKeyInfo, VoiceModeRefusalCause, VoiceModeSettings, VoiceModeStatus, VoiceProviderFailure } from "../../../shared/voice-mode";
import { encodeProviderVoices, isVoiceTtsProvider, VOICE_TTS_PROVIDERS, type VoiceProviderId, type VoiceTtsProvider, type VoiceTtsChoice, type VoiceSttChoice } from "../../../shared/voice-providers";
import { readVoiceModeSettings, voiceSettingsForBot } from "./settings";
import { readableError } from "../plain-error";

/** What a voice request says about who speaks (2026-10-29): the providers
 * this bot speaks and hears with for this person, and a voice for each.
 * The server falls back on the other providers by itself. */
function voiceBody(botId: string, settings: VoiceModeSettings): Record<string, unknown> {
  const view = voiceSettingsForBot(settings, botId);
  return {
    voice: view.voice, speed: view.speed, language: view.language,
    tts: view.tts,
    ...(Object.keys(view.voices).length ? { voices: view.voices } : {}),
  };
}

/** The same for a socket's query. */
function voiceQuery(botId: string, settings: VoiceModeSettings): Record<string, string> {
  const view = voiceSettingsForBot(settings, botId);
  const voices = encodeProviderVoices(view.voices);
  return {
    tts: view.tts,
    stt: view.stt,
    ...(voices ? { voices } : {}),
  };
}

export interface VoiceOption {
  id: string;
  label: string;
  description?: string;
  /** ElevenLabs: one of the person's own voices (cloned or designed) */
  own?: boolean;
}

/** A refusal shown as an access card in the bar, to this person only. */
export class VoiceModeRefused extends Error {
  readonly cause: VoiceModeRefusalCause;
  readonly keysUrl?: string;
  /** an organization admin: the card also names the organization's key */
  readonly admin: boolean;

  constructor(message: string, cause: VoiceModeRefusalCause, keysUrl?: string, admin = false) {
    super(message);
    this.cause = cause;
    this.keysUrl = keysUrl;
    this.admin = admin;
  }
}

/** Why xAI failed a voice request, as the server sorted it
 * (server/tts/grok.ts grokVoiceFailure): the key was rejected (`key`), no
 * credits (`quota`), rate limited (`busy`), unreachable or failing
 * (`down`), an unknown voice (`voice`), anything else (`other`). */
export type { VoiceProviderFailure };
const PROVIDER_FAILURES = new Set<VoiceProviderFailure>(["key", "quota", "busy", "down", "voice", "other"]);
const KEY_SOURCES = new Set<VoiceKeyInfo["source"]>(["voice-key", "perspicax-key", "org-key", "server"]);
const PROVIDERS = new Set<VoiceProviderId>(VOICE_TTS_PROVIDERS);

/** One key xAI refused on the way (server/voice/voice-keys.ts). */
export interface VoiceKeyRefusal extends VoiceKeyInfo {
  failure: VoiceProviderFailure;
}

function cleanKeyInfo(value: unknown): VoiceKeyInfo | undefined {
  const record = value as { source?: unknown; last4?: unknown; provider?: unknown } | null | undefined;
  if (!record || !KEY_SOURCES.has(record.source as VoiceKeyInfo["source"])) return undefined;
  const provider = PROVIDERS.has(record.provider as VoiceProviderId) && record.provider !== "xai" ? { provider: record.provider as VoiceProviderId } : {};
  return { source: record.source as VoiceKeyInfo["source"], last4: typeof record.last4 === "string" && /^[\w.-]{1,4}$/.test(record.last4) ? record.last4 : null, ...provider };
}

function cleanRefusals(value: unknown): VoiceKeyRefusal[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const key = cleanKeyInfo(entry);
    const failure = (entry as { failure?: unknown } | null)?.failure;
    return key && PROVIDER_FAILURES.has(failure as VoiceProviderFailure) ? [{ ...key, failure: failure as VoiceProviderFailure }] : [];
  });
}

/** xAI (through the server) failed this request; `failure` says how, `key`
 * which key it is about (its source and last four, never more), `tried`
 * every key refused on the way when more than one was. */
export class VoiceProviderError extends Error {
  readonly failure: VoiceProviderFailure;
  readonly status: number;
  readonly key?: VoiceKeyInfo;
  readonly tried?: VoiceKeyRefusal[];

  constructor(message: string, failure: VoiceProviderFailure, status: number, keys: { key?: VoiceKeyInfo; tried?: VoiceKeyRefusal[] } = {}) {
    super(message);
    this.failure = failure;
    this.status = status;
    if (keys.key) this.key = keys.key;
    if (keys.tried?.length) this.tried = keys.tried;
  }
}

/** The key a request ended up on, after the ones xAI refused: said once
 * to the person (LiveCall), so a voice that goes on over another key is
 * never a silent switch. */
export interface VoiceKeyEvent {
  used: VoiceKeyInfo;
  skipped: VoiceKeyRefusal[];
}

const keyListeners = new Set<(event: VoiceKeyEvent) => void>();

export function onVoiceKeyEvent(listener: (event: VoiceKeyEvent) => void): () => void {
  keyListeners.add(listener);
  return () => { keyListeners.delete(listener); };
}

function emitVoiceKey(event: VoiceKeyEvent): void {
  for (const listener of Array.from(keyListeners)) listener(event);
}

/** `source:last4` as the server writes a key in a header. */
export function parseVoiceKeyHeader(value: string | null): VoiceKeyInfo | undefined {
  if (!value) return undefined;
  const [source, last4 = ""] = value.split(":");
  return cleanKeyInfo({ source, last4: last4 || null });
}

/** The keys an HTTP answer names (`x-voice-key`, `x-voice-key-skipped`):
 * told to the listeners when a key was skipped. */
export function noteVoiceKeyHeaders(headers: Pick<Headers, "get">): VoiceKeyEvent | null {
  const parsed = parseVoiceKeyHeader(headers.get("x-voice-key"));
  if (!parsed) return null;
  const provider = headers.get("x-voice-provider");
  const used = PROVIDERS.has(provider as VoiceProviderId) && provider !== "xai" ? { ...parsed, provider: provider as VoiceProviderId } : parsed;
  const skipped = (headers.get("x-voice-key-skipped") ?? "").split(",").flatMap((entry) => {
    const parts = entry.split(":");
    const key = parts.length === 3 ? cleanKeyInfo({ source: parts[0], last4: parts[1] || null }) : undefined;
    return key && PROVIDER_FAILURES.has(parts[2] as VoiceProviderFailure) ? [{ ...key, failure: parts[2] as VoiceProviderFailure }] : [];
  });
  const event = { used, skipped };
  if (skipped.length) emitVoiceKey(event);
  return event;
}

/** The keys a socket's `ready` frame names. */
export function noteVoiceKeyFrame(frame: { key?: unknown; skipped?: unknown }): VoiceKeyEvent | null {
  const used = cleanKeyInfo(frame.key);
  if (!used) return null;
  const event = { used, skipped: cleanRefusals(frame.skipped) };
  if (event.skipped.length) emitVoiceKey(event);
  return event;
}

/** The kind of a voice error: a provider failure as the server sorted it,
 * this server's own rate limit or spend limit, a dropped connection or a
 * stall (`down`), or null (a refusal card, a cancellation, anything else). */
export function voiceFailureKind(error: unknown): VoiceProviderFailure | null {
  if (error instanceof VoiceProviderError) return error.failure;
  if (error instanceof VoiceModeRefused) return null;
  if (error instanceof DOMException && error.name === "AbortError") return null;
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (/the voice service stalled|did not answer|failed to fetch|network|load failed/i.test(message)) return "down";
  return null;
}

/** A failure the provider may not repeat a moment later: worth one more try. */
export function transientVoiceFailure(error: unknown): boolean {
  const kind = voiceFailureKind(error);
  return kind === "busy" || kind === "down";
}

const base = (botId: string) => `/api/bots/${encodeURIComponent(botId)}/voice`;

/** The provider this bot speaks with for this person, or undefined for Auto. */
function providerOf(botId: string): VoiceTtsProvider | undefined {
  const tts = voiceSettingsForBot(readVoiceModeSettings(), botId).tts;
  return isVoiceTtsProvider(tts) ? tts : undefined;
}

async function failure(res: Response): Promise<Error> {
  const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string; cause?: VoiceModeRefusalCause; failure?: string; key?: unknown; tried?: unknown; card?: { keysUrl?: string; admin?: boolean } };
  if (res.status === 403 && body.code === "voice_no_access" && body.cause) {
    return new VoiceModeRefused(body.error ?? "Voice mode is not available.", body.cause, body.card?.keysUrl, body.card?.admin === true);
  }
  if (body.code === "voice_provider") {
    const kind = PROVIDER_FAILURES.has(body.failure as VoiceProviderFailure) ? (body.failure as VoiceProviderFailure) : "other";
    const key = cleanKeyInfo(body.key);
    return new VoiceProviderError(body.error ?? `the voice service returned ${res.status}`, kind, res.status, { ...(key ? { key } : {}), tried: cleanRefusals(body.tried) });
  }
  // this server's own limits: too many requests (busy), the spend limit (quota)
  if (res.status === 429) return new VoiceProviderError(body.error ?? "Too many voice requests.", "busy", 429);
  if (res.status === 409 && body.code === "spend_cap") return new VoiceProviderError(body.error ?? "The spend limit is reached.", "quota", 409);
  // an older server: a 502 is xAI failing, a 5xx the server's own
  if (res.status >= 500) return new VoiceProviderError(body.error ?? `the voice service returned ${res.status}`, "down", res.status);
  return new Error(body.error ?? `the voice service returned ${res.status}`);
}

/** How long a sentence waits before its one retry after a transient failure. */
export const SPEECH_RETRY_MS = 400;

/** What the server answered about voice mode for this bot and person. */
export type VoiceModeCheck =
  | { state: "loading" }
  | { state: "ready"; status: VoiceModeStatus }
  /** no answer: `missing` is a server without voice mode (404) */
  | { state: "error"; error: string; missing: boolean };

/** Ask the server (GET /api/bots/<id>/voice/status). The server decides;
 * the client never guesses availability on its own. */
export async function checkVoiceMode(botId: string, signal?: AbortSignal): Promise<VoiceModeCheck> {
  try {
    const res = await fetch(`${base(botId)}/status`, { signal, cache: "no-store" });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      return { state: "error", error: readableError(body.error ?? `HTTP ${res.status}`), missing: res.status === 404 && !body.error };
    }
    const body = (await res.json()) as VoiceModeStatus;
    if (!body || body.provider !== "xai") return { state: "error", error: "unexpected answer", missing: false };
    return { state: "ready", status: body };
  } catch (error) {
    return { state: "error", error: readableError(error), missing: false };
  }
}

/** One provider's voices: the one this bot speaks with for this person
 * (`provider`, else the server's pick). */
export async function fetchVoiceModeVoices(botId: string, signal?: AbortSignal, provider: VoiceTtsProvider | undefined = providerOf(botId)): Promise<VoiceOption[]> {
  const res = await fetch(`${base(botId)}/voices${provider ? `?provider=${provider}` : ""}`, { signal });
  if (!res.ok) throw await failure(res);
  noteVoiceKeyHeaders(res.headers);
  const body = (await res.json()) as { voices?: VoiceOption[] };
  return Array.isArray(body.voices) ? body.voices.filter((voice) => typeof voice?.id === "string" && typeof voice?.label === "string") : [];
}

export async function prepareVoiceModeText(botId: string, text: string, signal?: AbortSignal): Promise<string[]> {
  const res = await fetch(`${base(botId)}/prepare`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
    signal,
  });
  if (!res.ok) throw await failure(res);
  const body = (await res.json()) as { utterances?: string[] };
  return body.utterances ?? [];
}

export async function speakVoiceMode(
  botId: string,
  text: string,
  settings: VoiceModeSettings,
  threadId?: string,
  signal?: AbortSignal,
): Promise<Blob> {
  const res = await fetch(`${base(botId)}/speak`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text, ...voiceBody(botId, settings), ...(threadId ? { threadId } : {}) }),
    signal,
  });
  if (!res.ok) throw await failure(res);
  noteVoiceKeyHeaders(res.headers);
  return res.blob();
}

/** A clause's POST with no first byte, or no next chunk, for this long has
 * stalled: it errors, so the player moves on and the call is never stuck. */
export const SPEECH_STALL_MS = 8_000;

/** One sentence of the bot's answer, spoken as xAI makes it
 * (POST /voice/stream): raw 16-bit PCM, its rate in `x-voice-sample-rate`.
 * null when there is nothing to say (204). Stalls (SPEECH_STALL_MS before
 * the answer or between two chunks) abort the request and error the body. */
export async function streamVoiceModeSpeech(
  botId: string,
  text: string,
  settings: VoiceModeSettings,
  threadId?: string,
  signal?: AbortSignal,
  stallMs = SPEECH_STALL_MS,
  retryMs = SPEECH_RETRY_MS,
): Promise<{ body: ReadableStream<Uint8Array>; sampleRate: number } | null> {
  // xAI busy or a dropped connection before any audio: one more try, so a
  // blip is never a sentence lost nor a "try again" for the person
  try {
    return await streamVoiceModeSpeechOnce(botId, text, settings, threadId, signal, stallMs);
  } catch (error) {
    if (signal?.aborted || !transientVoiceFailure(error)) throw error;
    await new Promise<void>((resolve) => setTimeout(resolve, retryMs));
    if (signal?.aborted) throw error;
    return streamVoiceModeSpeechOnce(botId, text, settings, threadId, signal, stallMs);
  }
}

async function streamVoiceModeSpeechOnce(
  botId: string,
  text: string,
  settings: VoiceModeSettings,
  threadId: string | undefined,
  signal: AbortSignal | undefined,
  stallMs: number,
): Promise<{ body: ReadableStream<Uint8Array>; sampleRate: number } | null> {
  const controller = new AbortController();
  const forward = () => controller.abort(signal?.reason);
  if (signal?.aborted) forward();
  else signal?.addEventListener("abort", forward, { once: true });
  const stalled = () => controller.abort(new Error("the voice service stalled"));
  const done = () => signal?.removeEventListener("abort", forward);
  const timer = setTimeout(stalled, stallMs);
  let res: Response;
  try {
    res = await fetch(`${base(botId)}/stream`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, ...voiceBody(botId, settings), ...(threadId ? { threadId } : {}) }),
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timer);
    done();
    throw controller.signal.aborted && !signal?.aborted ? new Error("the voice service stalled") : error;
  }
  clearTimeout(timer);
  if (res.status === 204 || !res.ok || !res.body) done();
  if (res.status === 204) return null;
  if (!res.ok) throw await failure(res);
  noteVoiceKeyHeaders(res.headers);
  if (!res.body) throw new Error("the voice service returned no audio");
  const reader = res.body.getReader();
  const body = new ReadableStream<Uint8Array>({
    async pull(out) {
      let wait: ReturnType<typeof setTimeout> | undefined;
      try {
        const next = await Promise.race([
          reader.read(),
          new Promise<never>((_, reject) => {
            wait = setTimeout(() => reject(new Error("the voice service stalled")), stallMs);
          }),
        ]);
        if (next.done) {
          done();
          out.close();
        } else out.enqueue(next.value);
      } catch (error) {
        stalled();
        done();
        void reader.cancel().catch(() => {});
        out.error(error);
      } finally {
        clearTimeout(wait);
      }
    },
    cancel(reason) {
      done();
      controller.abort(reason);
      return reader.cancel(reason).catch(() => {});
    },
  });
  return { body, sampleRate: Number(res.headers.get("x-voice-sample-rate")) || 24_000 };
}

/** Tell the server the thread is on a call (POST /voice/call): every send
 * to it while the call lasts is a call turn, whatever path it takes. Best
 * effort: an old server without the route still gets each turn's mark. */
export async function voiceCallSession(
  botId: string,
  state: "start" | "alive" | "end",
  call: { callId: string; threadId?: string; language?: string },
): Promise<boolean> {
  try {
    const res = await fetch(`${base(botId)}/call`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ state, callId: call.callId, ...(call.threadId ? { threadId: call.threadId } : {}), ...(call.language ? { language: call.language } : {}) }),
      keepalive: state === "end",
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** The first words of a call turn's answer were heard: its audio stages
 * (ms only, never the words) for the thread's Events lens. Best effort. */
export async function voiceCallHeard(
  botId: string,
  call: { callId: string; threadId?: string },
  audio: { firstSentenceMs?: number; ttsMs?: number; playbackMs?: number; totalMs?: number },
): Promise<void> {
  try {
    await fetch(`${base(botId)}/call`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ state: "heard", callId: call.callId, ...(call.threadId ? { threadId: call.threadId } : {}), audio }),
    });
  } catch {
    /* an old server or a lost network: the Events line is skipped */
  }
}

/** The live call's streaming speech to text socket (GET /voice/listen). */
/** The person's browser or app locale (fr-CA...), sent beside "auto" so the
 * server can ask xAI for French on a French computer (shared/voice-mode.ts
 * sttRequest, which validates it). */
export function voiceLocale(): string | undefined {
  try {
    return typeof navigator !== "undefined" && typeof navigator.language === "string" && navigator.language ? navigator.language : undefined;
  } catch {
    return undefined;
  }
}

function sttQuery(language: string, threadId: string | undefined, locale: string | undefined, botId?: string): URLSearchParams {
  const stt = voiceSettingsForBot(readVoiceModeSettings(), botId).stt;
  return new URLSearchParams({ language, ...(language === "auto" && locale ? { locale } : {}), ...(threadId ? { threadId } : {}), stt });
}

export function voiceModeListenUrl(botId: string, language: string, threadId?: string, origin = typeof location === "undefined" ? "http://localhost" : location.origin, locale = voiceLocale()): string {
  return `${origin.replace(/^http/, "ws")}${base(botId)}/listen?${sttQuery(language, threadId, locale, botId)}`;
}

/** A whole-turn upload that has not answered in this long is given up (the
 * transcriber tries once more, then tells the person). */
export const TRANSCRIBE_TIMEOUT_MS = 20_000;

export async function transcribeVoiceMode(
  botId: string,
  audio: Blob,
  language: string,
  threadId?: string,
  signal?: AbortSignal,
  timeoutMs = TRANSCRIBE_TIMEOUT_MS,
): Promise<string> {
  const query = sttQuery(language, threadId, voiceLocale(), botId);
  const controller = new AbortController();
  const forward = () => controller.abort(signal?.reason);
  if (signal?.aborted) forward();
  else signal?.addEventListener("abort", forward, { once: true });
  const timer = setTimeout(() => controller.abort(new Error("the voice service did not answer")), timeoutMs);
  try {
    const res = await fetch(`${base(botId)}/transcribe?${query}`, {
      method: "POST",
      headers: { "content-type": audio.type || "audio/wav" },
      body: audio,
      signal: controller.signal,
    });
    if (!res.ok) throw await failure(res);
    noteVoiceKeyHeaders(res.headers);
    const body = (await res.json()) as { text?: string };
    return typeof body.text === "string" ? body.text : "";
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", forward);
  }
}

// One answer per bot, shared by the call button and the call itself. A
// "ready" answer is kept a minute; a refusal or an error is asked again at
// the next click (refreshVoiceMode), so a key added meanwhile works at once.
const checks = new Map<string, { at: number; check: VoiceModeCheck; pending?: Promise<VoiceModeCheck> }>();
const checkWatchers = new Set<() => void>();
const READY_TTL_MS = 60_000;

function notifyChecks() {
  for (const fn of Array.from(checkWatchers)) fn();
}

/** Ask the server again for this bot (a click on an unavailable call button). */
export function refreshVoiceMode(botId: string, run: typeof checkVoiceMode = checkVoiceMode): Promise<VoiceModeCheck> {
  const current = checks.get(botId);
  if (current?.pending) return current.pending;
  const pending = run(botId).then((check) => {
    checks.set(botId, { at: Date.now(), check });
    notifyChecks();
    return check;
  });
  checks.set(botId, { at: current?.at ?? 0, check: current?.check ?? { state: "loading" }, pending });
  if (!current) notifyChecks();
  return pending;
}

export function voiceModeCheckNow(botId: string): VoiceModeCheck {
  return checks.get(botId)?.check ?? { state: "loading" };
}

/** The server's answer for this bot, asked when first needed. */
export function useVoiceModeCheck(botId: string): VoiceModeCheck {
  const [, setTick] = useState(0);
  useEffect(() => {
    const watcher = () => setTick((tick) => tick + 1);
    checkWatchers.add(watcher);
    const entry = checks.get(botId);
    const stale = !entry || (!entry.pending && (entry.check.state !== "ready" || Date.now() - entry.at > READY_TTL_MS));
    if (stale && botId && typeof fetch === "function") void refreshVoiceMode(botId);
    return () => {
      checkWatchers.delete(watcher);
    };
  }, [botId]);
  return voiceModeCheckNow(botId);
}

/** Which of these bots voice mode serves now (each asked when first needed): the desktop mascots' call buttons. */
export function useVoiceModeAvailable(botIds: string[]): Record<string, boolean> {
  const [, setTick] = useState(0);
  const key = botIds.join("|");
  useEffect(() => {
    const watcher = () => setTick((tick) => tick + 1);
    checkWatchers.add(watcher);
    for (const botId of key ? key.split("|") : []) {
      const entry = checks.get(botId);
      const stale = !entry || (!entry.pending && (entry.check.state !== "ready" || Date.now() - entry.at > READY_TTL_MS));
      if (stale && typeof fetch === "function") void refreshVoiceMode(botId);
    }
    return () => {
      checkWatchers.delete(watcher);
    };
  }, [key]);
  return Object.fromEntries(botIds.map((botId) => {
    const check = voiceModeCheckNow(botId);
    return [botId, check.state === "ready" && check.status.available === true];
  }));
}

/** The status alone (null while unknown or unanswered). */
export function useVoiceModeStatus(botId: string): VoiceModeStatus | null {
  const check = useVoiceModeCheck(botId);
  return check.state === "ready" ? check.status : null;
}

/** For tests and after a key change. */
export function forgetVoiceModeStatus(): void {
  checks.clear();
  notifyChecks();
}

/** The live call's streaming voice socket (GET /voice/speech): the voice,
 * speed and language are fixed for the socket. */
export function voiceModeSpeechUrl(botId: string, settings: VoiceModeSettings, threadId?: string, origin = typeof location === "undefined" ? "http://localhost" : location.origin): string {
  const view = voiceSettingsForBot(settings, botId);
  const query = new URLSearchParams({ language: view.language, speed: String(view.speed), ...(view.voice ? { voice: view.voice } : {}), ...(threadId ? { threadId } : {}), ...voiceQuery(botId, view) });
  return `${origin.replace(/^http/, "ws")}${base(botId)}/speech?${query}`;
}

/** A call's realtime voice socket (GET /voice/realtime, server/voice/realtime-call.ts). */
export function voiceModeRealtimeUrl(botId: string, settings: VoiceModeSettings, threadId?: string, origin = typeof location === "undefined" ? "http://localhost" : location.origin): string {
  const view = voiceSettingsForBot(settings, botId);
  const query = new URLSearchParams({ language: view.language, ...(view.voice ? { voice: view.voice } : {}), ...(threadId ? { threadId } : {}) });
  return `${origin.replace(/^http/, "ws")}${base(botId)}/realtime?${query}`;
}

/** A call needs the realtime voice (the maintainer, 2026-11-02): never text to speech. */
export function realtimeCallReady(status: VoiceModeStatus | null | undefined): boolean {
  return status?.available === true && status.realtime === true;
}

/** The person's providers for this bot, or for no bot (Settings > Voice):
 * GET /api/bots/<id>/voice/status or GET /api/voice/status. */
export async function fetchVoiceProviders(botId?: string, signal?: AbortSignal, choice?: { tts: VoiceTtsChoice; stt: VoiceSttChoice }): Promise<VoiceModeStatus> {
  // Include Auto explicitly: the synced server preference may still hold
  // the provider the person just replaced in this window.
  const query = choice ? `?${new URLSearchParams(choice)}` : "";
  const res = await fetch(`${botId ? `${base(botId)}/status` : "/api/voice/status"}${query}`, { signal, cache: "no-store" });
  if (!res.ok) throw await failure(res);
  return (await res.json()) as VoiceModeStatus;
}

/** One provider's voices, for a bot or for no bot. */
export async function fetchProviderVoices(provider: VoiceTtsProvider, botId?: string, signal?: AbortSignal): Promise<VoiceOption[]> {
  if (botId) return fetchVoiceModeVoices(botId, signal, provider);
  const res = await fetch(`/api/voice/voices?provider=${provider}`, { signal });
  if (!res.ok) throw await failure(res);
  const body = (await res.json()) as { voices?: VoiceOption[] };
  return Array.isArray(body.voices) ? body.voices.filter((voice) => typeof voice?.id === "string" && typeof voice?.label === "string") : [];
}

/** "Test the voice": a short sample in the voice picked, as audio. */
export async function testVoice(text: string, settings: VoiceModeSettings, botId?: string, signal?: AbortSignal): Promise<Blob> {
  if (botId) return speakVoiceMode(botId, text, settings, undefined, signal);
  const res = await fetch("/api/voice/speak", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text, ...voiceBody("", settings) }),
    signal,
  });
  if (!res.ok) throw await failure(res);
  return res.blob();
}
