// The xAI keys that may serve one person's voice, in order, and the fall
// back from one to the next (2026-10-28, the operator's decision: use the key that
// has funds).
//
// On an organization server a person may have up to three xAI keys:
//   1. their own voice key saved in Sagax (Settings > Models and voice > My
//      voice keys, server/voice/person-voice-keys.ts): `voice-key`
//   2. their own xAI key in Perspicax (Providers > Grok): `perspicax-key`
//   3. the organization's key, when it was given to them: `org-key`
// and two accounts, which are sign-ins and never keys: their own connected
// Grok account first of all (`grok-account`), and the organization's Grok
// account just before the organization's key (`org-account`, #5200).
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
import type { VoiceKeyInfo, VoiceKeySource, VoiceModeRefusalCause, VoiceModeVia } from "../../shared/voice-mode.ts";
import { VOICE_PROVIDER_LABELS, type VoiceProviderId } from "../../shared/voice-providers.ts";
import { grokVoiceFailure, type GrokVoiceFailure } from "../tts/grok.ts";
import { chainCallReason, noCallReason, type NoCallLanguage } from "./grok-account-voice.ts";

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
  | { ok: true; keys: VoiceKeyCandidate[]; confirm?: { from: string; to: string; form: string; via: string; aspect: string } }
  | { ok: false; cause: VoiceModeRefusalCause; error?: string; confirm?: { from: string; to: string; form: string; via: string; aspect: string } };

export function voiceKeyRef(candidate: VoiceKeyCandidate | VoiceKeyRef): VoiceKeyRef {
  const provider = candidateProvider(candidate);
  return { source: candidate.source, last4: candidate.last4, ...(provider !== "xai" ? { provider } : {}) };
}

export function keyLast4(key: string): string | null {
  return key.length >= 12 ? key.slice(-4) : null;
}

/** How a credential is presented to xAI: a connected Grok account, the
 * person's or the organization's, speaks on api.x.ai with its session token
 * and the CLI token header, every other source is an API key on api.x.ai
 * (server/tts/grok.ts withVoiceAuth). One rule for the app's own voice and
 * for the keys a phone line is given (server/org/org-link-routes.ts). */
export type VoiceKeyAuth = "grok-account" | "api-key";
export function voiceKeyAuth(candidate: { source: string }): VoiceKeyAuth {
  return candidate.source === "grok-account" || candidate.source === "org-account" ? "grok-account" : "api-key";
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
  /** Voice names a credential said it does not know, and when (#5179,
   * M-20261126-145): the next sentence goes to its default voice at once. */
  private readonly unknownVoices = new Map<string, number>();
  /** What a person was already told of a key of theirs (`untold`). */
  private readonly told = new Map<string, GrokVoiceFailure>();
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
    this.told.delete(this.id(who, candidate));
  }

  /** The refusals of `refusals` the person has a move to make on (credits,
   * the key itself) and was not told yet: a key that stays out of credits is
   * said once, at the first call that had to go on over another key, not at
   * every call. It is said again when it is refused for another reason, or
   * after it served again (`forget`). Memory only: a restart says it once more. */
  untold(who: string, refusals: readonly VoiceKeyRefusal[]): VoiceKeyRefusal[] {
    return refusals.filter((refusal) => {
      if (!voiceKeyFailureIsFinal(refusal.failure)) return false;
      const id = this.id(who, refusal);
      if (this.told.get(id) === refusal.failure) return false;
      if (this.told.size >= 10_000) this.told.clear();
      this.told.set(id, refusal.failure);
      return true;
    });
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

  /** `candidate` said it does not know the voice `voice`. */
  rememberUnknownVoice(who: string, candidate: VoiceKeyRef, voice: string): void {
    if (this.unknownVoices.size >= 10_000) this.unknownVoices.clear();
    this.unknownVoices.set(`${this.id(who, candidate)}\u0000${voice}`, this.now());
  }

  /** True while `candidate` is known not to have the voice `voice`. */
  voiceUnknown(who: string, candidate: VoiceKeyRef, voice: string): boolean {
    const id = `${this.id(who, candidate)}\u0000${voice}`;
    const at = this.unknownVoices.get(id);
    if (at === undefined) return false;
    if (this.now() - at < this.ttl) return true;
    this.unknownVoices.delete(id);
    return false;
  }

  /** The candidates in the order to try them: the ones refused lately
   * last (they are still tried when nothing else serves), each with what
   * it was refused for. */
  order<C extends VoiceKeyCandidate = VoiceKeyCandidate>(who: string, keys: readonly C[]): Array<{ candidate: C; refused: GrokVoiceFailure | null }> {
    const all = keys.map((candidate) => ({ candidate, refused: this.failure(who, voiceKeyRef(candidate)) }));
    return [...all.filter((entry) => !entry.refused), ...all.filter((entry) => entry.refused)];
  }
}

export interface VoiceKeyAttempt<T, C extends VoiceKeyCandidate = VoiceKeyCandidate> {
  value: T;
  used: C;
  /** the keys of the same provider tried before, each with its refusal
   * (the page says it once: a key that gave way is never a silent switch) */
  skipped: VoiceKeyRefusal[];
  /** the providers that failed before this one: a silent fallback, noted
   * in the thread's Events lens */
  fellBack: VoiceKeyRefusal[];
}

/** `tried` in the person's own order, the order of `keys` (their
 * connected account first): the refusal memory may have tried the account
 * last, and the first entry must stay the credential closest to the person
 * (M-20261126-145). An entry `keys` does not hold keeps its place after them. */
export function inPersonOrder<T extends VoiceKeyRef>(tried: readonly T[], keys: readonly VoiceKeyRef[]): T[] {
  const same = (a: VoiceKeyRef, b: VoiceKeyRef) => a.source === b.source && a.last4 === b.last4 && candidateProvider(a) === candidateProvider(b);
  const rank = (entry: T) => {
    const at = keys.findIndex((key) => same(key, entry));
    return at < 0 ? keys.length : at;
  };
  return tried.map((entry, at) => ({ entry, at, rank: rank(entry) })).sort((a, b) => a.rank - b.rank || a.at - b.at).map(({ entry }) => entry);
}

/** A voice the provider does not know is the name, never the credential
 * (#5179): the same credential is asked once more on its own default voice
 * (no name), for speech as for a call (M-20261126-145). */
export function retriesOnDefaultVoice(failure: GrokVoiceFailure, asked: string | undefined): boolean {
  return failure === "voice" && Boolean(asked);
}

/** The one log line of a credential asked back on its own default voice. */
export function defaultVoiceLine(candidate: VoiceKeyRef, voice: string, tag = "voice-mode"): string {
  return `[${tag}] the ${describeVoiceKey(candidate)} does not know the voice "${voice}": asking it back on its own default voice`;
}

/** Speak with the voice `asked` on `candidate`, or at once on the provider's
 * own default voice when that credential said lately it does not know the
 * name. A refusal of the name asks the same credential back on its default;
 * once the default spoke, the name is remembered for the next sentences (a
 * default refused too proves the address, never the name, #5427 review). Any
 * other failure goes to the caller (withVoiceKeys moves on as before). */
export async function speakOnKnownVoice<T>(
  who: string,
  candidate: VoiceKeyCandidate,
  asked: string | undefined,
  refusals: VoiceKeyRefusals,
  speak: (voice: string | undefined) => Promise<T>,
  log?: (line: string) => void,
): Promise<T> {
  const voice = asked && refusals.voiceUnknown(who, voiceKeyRef(candidate), asked) ? undefined : asked;
  try {
    return await speak(voice);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    const message = error instanceof Error ? error.message : String(error);
    if (!voice || !retriesOnDefaultVoice(grokVoiceFailure(message), voice)) throw error;
    log?.(defaultVoiceLine(candidate, voice));
    const spoken = await speak(undefined);
    refusals.rememberUnknownVoice(who, voiceKeyRef(candidate), voice);
    return spoken;
  }
}

/** The next credential when another one can fix `failure` (credits, the
 * credential itself), else nowhere. The first half of the rule below, and
 * the whole rule of an aspect that has one provider per request: an image
 * goes on from a dry Grok account to the person's key, then the
 * organization's (D-20261123-053), and stays where it is on an outage. */
export function nextKeyIndex(ordered: readonly unknown[], i: number, failure: GrokVoiceFailure): number {
  return voiceKeyFailureIsFinal(failure) && i + 1 < ordered.length ? i + 1 : -1;
}

/** Where to go after `candidate` failed with `failure`: the next key of the
 * same provider when another key can fix it (credits, the key itself),
 * else the first key of another provider (2026-10-29: a provider that
 * fails or reaches its limit gives way to the next one), else nowhere. */
export function nextCandidateIndex(ordered: readonly VoiceKeyCandidate[], i: number, failure: GrokVoiceFailure): number {
  const provider = candidateProvider(ordered[i]!);
  const key = nextKeyIndex(ordered, i, failure);
  if (key >= 0) return key;
  const other = ordered.findIndex((candidate, at) => at > i && candidateProvider(candidate) !== provider);
  return other;
}

/** What to say to the person when no credential took the call (#5179).
 *
 * The credential closest to them wins, as everywhere in this order
 * (D-20261120-012): their own refusal is the one they can act on. A voice the
 * provider does not know is never relabelled as another credential's credits,
 * and another credential's credits are never called an unknown voice: the two
 * refusals used to arrive in one fallback chain and the person heard one
 * generic "the voice service did not answer" for both.
 *
 * `tried` is in the person's own order (inPersonOrder), so its first entry
 * is the credential closest to the person. */
export type VoiceCallCause = "voice" | "credits" | "key" | "other";

export function voiceFailureCause(tried: readonly VoiceKeyRefusal[]): VoiceCallCause {
  if (!tried.length) return "other";
  if (tried[0]!.failure === "voice") return "voice";
  // behind it, a voice name is a detail of the voice settings, not the cause
  const rest = tried.filter((entry) => entry.failure !== "voice");
  const considered = rest.length ? rest : tried;
  if (considered.every((entry) => entry.failure === "key")) return "key";
  if (considered.some((entry) => entry.failure === "quota") && considered.every((entry) => entry.failure === "quota" || entry.failure === "key")) return "credits";
  return "other";
}

/** xAI failed the request on `used`, after `tried` (every key refused on
 * the way, `used` included, in the person's own order); `final` when another
 * key could have fixed it (credits, the key itself) and none was left. */
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
export async function withVoiceKeys<T, C extends VoiceKeyCandidate = VoiceKeyCandidate>(
  who: string,
  keys: readonly C[],
  refusals: VoiceKeyRefusals,
  attempt: (candidate: C) => Promise<T>,
  options: {
    log?(line: string): void; what?: string; scrub?(message: string): string;
    /** How this aspect reads its own error (an image error carries its cause);
     * the voice reading of the message when absent. */
    failure?(error: unknown, message: string): GrokVoiceFailure;
    /** Where to go next: `nextCandidateIndex` when absent. */
    next?(ordered: readonly C[], i: number, failure: GrokVoiceFailure): number;
  } = {},
): Promise<VoiceKeyAttempt<T, C>> {
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
      const failure = options.failure ? options.failure(error, message) : grokVoiceFailure(message);
      const refusal: VoiceKeyRefusal = { ...voiceKeyRef(candidate), failure };
      const next = (options.next ?? nextCandidateIndex)(ordered, i, failure);
      if (voiceKeyFailureIsFinal(failure)) refusals.remember(who, voiceKeyRef(candidate), failure);
      else if (next >= 0) refusals.remember(who, voiceKeyRef(candidate), failure, VOICE_PROVIDER_REFUSAL_TTL_MS);
      if (next < 0) throw new VoiceKeyFailure(message, candidate, failure, inPersonOrder([...skipped, refusal], keys));
      skipped.push(refusal);
      if (candidateProvider(ordered[next]!) !== candidateProvider(candidate)) fellBack.push(refusal);
      options.log?.(`[voice-mode] ${providerName(candidate)} ${options.what ?? "request"} refused the ${describeVoiceKey(candidate)} (${failure}): trying the ${describeVoiceKey(ordered[next]!)}`);
      i = next;
    }
  }
  throw new Error("no voice key");
}

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
export function providerFailureBody(message: string, keys?: VoiceProviderKeys, plain?: string | null, lead?: VoiceKeyRefusal): { error: string; code: "voice_provider" | "out_of_credits"; failure: GrokVoiceFailure; out_of_credits?: true; key?: VoiceKeyInfo; tried?: VoiceKeyRefusal[] } {
  // `lead`: the first real cause of a failed chain, which the card and the
  // bar name instead of the last refusal (M-20261126-145)
  const failure = lead?.failure ?? grokVoiceFailure(message);
  const credits = failure === "quota";
  return {
    error: plain || message,
    code: credits ? "out_of_credits" : "voice_provider",
    failure,
    ...(credits ? { out_of_credits: true as const } : {}),
    ...(keys ? { key: lead ? voiceKeyRef(lead) : keys.key, ...(keys.tried && keys.tried.length > 1 ? { tried: keys.tried } : {}) } : {}),
  };
}

/** A chain where no credential served, as the page gets it: when its
 * refusals are not all xAI credits or keys, the first real cause (the
 * credential closest to the person, `tried` in their order) leads the
 * sentence, the key and the kind, and the others follow in one line
 * (chainCallReason, M-20261126-145); otherwise the sentences of #4567 and
 * the last refusal, as before. */
export function chainFailureBody(message: string, used: VoiceKeyCandidate, tried: VoiceKeyRefusal[], words: NoCallLanguage) {
  const chain = chainCallReason(tried, words);
  const keys = { key: voiceKeyRef(used), tried };
  return chain ? providerFailureBody(message, keys, chain, tried[0]) : providerFailureBody(message, keys, noCallReason(tried, words));
}

export function providerName(candidate: { provider?: VoiceProviderId }): string {
  return VOICE_PROVIDER_LABELS[candidateProvider(candidate)];
}

/** A key for the log: its source and last four characters, never more. */
export function describeVoiceKey(candidate: VoiceKeyRef): string {
  const name = candidate.source === "grok-account" ? "connected Grok account"
    : candidate.source === "voice-key" ? "person's voice key"
      : candidate.source === "perspicax-key" ? "person's Perspicax key"
        : candidate.source === "org-account" ? "organization's Grok account"
          : candidate.source === "org-key" ? "organization's key" : "server's key";
  const named = candidateProvider(candidate) === "xai" ? name : `${name} (${providerName(candidate)})`;
  return candidate.last4 ? `${named} ···${candidate.last4}` : named;
}
