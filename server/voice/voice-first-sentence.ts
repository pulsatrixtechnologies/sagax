// The first spoken sentence of a duplex call, on a small fast model, beside
// the bot's own turn. The opener is not stored and not a second conversation:
// one clip, cancelled when the utterance changes, ignored once the main
// reply has started. Only the HTTP Grok driver runs it (it already has
// generateText). An ACP engine is primed instead (cachePrime on the warm),
// because a second CLI spawn would be slower than the warm process.
//
// Why the other engines have no parallel opener (checked 2026-10-17):
// - Claude: its generateText is a fresh `claude -p` process on the helper
//   model, with no streaming and no system or model option. A cold CLI
//   start costs more than the warm call process takes to write its own
//   first words, so the opener would land after the answer has begun.
// - Codex: the driver has no one-shot text path; a second app-server thread
//   would pay its handshake and session before a single token.
// - ACP (Grok CLI and the other agents): a session runs one prompt at a
//   time and the warm session is the call's; a second session means
//   session/new and every MCP server reconnected.
// For every engine, the quick first line before a slow step is the call's
// own progress line, from the turn's first tool that runs past 1.5 s with
// nothing said (src/lib/voice-mode/progress.ts, the iPhone's CallProgress),
// and the bot's own words before a tool, spoken as they stream.
//
// The voice routes stay ears and a voice. This call goes through the bot's
// engine, never the xAI voice key, and never xAI chat from voice-mode.ts.

import type { TextGenerationOptions } from "../contracts.ts";

/** Stable, short, and the same on every opener so a provider can cache it. */
export const VOICE_FIRST_SENTENCE_SYSTEM =
  "You are on a live phone call. Speak one short sentence that starts the answer, then stop. No markdown, no lists.";

/** How long a spoken turn waits for the warm's cache-prime prompt. */
export const VOICE_CACHE_PRIME_JOIN_MS = 250;

/** After that, how long to wait once the prime has been cancelled. */
export const VOICE_CACHE_PRIME_CANCEL_WAIT_MS = 80;

export const VOICE_CACHE_PRIME_MARKER = "[sagax-cache-prime]";

const OPENER_MAX_WORDS = 18;
const OPENER_MAX_CHARS = 120;

/** Preference order. A model the engine does not list is skipped. A fuzzy
 * match is only a last resort, and a reasoning row is never the opener. */
const FAST_SENTENCE_MODELS = [
  "grok-3-mini",
  "grok-4-fast-non-reasoning",
  "grok-4-fast",
  "grok-4.7-build-fast",
];

export function cachePrimePrompt(system: string): string {
  return `${system}\n\n${VOICE_CACHE_PRIME_MARKER} Reply with ok.`;
}

/** The smallest fast model this engine lists, or null when every candidate
 * would just duplicate a slow call. */
export function pickFastSentenceModel(ids: readonly string[]): string | null {
  const listed = new Set(ids);
  for (const id of FAST_SENTENCE_MODELS) if (listed.has(id)) return id;
  return ids.find((id) => /fast|mini|haiku|flash/i.test(id) && !/reasoning/i.test(id)) ?? null;
}

/** The first punctuated sentence, or the finished text when the model
 * stopped without one. Fewer than two words is not worth speaking. */
export function clipFirstSentence(text: string, opts?: { finished?: boolean }): string | null {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  const punctuated = cleaned.match(/^(.+?[.!?])(?:\s|$)/);
  let sentence = punctuated ? punctuated[1]!.trim() : "";
  if (!sentence) {
    if (!opts?.finished) return null;
    sentence = cleaned;
  }
  let words = sentence.split(/\s+/).filter(Boolean);
  if (words.length < 2) return null;
  if (words.length > OPENER_MAX_WORDS) {
    words = words.slice(0, OPENER_MAX_WORDS);
    sentence = words.join(" ");
  }
  if (sentence.length > OPENER_MAX_CHARS) {
    sentence = sentence.slice(0, OPENER_MAX_CHARS).trim();
    words = sentence.split(/\s+/).filter(Boolean);
    if (words.length < 2) return null;
  }
  if (!/[.!?]$/.test(sentence)) sentence = `${sentence.replace(/[,:;]+$/, "")}.`;
  return sentence;
}

/** One opener per thread. The same utterance is left alone; a new one
 * aborts the previous so a stale clip cannot be spoken. */
export class VoiceFirstSentenceJobs {
  private jobs = new Map<string, { utteranceId: string; abort: AbortController }>();

  begin(threadId: string, utteranceId: string, run: (signal: AbortSignal) => Promise<void>): void {
    const current = this.jobs.get(threadId);
    if (current?.utteranceId === utteranceId) return;
    current?.abort.abort();
    const abort = new AbortController();
    this.jobs.set(threadId, { utteranceId, abort });
    void run(abort.signal).finally(() => {
      const job = this.jobs.get(threadId);
      if (job?.utteranceId === utteranceId) this.jobs.delete(threadId);
    }).catch(() => {});
  }

  isCurrent(threadId: string, utteranceId: string): boolean {
    const job = this.jobs.get(threadId);
    return job?.utteranceId === utteranceId && !job.abort.signal.aborted;
  }

  cancel(threadId: string): void {
    this.jobs.get(threadId)?.abort.abort();
    this.jobs.delete(threadId);
  }
}

export interface VoiceFirstSentenceInput {
  jobs: VoiceFirstSentenceJobs;
  threadId: string;
  callId: string;
  utteranceId: string;
  text: string;
  driverKind: string;
  modelIds: readonly string[];
  generate?: (prompt: string, options: TextGenerationOptions) => Promise<string>;
  emit: (text: string) => void;
}

/** Fire the opener and return. HTTP Grok only. A missing fast model, or an
 * engine without generateText, does nothing: the main turn still answers. */
export function beginVoiceFirstSentence(input: VoiceFirstSentenceInput): void {
  if (input.driverKind !== "grok" || !input.generate) return;
  const model = pickFastSentenceModel(input.modelIds);
  if (!model) return;
  const generate = input.generate;
  input.jobs.begin(input.threadId, input.utteranceId, async (signal) => {
    let streamed = "";
    let sent = false;
    const send = (raw: string, finished: boolean) => {
      if (sent || signal.aborted || !input.jobs.isCurrent(input.threadId, input.utteranceId)) return;
      const clip = clipFirstSentence(raw, { finished });
      if (!clip) return;
      sent = true;
      input.emit(clip);
    };
    try {
      const full = await generate(input.text, {
        signal,
        model,
        system: VOICE_FIRST_SENTENCE_SYSTEM,
        maxTokens: 40,
        onDelta: (delta) => {
          streamed += delta;
          send(streamed, false);
        },
      });
      if (!sent) send(full || streamed, true);
    } catch {
      // the bot's own turn is the answer
    }
  });
}

/** A spoken turn waits at most `joinMs` for the warm's prime. Past that it
 * cancels the prime so the session can take the real prompt. */
export async function joinCachePrime(
  prime: Promise<unknown> | undefined,
  cancel: () => void,
  joinMs = VOICE_CACHE_PRIME_JOIN_MS,
): Promise<"none" | "joined" | "cancelled"> {
  if (!prime) return "none";
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), joinMs);
    timer.unref?.();
  });
  const winner = await Promise.race([
    prime.then(() => "joined" as const, () => "joined" as const),
    timeout,
  ]);
  if (timer) clearTimeout(timer);
  if (winner === "joined") return "joined";
  cancel();
  await Promise.race([
    prime.then(() => undefined, () => undefined),
    new Promise((resolve) => setTimeout(resolve, VOICE_CACHE_PRIME_CANCEL_WAIT_MS)),
  ]);
  return "cancelled";
}

/** `voice.opener` and `voice.call.ended` reach the person the turn speaks
 * for, and the operator at this computer when the stream has no viewer.
 * Same rule as a nudge. */
export function voiceOpenerFrameAllowed(
  payload: { kind?: unknown; audience?: unknown },
  viewerId: string | undefined,
  localPersonId: string,
): boolean {
  if (payload.kind !== "voice.opener" && payload.kind !== "voice.call.ended") return true;
  if (typeof payload.audience !== "string") return false;
  const audience = payload.audience.trim().toLowerCase();
  if (!audience) return false;
  const viewer = (viewerId ?? localPersonId).trim().toLowerCase();
  return Boolean(viewer) && audience === viewer;
}
