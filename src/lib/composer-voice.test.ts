// @vitest-environment happy-dom
// The chat bar's one voice button (owner 2026-11-25, M-20261125-071,
// M-20261125-072, #5372): dictation and the voice conversation are one
// button; the mode a person used last is kept, per person, with the
// dictation's language.
import { describe, expect, it } from "vitest";

import { USER_PREFERENCE_KEYS } from "../../shared/user-preferences";
import { COMPOSER_VOICE_MODE_KEY, DICTATION_LANGUAGE_KEY, dictationLanguageOptions, noteVoiceModeUsed, parseComposerVoiceMode, parseDictationLanguage, readComposerVoiceMode, shownVoiceMode } from "./composer-voice";

describe("the voice button's mode", () => {
  it("is dictation until the person chooses the voice conversation", () => {
    expect(parseComposerVoiceMode(null)).toBe("dictation");
    expect(parseComposerVoiceMode("conversation")).toBe("conversation");
    expect(parseComposerVoiceMode("call")).toBe("dictation");
  });

  it("follows the person: both choices are preferences of the person", () => {
    expect(USER_PREFERENCE_KEYS).toContain(COMPOSER_VOICE_MODE_KEY);
    expect(USER_PREFERENCE_KEYS).toContain(DICTATION_LANGUAGE_KEY);
  });

  it("falls back to dictation where a voice conversation cannot start (a group), keeping the stored choice", () => {
    expect(shownVoiceMode("conversation", { conversation: false })).toBe("dictation");
    expect(shownVoiceMode("conversation", { conversation: true })).toBe("conversation");
    expect(shownVoiceMode("dictation", { conversation: true })).toBe("dictation");
  });
});

describe("the mode used last (D-20261126-006)", () => {
  it("a use is kept as the mode of the next click; before any use it is dictation", () => {
    localStorage.clear();
    expect(readComposerVoiceMode()).toBe("dictation");
    noteVoiceModeUsed("conversation");
    expect(readComposerVoiceMode()).toBe("conversation");
    expect(localStorage.getItem(COMPOSER_VOICE_MODE_KEY)).toBe("conversation");
    noteVoiceModeUsed("dictation");
    expect(readComposerVoiceMode()).toBe("dictation");
    localStorage.clear();
  });
});

describe("the dictation's language", () => {
  it("is detected until the person chooses one, and only a language speech to text takes is kept", () => {
    expect(parseDictationLanguage(null)).toBe("auto");
    expect(parseDictationLanguage("fr")).toBe("fr");
    expect(parseDictationLanguage("klingon")).toBe("auto");
  });

  it("offers Auto-detect first, then the languages voice mode offers", () => {
    const options = dictationLanguageOptions();
    expect(options[0]).toEqual({ code: "auto", label: "Auto-detect" });
    expect(options.map((option) => option.code)).toContain("fr");
    expect(new Set(options.map((option) => option.code)).size).toBe(options.length);
  });
});
