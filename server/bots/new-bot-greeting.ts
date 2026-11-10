// The first message a new bot says (store.createBot), in its person's
// language (#1075). Server text a person reads, so it follows their language
// preference like the rest of the app: French or English.

import { introTaskCard } from "../intro-tour.ts";

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
    ? `Bonjour, je suis ${name}. Que puis-je faire pour toi ?`
    : `Hi, I'm ${name}. What would you like me to do?`;
}

interface SeedMessage {
  id: string;
  role?: string;
  kind?: string;
  text?: string;
  card?: unknown;
}

/** The first-run bot (store.seedIfEmpty) greets before any request has said
 * which language the person reads: on a web or hosted server with no saved
 * preference it greets in the server default (#2803). When the first request
 * names another language and the conversation is still exactly the untouched
 * greeting and intro card, say them again in that language. Anything else
 * (an answered card, a reply, another message) is left as it is. */
export function seedGreetingPatches(
  messages: readonly SeedMessage[],
  name: string,
  language: "fr" | "en",
): { greeting: { id: string; text: string }; card: { id: string; card: ReturnType<typeof introTaskCard>["card"] } } | null {
  if (messages.length !== 2) return null;
  const other = language === "fr" ? "en" : "fr";
  const [greeting, card] = messages as [SeedMessage, SeedMessage];
  if (greeting.role !== "bot" || greeting.kind !== "text" || greeting.text !== newBotGreeting(name, other)) return null;
  if (card.role !== "bot" || card.kind !== "options" || !untouchedCard(card.card, introTaskCard(other).card)) return null;
  return {
    greeting: { id: greeting.id, text: newBotGreeting(name, language) },
    card: { id: card.id, card: introTaskCard(language).card },
  };
}

/** The intro card as created: same words, and no answer, dismissal or other mark. */
function untouchedCard(card: unknown, expected: { title: string; subtitle: string; options: string[] }): boolean {
  if (!card || typeof card !== "object") return false;
  const value = card as Record<string, unknown>;
  const marked = Object.keys(value).some((key) => key !== "title" && key !== "subtitle" && key !== "options" && value[key] !== undefined);
  return !marked && value.title === expected.title && value.subtitle === expected.subtitle &&
    JSON.stringify(value.options) === JSON.stringify(expected.options);
}
