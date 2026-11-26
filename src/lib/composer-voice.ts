// The chat bar's one voice button (owner 2026-11-25, M-20261125-071,
// M-20261125-072, #5372): dictation and the voice conversation are one
// button. A click starts the mode the person kept; the button's arrow opens
// a menu that chooses between the two, then the microphone and the
// dictation's language. Both choices are preferences of the person: kept in
// localStorage and, on an organization server, following the person
// (shared/user-preferences.ts); a bot changes them through the settings tool
// (shared/settings-actions.ts, models.composerVoiceMode, models.dictationLanguage).
import { VOICE_MODE_LANGUAGES, type VoiceModeLanguage } from "../../shared/voice-mode";
import { localChoice } from "./local-choice";

export const COMPOSER_VOICE_MODE_KEY = "sagax.composerVoiceMode.v1";
export const COMPOSER_VOICE_MODES = ["dictation", "conversation"] as const;
export type ComposerVoiceMode = (typeof COMPOSER_VOICE_MODES)[number];

/** Dictation until the person chooses the voice conversation (an agent's
 * choice: the owner's mock-up draws the mic). */
const voiceModeChoice = localChoice<ComposerVoiceMode>(COMPOSER_VOICE_MODE_KEY, COMPOSER_VOICE_MODES, "dictation");

export function parseComposerVoiceMode(value: string | null | undefined): ComposerVoiceMode {
  return value === "conversation" ? "conversation" : "dictation";
}

export function setComposerVoiceMode(next: ComposerVoiceMode): void {
  voiceModeChoice.set(next);
}

/** The mode kept, followed live (this window, another window, a bot, another device). */
export function useComposerVoiceMode(): ComposerVoiceMode {
  return voiceModeChoice.use();
}

/** The mode the button shows: the one kept, or dictation where a voice
 * conversation cannot start (a group). The stored choice is not rewritten. */
export function shownVoiceMode(kept: ComposerVoiceMode, can: { conversation: boolean }): ComposerVoiceMode {
  return kept === "conversation" && !can.conversation ? "dictation" : kept;
}

export const DICTATION_LANGUAGE_KEY = "sagax.dictationLanguage.v1";
const LANGUAGE_CODES = VOICE_MODE_LANGUAGES.map((language) => language.code);

/** "auto" (the language is detected, as before this setting) until the person chooses one. */
const dictationLanguageChoice = localChoice<string>(DICTATION_LANGUAGE_KEY, LANGUAGE_CODES, "auto");

export function parseDictationLanguage(value: string | null | undefined): string {
  return typeof value === "string" && LANGUAGE_CODES.includes(value) ? value : "auto";
}

export function readDictationLanguage(): string {
  return dictationLanguageChoice.get();
}

export function setDictationLanguage(next: string): void {
  dictationLanguageChoice.set(parseDictationLanguage(next));
}

export function useDictationLanguage(): string {
  return dictationLanguageChoice.use();
}

/** Auto-detect, then the languages voice mode offers (one list, shared/voice-mode.ts). */
export function dictationLanguageOptions(): readonly VoiceModeLanguage[] {
  return VOICE_MODE_LANGUAGES;
}
