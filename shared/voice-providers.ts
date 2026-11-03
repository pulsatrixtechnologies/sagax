// Which provider hears and which one speaks on a call, read aloud and in
// dictation (2026-10-29). Shared by the renderer, the server and the iPhone
// (which reads the same synced preference, `omb.voiceMode.v1`).
//
// Roles:
//   - speech to text (STT): xAI or OpenAI
//   - the bot's voice (TTS): xAI, OpenAI or ElevenLabs
// The bot stays the brain in every combination: what is heard becomes an
// ordinary turn of the bot, and only the bot's own reply is spoken.
//
// A choice is per person (Settings > Voice) and per person and bot (Edit
// bot > Voice, `bots[botId]` of the same preference). "auto" takes the
// first provider the person has a key for, in VOICE_*_PROVIDERS order.
// Whatever the choice, a provider that fails or reaches its limit gives way
// to the next one the person has a key for (server/voice/voice-mode.ts), silently,
// with a line in the thread's Events lens.

export const VOICE_TTS_PROVIDERS = ["xai", "openai", "elevenlabs", "fish", "system", "chatterbox"] as const;
export const VOICE_STT_PROVIDERS = ["xai", "openai"] as const;
export type VoiceTtsProvider = (typeof VOICE_TTS_PROVIDERS)[number];
export type VoiceSttProvider = (typeof VOICE_STT_PROVIDERS)[number];
export type VoiceProviderId = VoiceTtsProvider | VoiceSttProvider;
export type VoiceTtsChoice = "auto" | VoiceTtsProvider;
export type VoiceSttChoice = "auto" | VoiceSttProvider;

export const VOICE_PROVIDER_LABELS: Record<VoiceProviderId, string> = {
  xai: "xAI",
  openai: "OpenAI",
  elevenlabs: "ElevenLabs",
  fish: "Fish Audio",
  system: "System voices",
  chatterbox: "Chatterbox",
};

/** OpenAI's built-in voices for /v1/audio/speech (gpt-4o-mini-tts). Marin
 * and Cedar are OpenAI's own recommendation for quality. */
export const OPENAI_TTS_VOICES = ["marin", "cedar", "alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer", "verse"] as const;
export const OPENAI_DEFAULT_VOICE = "marin";

/** A voice id as a provider lists it: short and plain (ElevenLabs ids are
 * 20 characters of letters and digits, OpenAI's are names). */
export const PROVIDER_VOICE_ID = /^[\w.-]{1,64}$/;

/** Installed voice names can contain spaces, accents and parentheses. */
export function isProviderVoiceId(provider: VoiceProviderId, value: string): boolean {
  return provider === "system" || provider === "chatterbox"
    ? value.length > 0 && value.length <= 128 && !/[\p{Cc},:]/u.test(value)
    : PROVIDER_VOICE_ID.test(value);
}

export function isVoiceTtsProvider(value: unknown): value is VoiceTtsProvider {
  return typeof value === "string" && (VOICE_TTS_PROVIDERS as readonly string[]).includes(value);
}

export function isVoiceSttProvider(value: unknown): value is VoiceSttProvider {
  return typeof value === "string" && (VOICE_STT_PROVIDERS as readonly string[]).includes(value);
}

export function cleanTtsChoice(value: unknown): VoiceTtsChoice | undefined {
  return value === "auto" || isVoiceTtsProvider(value) ? value : undefined;
}

export function cleanSttChoice(value: unknown): VoiceSttChoice | undefined {
  return value === "auto" || isVoiceSttProvider(value) ? value : undefined;
}

/** A voice per provider. xAI's lives in `VoiceModeSettings.voice` too (the
 * older field), kept in step. */
export type ProviderVoices = Partial<Record<VoiceTtsProvider, string>>;

export function cleanProviderVoices(value: unknown): ProviderVoices | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const out: ProviderVoices = {};
  for (const provider of VOICE_TTS_PROVIDERS) {
    const voice = (value as Record<string, unknown>)[provider];
    if (typeof voice === "string" && isProviderVoiceId(provider, voice)) out[provider] = voice;
  }
  return Object.keys(out).length ? out : undefined;
}

/** What one bot changes for this person: its own providers and voices. */
export interface BotVoiceChoice {
  tts?: VoiceTtsChoice;
  stt?: VoiceSttChoice;
  voices?: ProviderVoices;
}

/** At most this many bots keep a choice of their own (a preference stays small). */
export const MAX_BOT_VOICE_CHOICES = 200;
const BOT_ID = /^[\w-]{1,128}$/;

export function cleanBotVoiceChoices(value: unknown): Record<string, BotVoiceChoice> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const out: Record<string, BotVoiceChoice> = {};
  for (const [botId, raw] of Object.entries(value as Record<string, unknown>)) {
    if (Object.keys(out).length >= MAX_BOT_VOICE_CHOICES) break;
    if (!BOT_ID.test(botId) || !raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const record = raw as Record<string, unknown>;
    const tts = cleanTtsChoice(record.tts);
    const stt = cleanSttChoice(record.stt);
    const voices = cleanProviderVoices(record.voices);
    const choice: BotVoiceChoice = { ...(tts ? { tts } : {}), ...(stt ? { stt } : {}), ...(voices ? { voices } : {}) };
    if (Object.keys(choice).length) out[botId] = choice;
  }
  return Object.keys(out).length ? out : undefined;
}

/** The provider fields of a voice preference (see VoiceModeSettings). */
export interface VoiceProviderPreference {
  /** the person's xAI voice (VoiceModeSettings.voice) */
  voice?: string;
  tts?: VoiceTtsChoice;
  stt?: VoiceSttChoice;
  voices?: ProviderVoices;
  bots?: Record<string, BotVoiceChoice>;
}

/** What a request for this bot asks for: the providers in the person's
 * order and a voice for each provider. */
export interface EffectiveVoiceChoice {
  tts: VoiceTtsChoice;
  stt: VoiceSttChoice;
  voices: ProviderVoices;
}

/** The person's choice for one bot: the bot's own choice first, then the
 * person's, then "auto". */
export function effectiveVoiceChoice(preference: VoiceProviderPreference, botId?: string): EffectiveVoiceChoice {
  const bot = botId ? preference.bots?.[botId] : undefined;
  const voices: ProviderVoices = { ...(preference.voice ? { xai: preference.voice } : {}), ...preference.voices, ...bot?.voices };
  return {
    tts: bot?.tts ?? preference.tts ?? "auto",
    stt: bot?.stt ?? preference.stt ?? "auto",
    voices,
  };
}

/** The providers to try, in order: the chosen one first, then every other
 * available one in the default order. `available` lists the providers the
 * person has a key for. */
export function providerOrder<P extends string>(choice: "auto" | P, available: readonly P[], defaults: readonly P[]): P[] {
  const ordered = defaults.filter((provider) => available.includes(provider));
  if (choice === "auto" || !ordered.includes(choice)) return ordered;
  return [choice, ...ordered.filter((provider) => provider !== choice)];
}

/** `voices` as a URL parameter (a live call's sockets): `xai:eve,openai:marin`. */
export function encodeProviderVoices(voices: ProviderVoices): string {
  return VOICE_TTS_PROVIDERS.flatMap((provider) => (voices[provider] ? [`${provider}:${voices[provider]}`] : [])).join(",");
}

export function decodeProviderVoices(value: string | null | undefined): ProviderVoices | undefined {
  if (!value) return undefined;
  const record: Record<string, string> = {};
  for (const part of value.split(",").slice(0, VOICE_TTS_PROVIDERS.length)) {
    const at = part.indexOf(":");
    if (at > 0) record[part.slice(0, at)] = part.slice(at + 1);
  }
  return cleanProviderVoices(record);
}
