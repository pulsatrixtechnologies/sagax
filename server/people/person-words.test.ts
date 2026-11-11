import { describe, expect, it } from "vitest";
import en from "../../src/locales/en.json" with { type: "json" };
import fr from "../../src/locales/fr.json" with { type: "json" };
import { personLanguageCode, personWord } from "./person-words.ts";

describe("#3512: the words of a server-posted card come from the locale catalogs", () => {
  it("reads the person's language, French unless it names English", () => {
    expect(personLanguageCode("fr-CA")).toBe("fr");
    expect(personLanguageCode("en-US")).toBe("en");
    expect(personLanguageCode("")).toBe("fr");
    expect(personLanguageCode(undefined)).toBe("fr");
  });

  it("fills placeholders and falls back to English, then to the key", () => {
    expect(personWord("fr", "proactive.briefOffer.body", { time: "8 h 00" })).toBe((fr as Record<string, string>)["proactive.briefOffer.body"]!.replace("{time}", "8 h 00"));
    expect(personWord("en", "proactive.briefOffer.title")).toBe((en as Record<string, string>)["proactive.briefOffer.title"]);
    expect(personWord("fr", "no.such.key")).toBe("no.such.key");
  });

  it("the brief offer's words are in both catalogs, with no dash", () => {
    for (const key of ["proactive.briefOffer.title", "proactive.briefOffer.body", "proactive.briefOffer.yes", "proactive.briefOffer.notNow"]) {
      for (const catalog of [en, fr] as Array<Record<string, string>>) {
        expect(catalog[key], key).toBeTruthy();
        expect(catalog[key]).not.toMatch(/[–—]/);
      }
    }
  });
});
