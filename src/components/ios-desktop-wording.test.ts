// The iPad's desktop shell says what the desktop says: every label listed in
// ios/parity/desktop-wording.json carries, in ios/App/Localizable.xcstrings,
// the desktop catalog's own words in English and French (2026-11-03, iPad
// 1:1 audit). A desktop rewording then fails here until the iPad follows.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..", "..");
const read = (...path: string[]) => JSON.parse(readFileSync(join(root, ...path), "utf8"));
const map = read("ios", "parity", "desktop-wording.json") as Record<string, string>;
const catalog = read("ios", "App", "Localizable.xcstrings") as {
  strings: Record<string, { localizations?: Record<string, { stringUnit?: { value?: string } }> }>;
};
const desktop = { en: read("src", "locales", "en.json"), fr: read("src", "locales", "fr.json") } as Record<string, Record<string, string>>;
const placeholders = (value: string) => value.replace(/\{\w+\}/g, "%@");

describe("iPad desktop shell wording", () => {
  for (const [key, desktopKey] of Object.entries(map)) {
    if (key === "//") continue;
    it(`${key} = ${desktopKey}`, () => {
      const entry = catalog.strings[key];
      expect(entry, `${key} is in Localizable.xcstrings`).toBeDefined();
      for (const lang of ["en", "fr"] as const) {
        const want = desktop[lang]![desktopKey];
        expect(want, `${desktopKey} in src/locales/${lang}.json`).toBeTypeOf("string");
        // English falls back to the key itself when the catalog has no en entry
        const got = entry?.localizations?.[lang]?.stringUnit?.value ?? (lang === "en" ? key : undefined);
        expect(got, `${key} (${lang})`).toBe(placeholders(want!));
      }
    });
  }
});
