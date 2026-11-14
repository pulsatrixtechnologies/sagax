// Voice mode (the floating voice bar): what a person picks for the voice
// that reads a bot's answers and the language they speak, shared by the
// renderer (src/lib/voice-mode/) and the server (server/voice/voice-mode.ts).
//
// xAI does the voice: speech to text (POST /v1/stt) and text to speech
// (POST /v1/tts). The bot stays the brain: what the person says is sent to
// the bot as an ordinary message, and the bot's answer is read back.
// Sources: https://docs.x.ai/developers/model-capabilities/audio/speech-to-text
// and https://docs.x.ai/developers/model-capabilities/audio/text-to-speech
// Since 2026-10-29 OpenAI may hear and OpenAI or ElevenLabs may speak too
// (shared/voice-providers.ts); the routes and the settings stay the same.
import {
  cleanBotVoiceChoices,
  cleanProviderVoices,
  cleanSttChoice,
  cleanTtsChoice,
  effectiveVoiceChoice,
  isProviderVoiceId,
  isVoiceTtsProvider,
  spokenVoice,
  type BotVoiceChoice,
  type ProviderVoices,
  type VoiceProviderId,
  type VoiceSttChoice,
  type VoiceSttProvider,
  type VoiceTtsChoice,
  type VoiceTtsProvider,
} from "./voice-providers.ts";

/** localStorage key; travels with the person on an organization server
 * (shared/user-preferences.ts). */
export const VOICE_MODE_STORAGE_KEY = "omb.voiceMode.v1";

/** xAI accepts a speed multiplier from 0.7 to 1.5 (TTS `speed`). */
export const VOICE_MODE_SPEEDS = [0.75, 1, 1.25, 1.5] as const;
export const VOICE_MODE_MIN_SPEED = 0.7;
export const VOICE_MODE_MAX_SPEED = 1.5;

/** The longest text one speak request takes (the client sends utterances). */
export const VOICE_MODE_MAX_TEXT = 500;
/** The largest recorded turn (16 kHz mono 16-bit WAV: about 60 s). */
export const VOICE_MODE_MAX_AUDIO_BYTES = 2 * 1024 * 1024;

export interface VoiceModeLanguage {
  /** BCP-47 code as xAI takes it, or "auto". */
  code: string;
  label: string;
}

/** The languages the panel offers, in the order of the reference design. */
export const VOICE_MODE_LANGUAGES: readonly VoiceModeLanguage[] = [
  { code: "auto", label: "Auto-detect" },
  { code: "en", label: "English" },
  { code: "ar-EG", label: "Arabic (Egypt)" },
  { code: "ar-SA", label: "Arabic (Saudi Arabia)" },
  { code: "ar-AE", label: "Arabic (UAE)" },
  { code: "bn", label: "Bengali" },
  { code: "ca", label: "Catalan" },
  { code: "zh", label: "Chinese (Simplified)" },
  { code: "cs", label: "Czech" },
  { code: "da", label: "Danish" },
  { code: "nl", label: "Dutch" },
  { code: "fil", label: "Filipino" },
  { code: "fi", label: "Finnish" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "hi", label: "Hindi" },
  { code: "id", label: "Indonesian" },
  { code: "it", label: "Italian" },
  { code: "ja", label: "Japanese" },
  { code: "ko", label: "Korean" },
  { code: "ms", label: "Malay" },
  { code: "fa", label: "Persian" },
  { code: "pl", label: "Polish" },
  { code: "pt-BR", label: "Portuguese (Brazil)" },
  { code: "pt-PT", label: "Portuguese (Portugal)" },
  { code: "ro", label: "Romanian" },
  { code: "ru", label: "Russian" },
  { code: "es-MX", label: "Spanish (Mexico)" },
  { code: "es-ES", label: "Spanish (Spain)" },
  { code: "sv", label: "Swedish" },
  { code: "th", label: "Thai" },
  { code: "tr", label: "Turkish" },
  { code: "vi", label: "Vietnamese" },
];

const LANGUAGE_CODES: ReadonlySet<string> = new Set(VOICE_MODE_LANGUAGES.map((language) => language.code));

/** Languages xAI text to speech takes as `language` (else "auto"). */
const TTS_LANGUAGES: ReadonlySet<string> = new Set([
  "en", "ar-EG", "ar-SA", "ar-AE", "bn", "zh", "fr", "de", "hi", "id", "it", "ja", "ko",
  "pt-BR", "pt-PT", "ru", "es-MX", "es-ES", "tr", "vi",
]);

/** Languages xAI speech to text takes as `language` (else detected). */
const STT_LANGUAGES: ReadonlySet<string> = new Set([
  "ar", "cs", "da", "nl", "en", "fil", "fr", "de", "hi", "id", "it", "ja", "ko", "mk", "ms",
  "fa", "pl", "pt", "ro", "ru", "es", "sv", "th", "tr", "vi",
]);

export function isVoiceModeLanguage(code: unknown): code is string {
  return typeof code === "string" && LANGUAGE_CODES.has(code);
}

/** The TTS `language` for a picked language: itself when xAI speaks it.
 * A French region (`fr-CA`) speaks as `fr`. Anything else is "auto". */
export function ttsLanguage(code: string): string {
  if (TTS_LANGUAGES.has(code)) return code;
  const base = code.split("-")[0]!.toLowerCase();
  if (base === "fr") return "fr";
  return "auto";
}

/** The STT `language` hint for a picked language, or undefined (detect). */
export function sttLanguage(code: string): string | undefined {
  if (code === "auto") return undefined;
  const base = code.split("-")[0]!.toLowerCase();
  return STT_LANGUAGES.has(base) ? base : undefined;
}

/** Languages xAI formats (`format`, inverse text normalization: "deux
 * cents" as 200). It needs a language. */
const FORMAT_LANGUAGES: ReadonlySet<string> = new Set(["en", "fr"]);

/** A BCP-47 tag as a browser reports it (`navigator.language`), or undefined.
 * The page sends it beside the language so the server can read "auto" on a
 * French computer as French; the server keeps only a well formed one. */
export function cleanVoiceLocale(input: unknown): string | undefined {
  if (typeof input !== "string" || input.length > 35) return undefined;
  return /^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8}){0,3}$/.test(input) ? input : undefined;
}

/** What the server asks xAI speech to text for: a language and
 * formatting. "auto" on a French locale (fr-CA, fr-FR...) is French with
 * formatting, so a Québec speaker gets the French turn waits and "deux
 * cents" written 200; an explicit language gets formatting where xAI
 * offers it; anything else stays pure detection. */
export function sttRequest(code: string, locale?: string): { language?: string; format: boolean } {
  const language = sttLanguage(code);
  if (language) return { language, format: FORMAT_LANGUAGES.has(language) };
  if (code === "auto" && cleanVoiceLocale(locale)?.split("-")[0]!.toLowerCase() === "fr") return { language: "fr", format: true };
  return { format: false };
}

/** Hesitation sounds xAI writes when asked to keep them (`filler_words`). */
const FILLER_WORDS = ["euh", "euhm", "heu", "hum", "uh", "uhm", "um", "umm", "erm", "er", "hmm", "hm", "mm", "mmm"];
const FILLER = new RegExp(`(^|[\\s,;.!?\u2026])(?:${FILLER_WORDS.join("|")})(?:[.\u2026]+|,)?(?=$|[\\s,;.!?\u2026])`, "giu");

/** The words without hesitation sounds: what a bot reads of a turn. The
 * turn detector still sees them (a trailing "euh" is a person thinking). */
export function stripFillers(text: string): string {
  const trimmed = text.trim();
  let out = trimmed;
  // twice: "euh euh" overlaps the separator the first match took
  for (let i = 0; i < 2; i++) out = out.replace(FILLER, "$1");
  out = out.replace(/\s+([,;.!?\u2026])/g, "$1").replace(/(^|\s)[,;]+(?=\s|$)/g, "$1").replace(/\s{2,}/g, " ").replace(/^[\s,;.\u2026]+/, "").trim();
  // a line that started with a capital keeps one
  if (out && /^\p{Lu}/u.test(trimmed) && !/^\p{Lu}/u.test(out)) out = out[0]!.toUpperCase() + out.slice(1);
  return out;
}

export interface VoiceModeSettings {
  /** An xAI voice id; "" is Not set (xAI's default voice). */
  voice: string;
  speed: number;
  language: string;
  /** Who speaks and who hears (shared/voice-providers.ts, 2026-10-29).
   * Absent is "auto". */
  tts?: VoiceTtsChoice;
  stt?: VoiceSttChoice;
  /** The voice picked for OpenAI and ElevenLabs (xAI's is `voice`). */
  voices?: ProviderVoices;
  /** A bot's own providers and voices, for this person (Edit bot > Voice). */
  bots?: Record<string, BotVoiceChoice>;
}

export const DEFAULT_VOICE_MODE_SETTINGS: VoiceModeSettings = { voice: "", speed: 1, language: "auto" };

/** One-time seed for an installation's older voice choice. A saved personal
 * preference always wins. Keys stay in the provider store. */
export function installedVoiceSettings(tts: { provider?: string; voice?: string } | undefined, bots: ReadonlyArray<{ id: string; voice?: string }> = []): VoiceModeSettings {
  const provider = isVoiceTtsProvider(tts?.provider) ? tts.provider : "elevenlabs";
  const voices = tts?.voice && isProviderVoiceId(provider, tts.voice) ? { [provider]: tts.voice } : {};
  return cleanVoiceModeSettings({
    ...DEFAULT_VOICE_MODE_SETTINGS, tts: provider,
    ...(provider === "xai" ? { voice: voices.xai ?? "" } : { voices }),
    bots: Object.fromEntries(bots.filter((bot) => bot.voice && isProviderVoiceId(provider, bot.voice)).map((bot) => [bot.id, { tts: provider, voices: { [provider]: bot.voice } }])),
  });
}

/** A voice id as xAI lists them (GET /v1/tts/voices): short and plain. */
export const VOICE_ID = /^[\w.-]{1,64}$/;

/** Keep what is valid, default the rest. Never throws. */
export function cleanVoiceModeSettings(input: unknown): VoiceModeSettings {
  const record = input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
  const voice = typeof record.voice === "string" && (record.voice === "" || VOICE_ID.test(record.voice)) ? record.voice : DEFAULT_VOICE_MODE_SETTINGS.voice;
  const speed = typeof record.speed === "number" && Number.isFinite(record.speed) && record.speed >= VOICE_MODE_MIN_SPEED && record.speed <= VOICE_MODE_MAX_SPEED
    ? record.speed
    : DEFAULT_VOICE_MODE_SETTINGS.speed;
  const language = isVoiceModeLanguage(record.language) ? record.language : DEFAULT_VOICE_MODE_SETTINGS.language;
  const tts = cleanTtsChoice(record.tts);
  const stt = cleanSttChoice(record.stt);
  const voices = cleanProviderVoices(record.voices);
  const bots = cleanBotVoiceChoices(record.bots);
  // "auto" is the default: kept out, so an untouched preference stays as it was
  return {
    voice, speed, language,
    ...(tts && tts !== "auto" ? { tts } : {}),
    ...(stt && stt !== "auto" ? { stt } : {}),
    ...(voices ? { voices } : {}),
    ...(bots ? { bots } : {}),
  };
}

/** A bot's effective voice for its owner (#4087): what a bot's console page
 * answers as `bot.speech`, so a phone line speaks with the voice set on the
 * bot. Every field is left out when empty: no xAI voice chosen (xAI's
 * default), the provider's default voice, or a language set to `auto`. */
export interface BotSpeech {
  /** the xAI realtime voice of the bot's effective choice (`voices.xai`) */
  xaiVoice?: string;
  /** the provider the bot speaks with: under "auto", the one the server
   * resolves for the owner (#4231), xAI when none is known */
  provider?: VoiceTtsProvider;
  /** that provider's voice id */
  voice?: string;
  /** the bot's voice language, else its owner's: a short code */
  language?: string;
  /** #4236: the bot's voice speed, else the person's (left out at 1) */
  speed?: number;
  /** #4236: the bot's persona and instructions text, line breaks kept, at
   * most BOT_SPEECH_PERSONA_MAX characters (left out when empty) */
  persona?: string;
}

/** The phone side cuts a persona text at 4000 characters too. */
export const BOT_SPEECH_PERSONA_MAX = 4_000;

const validSpeed = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= VOICE_MODE_MIN_SPEED && value <= VOICE_MODE_MAX_SPEED;

/** A persona text, line breaks kept, cut at `max` characters, never inside a character pair. */
function cappedPersona(text: unknown, max: number): string {
  if (typeof text !== "string") return "";
  const trimmed = text.replace(/\r\n?/g, "\n").trim();
  if (trimmed.length <= max) return trimmed;
  const last = trimmed.charCodeAt(max - 1);
  return trimmed.slice(0, last >= 0xd800 && last <= 0xdbff ? max - 1 : max).trimEnd();
}

/** `preference` is the owner's saved preference (VOICE_MODE_STORAGE_KEY, raw
 * or parsed), `botLanguage` the bot's own voice language (bot-profile.ts
 * `voiceLanguage`), which wins over the person's. The same rules as the
 * desktop (effectiveVoiceChoice, spokenVoice). #4236: with `bot`, its own
 * voice speed (`voiceSpeed`, which wins over the person's `speed`) and its
 * persona and instructions text (`soul`). #4231: `autoProvider` is the
 * provider the server resolves for the owner under "auto" (what the voice
 * providers route answers as `tts`), the one the app speaks with. */
export function botSpeech(
  preference: unknown,
  botId: string,
  botLanguage?: string,
  bot?: { voiceSpeed?: unknown; persona?: unknown },
  autoProvider?: VoiceTtsProvider,
): BotSpeech {
  let parsed = preference;
  if (typeof preference === "string") {
    try { parsed = JSON.parse(preference); } catch { parsed = null; }
  }
  const settings = cleanVoiceModeSettings(parsed);
  const choice = effectiveVoiceChoice(settings, botId);
  // under "auto" the app speaks with the provider the server resolves for
  // its person (useVoicePicker), and saves the bot's voice under it
  const auto = choice.tts === "auto" && isVoiceTtsProvider(autoProvider) ? autoProvider : undefined;
  const { provider, voice } = auto ? { provider: auto, voice: choice.voices[auto] ?? "" } : spokenVoice(choice);
  const xaiVoice = choice.voices.xai;
  const language = botLanguage !== undefined && isVoiceModeLanguage(botLanguage) ? botLanguage : settings.language;
  const speed = bot ? (validSpeed(bot.voiceSpeed) ? bot.voiceSpeed : settings.speed) : 1;
  const persona = bot ? cappedPersona(bot.persona, BOT_SPEECH_PERSONA_MAX) : "";
  return {
    ...(xaiVoice ? { xaiVoice } : {}),
    provider,
    ...(voice ? { voice } : {}),
    ...(language && language !== "auto" ? { language } : {}),
    ...(speed !== 1 ? { speed } : {}),
    ...(persona ? { persona } : {}),
  };
}

/** Why voice mode cannot run for this person: no xAI key serves them, or
 * their own access is turned off. */
export type VoiceModeRefusalCause = "no_credentials" | "payer_disabled" | "perspicax_unreachable" | "server_engine_not_allowed";

/** The id a person sheet's `sagax_server_engines` uses for voice mode on the
 * organization's xAI key (2026-10-16). */
export const VOICE_SERVER_ENGINE = "xaiVoice";
export const ELEVENLABS_VOICE_SERVER_ENGINE = "elevenlabsVoice";
export const FISH_VOICE_SERVER_ENGINE = "fishVoice";

/** Who pays for the voice: the person's own xAI key (in Perspicax), the
 * organization's key (Settings > Connections), or, on a solo server, the
 * server's key. */
export type VoiceModeVia = "speaker-key" | "org-key" | "server";

/** Where a key comes from (server/voice/voice-keys.ts, 2026-10-28): the person's
 * own voice key saved in Sagax (My voice keys), their own xAI key in
 * Perspicax, the organization's key, or a solo server's key. */
export type VoiceKeySource = "voice-key" | "perspicax-key" | "org-key" | "server";

/** Why xAI failed a voice request, as the server sorted it
 * (server/tts/grok.ts grokVoiceFailure): the key was rejected (`key`), no
 * credits (`quota`), rate limited (`busy`), unreachable or failing
 * (`down`), an unknown voice (`voice`), anything else (`other`). */
export type VoiceProviderFailure = "key" | "quota" | "busy" | "down" | "voice" | "other";

/** A key as the page may know it: its source and its last four characters
 * (as My voice keys shows them), never more. */
export interface VoiceKeyInfo {
  source: VoiceKeySource;
  last4: string | null;
  /** whose key: xAI when absent (an older server) */
  provider?: VoiceProviderId;
}

/** One key of the person's, with what xAI refused it for lately, if anything. */
export interface VoiceKeyState extends VoiceKeyInfo {
  refused?: VoiceProviderFailure;
}

export interface VoiceModeStatus {
  provider: "xai";
  available: boolean;
  /** 2026-11-02 (the maintainer): a call is a realtime voice session (xAI's Voice Agent
   * API, GET /voice/realtime), never text to speech. False or absent: no
   * call; the call button says to set up the realtime voice. */
  realtime?: boolean;
  /** An organization server: voice mode is the only call there (no
   * dictation helper, no "This computer"), so the client never falls back
   * on the legacy call gate. */
  organization?: boolean;
  via?: VoiceModeVia;
  /** the key the next request starts with */
  key?: VoiceKeyInfo;
  /** every key that may serve this person, in order, with the refusals
   * xAI gave lately (a refused key is tried last) */
  keys?: VoiceKeyState[];
  /** For the speaker only (the access card's audience); `admin` adds the
   * organization's key hint, as on every access card. */
  refusal?: { cause: VoiceModeRefusalCause; admin?: true; keysUrl?: string };
  /** The providers this person has a usable key for, in the default order
   * (2026-10-29). Only these are offered in the settings. */
  providers?: { tts: VoiceTtsProvider[]; stt: VoiceSttProvider[] };
  /** The provider the next request starts with, for this bot and person. */
  tts?: VoiceTtsProvider;
  stt?: VoiceSttProvider;
}
