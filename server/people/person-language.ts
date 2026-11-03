// The language a person reads the app in, as the server must pick it when it
// words a text for them (an email draft card, the instruction posted into
// their chat, an image refusal). It is the person's own `omb-language`
// preference, never the server's `cfg.language`, which is only the default
// for someone who has not chosen. An empty or missing choice (follow the
// system) falls back to the server's default too: the server cannot see the
// person's system.

export function personLanguage(preference: unknown, serverDefault: string | undefined): string {
  if (typeof preference === "string" && preference.trim()) return preference.trim();
  return serverDefault ?? "";
}

/** The language of a person named by id: their saved `omb-language`, read
 * through `preferences`, else the server default. A store that throws or a
 * missing person gives the default too. Used for a push and for the rule
 * text after "Always allow", which a phone shows as the server sent it. */
export function personLanguageOf(
  person: string | null | undefined,
  preferences: (person: string) => Record<string, unknown> | undefined,
  serverDefault: string | undefined,
): string {
  let preference: unknown;
  try {
    if (person) preference = preferences(person)?.["omb-language"];
  } catch { /* the server default */ }
  return personLanguage(preference, serverDefault);
}
