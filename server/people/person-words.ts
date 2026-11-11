// The words of a card the server posts for a bot on its own (#3512), in the
// person's language, read from the app's locale catalogs (src/locales), so
// the server and the app say the same thing. On 2026-11-11 an offer card
// reached a French-speaking person with an English title: its words were
// written in code, and its language ignored the language the person's app
// asks in. The language comes from languageOfPerson (their saved
// preference, else the language their app asks in, else the server's).
import en from "../../src/locales/en.json" with { type: "json" };
import fr from "../../src/locales/fr.json" with { type: "json" };

export type PersonLanguage = "fr" | "en";

const CATALOGS: Readonly<Record<PersonLanguage, Readonly<Record<string, string>>>> = { en, fr };

/** fr or en from any language tag; French unless it names English (the
 * reach-me rule, server/index-leaves/reachMeLanguage.ts). */
export function personLanguageCode(tag: string | null | undefined): PersonLanguage {
  return (tag ?? "").trim().toLowerCase().startsWith("en") ? "en" : "fr";
}

/** One key of the catalogs in this language, `{name}` filled from `vars`;
 * the English text when the language lacks it, the key when both do. */
export function personWord(language: PersonLanguage, key: string, vars?: Readonly<Record<string, string | number>>): string {
  const text = CATALOGS[language][key] ?? CATALOGS.en[key] ?? key;
  return vars ? text.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match)) : text;
}
