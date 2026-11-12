// Voice mode settings (Voice, Speed, Language in the voice bar's panel).
// Kept in localStorage under VOICE_MODE_STORAGE_KEY; on an organization
// server that key travels with the person (shared/user-preferences.ts), so
// the same choice follows them from the Mac to Windows and back.
import { useSyncExternalStore } from "react";

import {
  DEFAULT_VOICE_MODE_SETTINGS,
  VOICE_MODE_LANGUAGES,
  VOICE_MODE_STORAGE_KEY,
  cleanVoiceModeSettings,
  installedVoiceSettings,
  type VoiceModeSettings,
} from "../../../shared/voice-mode";
import {
  effectiveVoiceChoice,
  spokenVoice,
  type BotVoiceChoice,
  type ProviderVoices,
  type VoiceSttChoice,
  type VoiceTtsChoice,
  type VoiceTtsProvider,
} from "../../../shared/voice-providers";

type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;

const watchers = new Set<() => void>();
let cached: { raw: string | null; value: VoiceModeSettings } | null = null;

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** The saved settings, cleaned (an unknown or broken value reads as the default). */
export function readVoiceModeSettings(store: Storage | null = storage()): VoiceModeSettings {
  let raw: string | null = null;
  try {
    raw = store?.getItem(VOICE_MODE_STORAGE_KEY) ?? null;
  } catch {
    raw = null;
  }
  if (cached && cached.raw === raw) return cached.value;
  let value = DEFAULT_VOICE_MODE_SETTINGS;
  if (raw) {
    try {
      value = cleanVoiceModeSettings(JSON.parse(raw));
    } catch {
      value = DEFAULT_VOICE_MODE_SETTINGS;
    }
  }
  cached = { raw, value };
  return value;
}

/** Save a change; the preference sync carries it to the server. */
export function writeVoiceModeSettings(patch: Partial<VoiceModeSettings>, store: Storage | null = storage()): VoiceModeSettings {
  const next = cleanVoiceModeSettings({ ...readVoiceModeSettings(store), ...patch });
  try {
    store?.setItem(VOICE_MODE_STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* storage refused: the choice lasts for this window only */
  }
  cached = null;
  for (const fn of Array.from(watchers)) fn();
  return next;
}

/** Preserve the solo installation and bot voices before retiring its old UI.
 * An existing choice, including Auto, is never overwritten. */
export function migrateInstalledVoiceSettings(tts: { provider?: string; voice?: string } | undefined, bots: ReadonlyArray<{ id: string; voice?: string }>, store: Storage | null = storage()): void {
  if (!tts || !store) return;
  try {
    if (store.getItem(VOICE_MODE_STORAGE_KEY) !== null) return;
    writeVoiceModeSettings(installedVoiceSettings(tts, bots), store);
  } catch { /* a refused storage remains usable through server defaults */ }
}

function subscribe(fn: () => void): () => void {
  watchers.add(fn);
  // another window, or the preference sync writing the server's value
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === VOICE_MODE_STORAGE_KEY) fn();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    watchers.delete(fn);
    window.removeEventListener("storage", onStorage);
  };
}

export function useVoiceModeSettings(): VoiceModeSettings {
  return useSyncExternalStore(subscribe, () => readVoiceModeSettings(), () => DEFAULT_VOICE_MODE_SETTINGS);
}

/** "1x", "1.25x" */
export function speedLabel(speed: number): string {
  return `${Number(speed.toFixed(2))}x`;
}

export function languageLabel(code: string): string {
  return VOICE_MODE_LANGUAGES.find((language) => language.code === code)?.label ?? code;
}

/** These settings as one bot speaks (2026-10-29): `voice` is the voice of
 * the provider this bot speaks with for this person, `tts` and `stt` its
 * providers (the bot's own choice first, then the person's, then Auto).
 * What every request to the server sends (api.ts). */
export type BotVoiceSettings = VoiceModeSettings & { tts: VoiceTtsChoice; stt: VoiceSttChoice; voices: ProviderVoices; forBot: string };

export function voiceSettingsForBot(settings: VoiceModeSettings, botId?: string): BotVoiceSettings {
  const view = settings as Partial<BotVoiceSettings>;
  // already this bot's view (a preview may have changed its voice): kept
  if (view.forBot !== undefined && view.forBot === (botId ?? "")) return settings as BotVoiceSettings;
  const choice = effectiveVoiceChoice(settings, botId);
  return { ...settings, tts: choice.tts, stt: choice.stt, voices: choice.voices, voice: spokenVoice(choice).voice, forBot: botId ?? "" };
}

/** Does this bot have its own providers for this person (Edit bot > Voice)? */
export function botHasOwnVoice(settings: VoiceModeSettings, botId: string): boolean {
  return Boolean(settings.bots?.[botId]);
}

/** Pick a voice for the provider this bot speaks with: in the bot's own
 * choice when it has one, else the person's (xAI's in `voice`). */
export function writeVoiceForBot(botId: string | undefined, voice: string, store: Storage | null = storage(), resolvedProvider?: VoiceTtsProvider): VoiceModeSettings {
  const settings = readVoiceModeSettings(store);
  const choice = effectiveVoiceChoice(settings, botId);
  const provider: VoiceTtsProvider = resolvedProvider ?? spokenVoice(choice).provider;
  const own = botId ? settings.bots?.[botId] : undefined;
  if (botId && own) {
    const voices = { ...own.voices, [provider]: voice || undefined };
    return writeVoiceModeSettings({ bots: { ...settings.bots, [botId]: { ...own, voices } } }, store);
  }
  if (provider === "xai") return writeVoiceModeSettings({ voice }, store);
  return writeVoiceModeSettings({ voices: { ...settings.voices, [provider]: voice || undefined } }, store);
}

/** Change the person's own providers (Settings > Voice). */
export function writeVoiceProviders(patch: { tts?: VoiceTtsChoice; stt?: VoiceSttChoice }, store: Storage | null = storage()): VoiceModeSettings {
  return writeVoiceModeSettings(patch, store);
}

/** Change one bot's own providers for this person (Edit bot > Voice);
 * `null` goes back to the person's settings. */
export function writeBotVoiceChoice(botId: string, patch: BotVoiceChoice | null, store: Storage | null = storage()): VoiceModeSettings {
  const settings = readVoiceModeSettings(store);
  const bots = { ...settings.bots };
  if (patch === null) delete bots[botId];
  else bots[botId] = { ...bots[botId], ...patch };
  return writeVoiceModeSettings({ bots }, store);
}
