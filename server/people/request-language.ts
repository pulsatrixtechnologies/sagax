// The language a person's app last asked in, for a person with no saved
// `omb-language` (#2803, #2805). The web app, a hosted server or a member of a
// Perspicax org who never picked a language follows the browser: the server
// cannot see that choice, but every request carries it (the app's own
// `x-sagax-locale`, else the browser's Accept-Language). A greeting, an intro
// card or a routine card written for that person then reads in the language
// their screen shows, instead of the server default. Memory only: a saved
// preference always wins, and a restart waits for the next request.

/** The header the app sends with its active locale on every API call. */
export const LOCALE_HEADER = "x-sagax-locale";

const LANGUAGE = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i;

/** The request's language: the app's header, else the first Accept-Language
 * entry. Null when neither names a language ("*", empty, garbage). */
export function requestLanguage(headers: Record<string, string | string[] | undefined>): string | null {
  const pick = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";
  const app = pick(headers[LOCALE_HEADER]).trim();
  if (LANGUAGE.test(app)) return app;
  const first = pick(headers["accept-language"]).split(",")[0]?.split(";")[0]?.trim() ?? "";
  return LANGUAGE.test(first) ? first : null;
}

/** The last request language per person ("" is the single local person). */
export class RequestLanguages {
  private readonly byPerson = new Map<string, string>();
  constructor(private readonly limit = 5000) {}

  note(person: string | null | undefined, language: string | null): void {
    if (!language) return;
    const key = person ?? "";
    if (this.byPerson.get(key) === language) return;
    this.byPerson.delete(key);
    this.byPerson.set(key, language);
    if (this.byPerson.size > this.limit) this.byPerson.delete(this.byPerson.keys().next().value!);
  }

  of(person: string | null | undefined): string | undefined {
    return this.byPerson.get(person ?? "");
  }
}
