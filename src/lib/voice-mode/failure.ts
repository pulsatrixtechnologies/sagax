// What a call says when the bot's turn fails. Pure.
//
// A failed turn is stored as an activity row named "error: <cause>"
// (shared/failed-turn.ts), and a turn that could not run on an organization
// server as an "access" row. The chat shows them; a call used to say
// nothing at all: the person heard silence and could not see why. On a
// phone a failure is one clear sentence with what to do next, then silence
// (docs/voice-mode-xai.md, "A call recovers by itself"):
//
// - The cause is never read aloud (an engine's words, a status code, a
//   provider's JSON): it is sorted into a kind, and the kind has one
//   sentence in the call's language (`voiceMode.failure.<kind>`).
// - The harness retries a call turn that ended without an answer once
//   (server/voice/voice-call-watchdog.ts, 2.5 s after it settles). The call waits
//   CALL_FAILURE_GRACE_MS after it first saw the failed row, with the bot
//   idle, before it speaks; a retry that answers says nothing of the
//   failure, a retry that fails too is said once.
// - Once per person's words: every failed row after those words is then
//   settled, so a second failure on the same words stays silent.
// - Nothing while the bot works, speaks, or a question or approval waits.

import { isClientCancellation, isStoppedTurnName } from "../../../shared/client-cancel";
import { failedTurnCause } from "../../../shared/failed-turn";
import type { VoiceKeyInfo, VoiceKeySource } from "../../../shared/voice-mode";
import type { LocaleKey } from "@/locales";
import { VoiceProviderError, type VoiceKeyEvent, type VoiceProviderFailure } from "./api";

/** The app's `t` (lib/i18n), or a test's. */
export type Translate = (key: LocaleKey, params?: Record<string, string | number>) => string;

/** How long a failed row waits (bot idle) before the call says it: past
 * the harness's retry 2.5 s after the turn settles, its warm-up and its
 * first frame. */
export const CALL_FAILURE_GRACE_MS = 6_000;

/** What went wrong, as the call says it: the model is overloaded or rate
 * limited (`busy`, try in a minute), a usage window is used up (`limit`,
 * try later), its plan or credits ran out (`quota`), it needs a new
 * sign-in or access (`signIn`), the network or a server dropped
 * (`connection`), anything else (`generic`). */
export type CallFailureKind = "busy" | "limit" | "quota" | "signIn" | "connection" | "generic";

/** The locale key of the sentence a call says for a kind. */
export function callFailureKey(kind: CallFailureKind): `voiceMode.failure.${CallFailureKind}` {
  return `voiceMode.failure.${kind}`;
}

/** Narrow on purpose: a cause that only mentions "signing", "512 tokens"
 * or a "capacity" is no such kind. The same list is in CallFailure.swift. */
const KINDS: Array<[RegExp, CallFailureKind]> = [
  [/usage limit|(?<!rate )limit reached|limit will reset|rate limit window/i, "limit"],
  [/insufficient.?quota|\bquota\b|credit balance|out of (?:tokens|credits)|\bbilling\b|payment required|\b402\b/i, "quota"],
  [/\b429\b|rate.?limit|too many requests|overloaded|\b529\b|\b503\b|\bat capacity\b|over capacity|service unavailable/i, "busy"],
  [/\b40[13]\b|unauthori[sz]ed|forbidden|\bsign(?:ed)?[ -]?in\b|\blog(?:ged)?[ -]?in\b|\/login|authenticat|api key|invalid.{0,20}\bkey\b|(?:token|session|credential|key|oauth)\S*\s+(?:has\s+)?expired/i, "signIn"],
  [/failed to fetch|network|ECONNRESET|ECONNREFUSED|ECONNABORTED|EPIPE|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH|socket hang up|connection (?:reset|refused|closed|lost|error)|timed? ?out|ETIMEDOUT|\b(?:HTTP|status)\s*5\d\d\b|\b50[0234]\b(?!\s*(?:tokens|items|ms|bytes|lines|rows))|bad gateway|internal server error/i, "connection"],
];

/** The kind of a failed turn's cause; `setup` (the row asks for an
 * install or a sign-in) is a sign-in. */
export function callFailureKind(cause: string, flags: { setup?: boolean } = {}): CallFailureKind {
  if (flags.setup) return "signIn";
  return KINDS.find(([pattern]) => pattern.test(cause))?.[1] ?? "generic";
}

export interface FailureRow {
  id: string;
  role: string;
  kind: string;
  text?: string;
  tool?: { name?: string; setup?: boolean } | null;
  card?: { requestId?: string; answered?: unknown; dismissed?: unknown } | null;
  parallelTask?: unknown;
  /** words another bot asked (not the person's), as the harness skips them */
  peerAsk?: unknown;
}

/** A row that says the turn failed, and its kind; null for any other row
 * (a stop the person asked for is no failure). */
export function failedRowKind(row: FailureRow): CallFailureKind | null {
  if (row.role !== "bot") return null;
  if (row.kind === "access") return "generic";
  if (row.kind !== "activity" || !row.tool?.name) return null;
  if (isStoppedTurnName(row.tool.name)) return null;
  const cause = failedTurnCause(row.tool.name);
  if (cause === null || isClientCancellation(cause)) return null;
  return callFailureKind(cause, { setup: row.tool.setup });
}

/** Watches a call's thread for failed turns and says when one is due. */
export class CallFailure {
  private readonly seen = new Map<string, number>();
  private readonly settled = new Set<string>();
  /** the person's words a failure was already said for */
  private readonly saidFor = new Set<string>();

  /** Every row on screen when the call starts is old news. */
  constructor(initial: readonly FailureRow[] = []) {
    for (const row of initial) this.settled.add(row.id);
  }

  /** The kind to say now, or null. Call it on every tick; it remembers
   * when it first saw each failed row and what it already said. */
  next(opts: {
    now: number;
    messages: readonly FailureRow[];
    botBusy: boolean;
    botSpeaking: boolean;
    awaitingAnswer: boolean;
  }): CallFailureKind | null {
    const { messages } = opts;
    const lastUser = messages.findLastIndex((row) => row.role === "user" && row.kind === "text" && !row.parallelTask && !row.peerAsk);
    if (lastUser < 0) return null;
    const words = messages[lastUser]!.id;
    const after = messages.slice(lastUser + 1).filter((row) => !row.parallelTask);
    const failed = after.filter((row) => !this.settled.has(row.id) && failedRowKind(row) !== null);
    if (!failed.length) return null;
    for (const row of failed) if (!this.seen.has(row.id)) this.seen.set(row.id, opts.now);
    // an answer came after all (the retry worked): nothing to say
    if (after.some((row) => row.role === "bot" && row.kind === "text" && row.text?.trim())) {
      for (const row of failed) this.settled.add(row.id);
      return null;
    }
    const open = after.some((row) => row.card?.requestId && !row.card.answered && !row.card.dismissed);
    if (opts.botBusy || opts.botSpeaking || opts.awaitingAnswer || open) return null;
    // said once for these words: a later failure on them stays silent
    if (this.saidFor.has(words)) {
      for (const row of failed) this.settled.add(row.id);
      return null;
    }
    const newest = failed[failed.length - 1]!;
    if (opts.now - this.seen.get(newest.id)! < CALL_FAILURE_GRACE_MS) return null;
    for (const row of failed) this.settled.add(row.id);
    this.saidFor.add(words);
    return failedRowKind(newest);
  }
}

export type VoiceErrorNoteKey =
  | "voiceMode.micDenied"
  | "voiceMode.micUnavailable"
  | "voiceMode.speechFailed"
  | "voiceMode.transcribeFailed"
  | `voiceMode.provider.${Exclude<VoiceProviderFailure, "other">}`
  | `voiceMode.provider.${Exclude<VoiceProviderFailure, "other" | "down" | "voice">}.named`;

/** The locale key naming a key by its source: "your voice key ···Wez8",
 * "your xAI key in Perspicax ···c0Je", "the organization's key". */
export function voiceKeyLabelKey(source: VoiceKeySource): `voiceMode.key.${"voiceKey" | "perspicaxKey" | "orgKey" | "serverKey"}` {
  return source === "voice-key" ? "voiceMode.key.voiceKey" : source === "perspicax-key" ? "voiceMode.key.perspicaxKey" : source === "org-key" ? "voiceMode.key.orgKey" : "voiceMode.key.serverKey";
}

/** The locale key of what to do about a key of that source: add credits
 * or change it where it lives. */
export function voiceKeyActionKey(source: VoiceKeySource): `voiceMode.keyAction.${"voiceKey" | "perspicaxKey" | "orgKey" | "serverKey"}` {
  return source === "voice-key" ? "voiceMode.keyAction.voiceKey" : source === "perspicax-key" ? "voiceMode.keyAction.perspicaxKey" : source === "org-key" ? "voiceMode.keyAction.orgKey" : "voiceMode.keyAction.serverKey";
}

/** A key as the person reads it, through `t`: its source and its last four
 * characters when known (`tail`: " ···Wez8" or nothing). */
export function voiceKeyLabel(key: VoiceKeyInfo, t: Translate): string {
  return t(voiceKeyLabelKey(key.source), { tail: key.last4 ? ` ···${key.last4}` : "" });
}

export interface VoiceErrorNote {
  key: VoiceErrorNoteKey;
  /** the sentence's placeholders (`key`, `action`), when it names a key */
  params?: Record<string, string>;
  retry: boolean;
  clearsOnVoice: boolean;
}

/** What the call's bar says when the microphone, the speech to text or the
 * voice fails, and whether its "Try again" button means anything.
 *
 * - The microphone: its own line, and "Try again" opens it again.
 * - The voice or the speech to text failed at xAI: the reason the server
 *   gave (the key was rejected, no credits, rate limited, xAI down, an
 *   unknown voice), never a vague "didn't come through", and, when the
 *   server named the key, which key it was (its source and last four)
 *   and what to do about it. No button: the call goes on, each sentence
 *   is tried again by itself (streamVoiceModeSpeech), and the line goes
 *   away when the voice is heard again (`clearsOnVoice`).
 * - Anything else: the voice line says the answer is in the chat, the
 *   transcription line asks to say it again. */
export function voiceErrorNote(
  reason: "mic-denied" | "mic-unavailable" | "speech-failed" | "transcribe-failed",
  kind: VoiceProviderFailure | null,
  cause?: unknown,
  t: Translate = (key) => key,
): VoiceErrorNote {
  if (reason === "mic-denied") return { key: "voiceMode.micDenied", retry: true, clearsOnVoice: false };
  if (reason === "mic-unavailable") return { key: "voiceMode.micUnavailable", retry: true, clearsOnVoice: false };
  const key = cause instanceof VoiceProviderError ? cause.key : undefined;
  if (key && (kind === "quota" || kind === "key" || kind === "busy")) {
    return {
      key: `voiceMode.provider.${kind}.named` as const,
      params: { key: voiceKeyLabel(key, t), action: t(voiceKeyActionKey(key.source)) },
      retry: false,
      clearsOnVoice: true,
    };
  }
  if (kind && kind !== "other") return { key: `voiceMode.provider.${kind}` as const, retry: false, clearsOnVoice: true };
  if (reason === "speech-failed") return { key: "voiceMode.speechFailed", retry: false, clearsOnVoice: true };
  return { key: "voiceMode.transcribeFailed", retry: false, clearsOnVoice: true };
}

/** What the bar says once when the voice went on over another key: the
 * key refused and why, the key that serves now. */
export function voiceKeyFallbackNote(event: VoiceKeyEvent, t: Translate): string {
  const refused = event.skipped[event.skipped.length - 1]!;
  return t("voiceMode.keyFallback", {
    refused: voiceKeyLabel(refused, t),
    reason: t(refused.failure === "quota" ? "voiceMode.keyRefused.quota" : "voiceMode.keyRefused.key"),
    used: voiceKeyLabel(event.used, t),
  });
}
