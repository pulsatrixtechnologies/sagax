// The xAI keys that may serve one person's voice, in order, and the fall
// back from one to the next (2026-10-28, the operator's decision: use the key that
// has funds).
//
// On an organization server a person may have up to three xAI keys:
//   1. their own voice key saved in Sagax (Settings > Models and voice > My
//      voice keys, server/voice/person-voice-keys.ts): `voice-key`
//   2. their own xAI key in Perspicax (Providers > Grok): `perspicax-key`
//   3. the organization's key, when it was given to them: `org-key`
// A solo server has the server's key only: `server`.
//
// Every voice request starts with the first key. When xAI refuses it for
// credits (`quota`) or for the key itself (`key`: invalid, revoked, no TTS
// permission), the next key is tried at once, and the refusal is remembered
// for VOICE_KEY_REFUSAL_TTL_MS so the following sentences of the call skip
// straight to the key that works (a 402 round trip per sentence would be
// heard as a pause). A refilled key is tried again once that passes. Any
// other failure (rate limited, xAI down, an unknown voice) stays with the
// key that got it: another key would not help, and it would cost twice.
//
// Whatever the outcome, the person learns which key served or failed: its
// source and its last four characters (as My voice keys shows them), never
// more of it. Pure of HTTP: server/voice/voice-mode.ts wires it to the routes.
import type { VoiceKeySource, VoiceModeRefusalCause, VoiceModeVia } from "../../shared/voice-mode.ts";
import { VOICE_PROVIDER_LABELS, type VoiceProviderId } from "../../shared/voice-providers.ts";
import { grokVoiceFailure, type GrokVoiceFailure } from "../tts/grok.ts";

export interface VoiceKeyCandidate {
  key: string;
  via: VoiceModeVia;
  source: VoiceKeySource;
  /** the last four characters of a key of 12 or more, as the settings show them */
  last4: string | null;
  payerPrincipalId?: string;
  /** whose key (2026-10-29): xAI when absent */
  provider?: VoiceProviderId;
}

/** A key as the page may know it: never the key itself. */
export interface VoiceKeyRef {
  source: VoiceKeySource;
  last4: string | null;
  /** absent for xAI, so an older page reads it as before */
  provider?: VoiceProviderId;
}

export function candidateProvider(candidate: { provider?: VoiceProviderId }): VoiceProviderId {
  return candidate.provider ?? "xai";
}

export type VoiceKeys =
  | { ok: true; keys: VoiceKeyCandidate[] }
  | { ok: false; cause: VoiceModeRefusalCause };

export function voiceKeyRef(candidate: VoiceKeyCandidate | VoiceKeyRef): VoiceKeyRef {
  const provider = candidateProvider(candidate);
  return { source: candidate.source, last4: candidate.last4, ...(provider !== "xai" ? { provider } : {}) };
}

export function keyLast4(key: string): string | null {
  return key.length >= 12 ? key.slice(-4) : null;
}

/** A refusal xAI gave one key, remembered for a while. */
export interface VoiceKeyRefusal extends VoiceKeyRef {
  failure: GrokVoiceFailure;
}

/** How long a key refused for credits or for itself is skipped when another
 * key serves the person. */
export const VOICE_KEY_REFUSAL_TTL_MS = 5 * 60_000;

/** How long a provider that failed for itself (rate limited, down) is
 * passed over while another provider serves the person. */
export const VOICE_PROVIDER_REFUSAL_TTL_MS = 60_000;

/** The failures another key can fix. */
export function voiceKeyFailureIsFinal(failure: GrokVoiceFailure): boolean {
  return failure === "quota" || failure === "key";
}

/** Keys xAI refused lately, per person: the next request skips them while
 * another key serves. Memory only, never a key, never written. */
export class VoiceKeyRefusals {
  private readonly refused = new Map<string, { failure: GrokVoiceFailure; at: number; ttl: number }>();
  private readonly ttl: number;
  private readonly now: () => number;

  constructor(options: { ttlMs?: number; now?: () => number } = {}) {
    this.ttl = options.ttlMs ?? VOICE_KEY_REFUSAL_TTL_MS;
    this.now = options.now ?? Date.now;
  }

  private id(who: string, candidate: VoiceKeyRef): string {
    return `${who}\u0000${candidateProvider(candidate)}\u0000${candidate.source}\u0000${candidate.last4 ?? ""}`;
  }

  remember(who: string, candidate: VoiceKeyRef, failure: GrokVoiceFailure, ttlMs?: number): void {
    if (this.refused.size >= 10_000) this.refused.clear();
    this.refused.set(this.id(who, candidate), { failure, at: this.now(), ttl: ttlMs ?? this.ttl });
  }

  /** xAI took this key: whatever it was refused for is over. */
  forget(who: string, candidate: VoiceKeyRef): void {
    this.refused.delete(this.id(who, candidate));
  }

  failure(who: string, candidate: VoiceKeyRef): GrokVoiceFailure | null {
    const entry = this.refused.get(this.id(who, candidate));
    if (!entry) return null;
    if (this.now() - entry.at >= entry.ttl) {
      this.refused.delete(this.id(who, candidate));
      return null;
    }
    return entry.failure;
  }

  /** The candidates in the order to try them: the ones refused lately
   * last (they are still tried when nothing else serves), each with what
   * it was refused for. */
  order(who: string, keys: readonly VoiceKeyCandidate[]): Array<{ candidate: VoiceKeyCandidate; refused: GrokVoiceFailure | null }> {
    const all = keys.map((candidate) => ({ candidate, refused: this.failure(who, voiceKeyRef(candidate)) }));
    return [...all.filter((entry) => !entry.refused), ...all.filter((entry) => entry.refused)];
  }
}

export interface VoiceKeyAttempt<T> {
  value: T;
  used: VoiceKeyCandidate;
  /** the keys of the same provider tried before, each with its refusal
   * (the page says it once: a key that gave way is never a silent switch) */
  skipped: VoiceKeyRefusal[];
  /** the providers that failed before this one: a silent fallback, noted
   * in the thread's Events lens */
  fellBack: VoiceKeyRefusal[];
}

/** Where to go after `candidate` failed with `failure`: the next key of the
 * same provider when another key can fix it (credits, the key itself),
 * else the first key of another provider (2026-10-29: a provider that
 * fails or reaches its limit gives way to the next one), else nowhere. */
export function nextCandidateIndex(ordered: readonly VoiceKeyCandidate[], i: number, failure: GrokVoiceFailure): number {
  const provider = candidateProvider(ordered[i]!);
  if (voiceKeyFailureIsFinal(failure) && i + 1 < ordered.length) return i + 1;
  const other = ordered.findIndex((candidate, at) => at > i && candidateProvider(candidate) !== provider);
  return other;
}

/** xAI failed the request on `used`, after `tried` (the keys refused
 * before it, then itself); `final` when another key could have fixed it
 * (credits, the key itself) and none was left. */
export class VoiceKeyFailure extends Error {
  readonly used: VoiceKeyCandidate;
  readonly failure: GrokVoiceFailure;
  readonly tried: VoiceKeyRefusal[];
  readonly final: boolean;

  constructor(message: string, used: VoiceKeyCandidate, failure: GrokVoiceFailure, tried: VoiceKeyRefusal[]) {
    super(message);
    this.used = used;
    this.failure = failure;
    this.tried = tried;
    this.final = voiceKeyFailureIsFinal(failure);
  }
}

/** Run `attempt` with each key in turn until one is taken. A key refused
 * for credits or for itself is remembered and the next one is tried; any
 * other failure stops with the key that got it (another key would not
 * help). Throws VoiceKeyFailure, its message already scrubbed. */
export async function withVoiceKeys<T>(
  who: string,
  keys: readonly VoiceKeyCandidate[],
  refusals: VoiceKeyRefusals,
  attempt: (candidate: VoiceKeyCandidate) => Promise<T>,
  options: { log?(line: string): void; what?: string; scrub?(message: string): string } = {},
): Promise<VoiceKeyAttempt<T>> {
  const ordered = refusals.order(who, keys).map((entry) => entry.candidate);
  const skipped: VoiceKeyRefusal[] = [];
  const fellBack: VoiceKeyRefusal[] = [];
  for (let i = 0; i >= 0 && i < ordered.length;) {
    const candidate = ordered[i]!;
    try {
      const value = await attempt(candidate);
      refusals.forget(who, voiceKeyRef(candidate));
      return { value, used: candidate, skipped: skipped.filter((entry) => candidateProvider(entry) === candidateProvider(candidate)), fellBack };
    } catch (error) {
      // the person's own abort (barge-in) is no provider failure
      if (error instanceof Error && error.name === "AbortError") throw error;
      const raw = error instanceof Error ? error.message : String(error);
      const message = options.scrub ? options.scrub(raw) : raw;
      const failure = grokVoiceFailure(message);
      const refusal: VoiceKeyRefusal = { ...voiceKeyRef(candidate), failure };
      const next = nextCandidateIndex(ordered, i, failure);
      if (voiceKeyFailureIsFinal(failure)) refusals.remember(who, voiceKeyRef(candidate), failure);
      else if (next >= 0) refusals.remember(who, voiceKeyRef(candidate), failure, VOICE_PROVIDER_REFUSAL_TTL_MS);
      if (next < 0) throw new VoiceKeyFailure(message, candidate, failure, [...skipped, refusal]);
      skipped.push(refusal);
      if (candidateProvider(ordered[next]!) !== candidateProvider(candidate)) fellBack.push(refusal);
      options.log?.(`[voice-mode] ${providerName(candidate)} ${options.what ?? "request"} refused the ${describeVoiceKey(candidate)} (${failure}): trying the ${describeVoiceKey(ordered[next]!)}`);
      i = next;
    }
  }
  throw new Error("no voice key");
}

export function providerName(candidate: { provider?: VoiceProviderId }): string {
  return VOICE_PROVIDER_LABELS[candidateProvider(candidate)];
}

/** A key for the log: its source and last four characters, never more. */
export function describeVoiceKey(candidate: VoiceKeyRef): string {
  const name = candidate.source === "voice-key" ? "person's voice key"
    : candidate.source === "perspicax-key" ? "person's Perspicax key"
      : candidate.source === "org-key" ? "organization's key" : "server's key";
  const named = candidateProvider(candidate) === "xai" ? name : `${name} (${providerName(candidate)})`;
  return candidate.last4 ? `${named} ···${candidate.last4}` : named;
}
