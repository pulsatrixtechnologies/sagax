// The first message a new bot says (store.createBot), in its person's
// language (#1075). Server text a person reads, so it follows their language
// preference like the rest of the app: French or English.

/** The language a new bot greets in: the first level that names one (on an
 * organization server the person's own `omb-language`, then the server's
 * language setting). Empty everywhere: English, as before. */
export function greetingLanguage(levels: readonly (string | null | undefined)[]): "fr" | "en" {
  for (const level of levels) {
    const tag = level?.trim().toLowerCase();
    if (!tag) continue;
    return tag.startsWith("fr") ? "fr" : "en";
  }
  return "en";
}

export function newBotGreeting(name: string, language: "fr" | "en"): string {
  return language === "fr"
    ? `Bonjour, je suis ${name}. Que puis-je faire pour vous ?`
    : `Hi, I'm ${name}. What would you like me to do?`;
}
