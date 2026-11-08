// #2762: the language a turn answers in is the language of the person's last
// message in that conversation, not the bot owner's. A message too short to
// tell ("ok", "go") falls back on the person's own preference.
import { textLanguage } from "../../shared/looks-french.ts";

export type TurnLanguage = "fr" | "en";

export function turnLanguage(lastPersonText: string | null | undefined, preferred: string | null | undefined): TurnLanguage {
  const said = lastPersonText ? textLanguage(lastPersonText) : null;
  if (said) return said;
  return (preferred ?? "").toLowerCase().startsWith("fr") ? "fr" : "en";
}

/** The text of the last message the person (or the AI client speaking for
 * them) wrote in a conversation. */
export function lastPersonText(messages: readonly { role?: string; kind?: string; text?: string }[]): string | undefined {
  return messages.findLast((message) => message.role === "user" && message.kind === "text" && Boolean(message.text?.trim()))?.text;
}
