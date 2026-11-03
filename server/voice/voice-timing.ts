// Voice timings for the thread's Events lens (runtime.notice): where the
// seconds between the end of a person's speech and the bot's answer went.
// Numbers only, never the words, never a key.
//
//   speech to text (upload): the whole recording sent once it stopped
//   speech to text (stream): xAI's final words after the page's finalize
//   call turn: the page's stages (end of speech, words ready, sent) beside
//   the server's (received, dispatched, engine, first text)

/** Client stages of one call turn, as the page measured them (ms). */
export interface VoiceClientTiming {
  /** end of speech -> the turn detector ended the turn */
  endpointMs?: number;
  /** -> the words were ready */
  sttMs?: number;
  /** -> sent to the bot */
  dispatchMs?: number;
}

const MAX_STAGE_MS = 10 * 60_000;

/** The page's timing on a send (voiceCall.timing), kept only when every
 * field is a sane number of milliseconds. */
export function parseVoiceClientTiming(value: unknown): VoiceClientTiming | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const out: VoiceClientTiming = {};
  for (const key of ["endpointMs", "sttMs", "dispatchMs"] as const) {
    const ms = record[key];
    if (typeof ms === "number" && Number.isFinite(ms) && ms >= 0 && ms <= MAX_STAGE_MS) out[key] = Math.round(ms);
  }
  return Object.keys(out).length ? out : undefined;
}

function seconds(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`;
}

/** 16 kHz 16-bit mono WAV: its length in seconds (other formats: unknown). */
function wavSeconds(bytes: number, mime: string): number | undefined {
  if (mime !== "audio/wav" || bytes <= 44) return undefined;
  return (bytes - 44) / (16_000 * 2);
}

/** " with OpenAI": the provider of a request, named when it is not xAI
 * (xAI's lines stay as they were). */
function by(provider?: string): string {
  return provider && provider !== "xAI" ? `, ${provider}` : "";
}

export function uploadedTranscriptNotice(input: { bytes: number; mime: string; ms: number; provider?: string }): string {
  const audio = wavSeconds(input.bytes, input.mime);
  const length = audio !== undefined ? `${audio.toFixed(1)} s of audio` : `${Math.round(input.bytes / 1024)} KB of audio`;
  return `Voice: speech to text (whole recording${by(input.provider)}) took ${seconds(input.ms)} for ${length}`;
}

export function streamedTranscriptNotice(ms: number, provider?: string): string {
  return `Voice: speech to text (streaming${by(provider)}) gave the final words ${seconds(ms)} after the end of speech`;
}

/** One sentence of the bot's voice: how soon its first audio came. */
export function firstAudioNotice(ms: number, provider: string): string {
  return `Voice: ${provider} voice gave the first audio of a sentence ${seconds(ms)} after it was asked`;
}

const FAILURE_WORDS: Record<string, string> = {
  key: "the key was refused", quota: "no credits left", busy: "rate limit", down: "not reachable", voice: "unknown voice", other: "an error",
};

/** A provider that failed and the one that took over (2026-10-29): said
 * nowhere but here, the switch itself is silent. */
export function providerFallbackNotice(role: "speech to text" | "voice", from: ReadonlyArray<{ provider: string; failure: string }>, to: string): string {
  const failed = from.map((entry) => `${entry.provider} (${FAILURE_WORDS[entry.failure] ?? entry.failure})`).join(", ");
  return `Voice: ${role} went on with ${to} after ${failed}`;
}

/** One call turn, page and server side by side. */
export function callTurnNotice(input: {
  client?: VoiceClientTiming;
  dispatchMs?: number;
  engineMs?: number;
  warm?: boolean;
  firstTokenMs?: number;
  run?: { model?: string; contextBytes?: number; session?: "new" | "resumed" };
}): string {
  const parts: string[] = [];
  const { client } = input;
  if (client?.endpointMs !== undefined) parts.push(`end of speech ${seconds(client.endpointMs)}`);
  if (client?.sttMs !== undefined) parts.push(`speech to text ${seconds(client.sttMs)}`);
  if (client?.dispatchMs !== undefined) parts.push(`send ${seconds(client.dispatchMs)}`);
  if (input.dispatchMs !== undefined) parts.push(`turn setup ${seconds(input.dispatchMs)}`);
  if (input.engineMs !== undefined) parts.push(`engine ${seconds(input.engineMs)}${input.warm === undefined ? "" : input.warm ? " (warm)" : " (cold start)"}`);
  if (input.firstTokenMs !== undefined) parts.push(`first words ${seconds(input.firstTokenMs)}`);
  const total = [client?.endpointMs, client?.sttMs, client?.dispatchMs, input.dispatchMs, input.engineMs, input.firstTokenMs]
    .reduce<number>((sum, ms) => sum + (ms ?? 0), 0);
  const run = input.run;
  const ran = run ? [run.model ? `on ${run.model}` : "", run.contextBytes !== undefined ? `${kilobytes(run.contextBytes)} of context` : "",
    run.session === "new" ? "new call session" : run.session === "resumed" ? "call session resumed" : ""].filter(Boolean) : [];
  return `Voice turn: ${parts.join(", ")}; ${seconds(total)} from the end of speech to the first words${ran.length ? ` (${ran.join(", ")})` : ""}`;
}

function kilobytes(bytes: number): string {
  return bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${Math.round(bytes)} B`;
}

/** The page's audio stages of one call turn (ms): from the answer's first
 * text to its first audible word. */
export interface VoiceAudioTiming {
  /** first streamed text -> a speakable first clause */
  firstSentenceMs?: number;
  /** -> its first audio bytes from text to speech */
  ttsMs?: number;
  /** -> audible */
  playbackMs?: number;
  /** end of speech -> the first audible word of the answer */
  totalMs?: number;
}

/** The page's report (POST /voice/call "heard"), kept only when every field
 * is a sane number of milliseconds. */
export function parseVoiceAudioTiming(value: unknown): VoiceAudioTiming | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const out: VoiceAudioTiming = {};
  for (const key of ["firstSentenceMs", "ttsMs", "playbackMs", "totalMs"] as const) {
    const ms = record[key];
    if (typeof ms === "number" && Number.isFinite(ms) && ms >= 0 && ms <= MAX_STAGE_MS) out[key] = Math.round(ms);
  }
  return Object.keys(out).length ? out : undefined;
}

/** One call turn's audio, as the page heard it. */
export function audioTurnNotice(audio: VoiceAudioTiming): string {
  const parts: string[] = [];
  if (audio.firstSentenceMs !== undefined) parts.push(`first sentence ${seconds(audio.firstSentenceMs)}`);
  if (audio.ttsMs !== undefined) parts.push(`text to speech ${seconds(audio.ttsMs)}`);
  if (audio.playbackMs !== undefined) parts.push(`playback ${seconds(audio.playbackMs)}`);
  const total = audio.totalMs !== undefined ? `; first words heard ${seconds(audio.totalMs)} after the end of speech` : "";
  return `Voice audio: ${parts.join(", ") || "first words heard"}${total}`;
}
