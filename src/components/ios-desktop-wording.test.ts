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

// #4097: the desktop's shortcut labels became short words with a grey hint.
// The iPad sheet shows both (no precision lost), and the iPad's own buttons
// and menu items that once borrowed the long sentences keep their full
// action wording under their own keys.
describe("iPad keyboard shortcuts sheet (#4097)", () => {
  const sheet = readFileSync(join(root, "ios", "App", "Desktop", "DesktopShortcuts.swift"), "utf8");

  it("gives every row the desktop's grey hint when the desktop has one", async () => {
    const { SHORTCUT_GROUPS } = await import("@/lib/keyboard-shortcuts");
    const hinted = new Set([...sheet.matchAll(/hinted\("([\w-]+)"/g)].map((match) => match[1]));
    const desktopHinted = SHORTCUT_GROUPS.flatMap((group) => group.items)
      .filter((item) => item.hint !== undefined && !["settings", "zoom", "full-screen"].includes(item.id))
      .map((item) => item.id);
    expect(desktopHinted.length).toBeGreaterThan(0);
    for (const id of desktopHinted) expect(hinted.has(id), `${id} has its hint on the iPad`).toBe(true);
    // the new-line chord is the Send row's hint there too
    expect(sheet).toContain('text("shortcuts.hint.sendNewLine")');
    for (const key of ["shortcuts.hint.dictate", "shortcuts.hint.closePanel", "shortcuts.hint.sendNewLine"]) {
      expect(map[key], `${key} is copied to the iPad`).toBe(key);
    }
  });

  it("keeps the full wording of the iPad's own sidebar button, menu items and find button", () => {
    for (const [label, fr] of [
      ["Collapse or expand the sidebar", "Replier ou déplier la barre latérale"],
      ["Go to the message field", "Aller au champ du message"],
      ["Find in conversation", "Chercher dans la conversation"],
      ["Search conversations and messages", "Rechercher dans les conversations et les messages"],
      ["Create a group chat", "Créer une discussion de groupe"],
      ["Quote the selected text in the message", "Citer le texte sélectionné dans le message"],
      ["Dictate into the message field (again to stop)", "Dicter dans le champ du message (encore une fois pour arrêter)"],
    ] as const) {
      expect(map[label], `${label} is not tied to a short shortcut label`).toBeUndefined();
      const entry = catalog.strings[label];
      expect(entry?.localizations?.en?.stringUnit?.value ?? label, `${label} (en)`).toBe(label);
      expect(entry?.localizations?.fr?.stringUnit?.value, `${label} (fr)`).toBe(fr);
    }
  });
});
