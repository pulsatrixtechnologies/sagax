// Settings > Appearance > Conversation > "Conversation header": how a bot
// conversation names its bot at the top. "pill" (the default) is the centred
// floating pill, avatar then "Name · Title"; "title" is a plain title at the
// top left, on the bar's own ground, with no pill fill (#4536). The owner,
// 2026-11-23: both looks are fine, the person chooses, the pill stays the
// default. A group, a split pane, a coding chat and a bot-to-bot window keep
// the pill either way. A preference of the person, for every conversation:
// kept like the other appearance choices (localStorage, and per person on an
// organization server through shared/user-preferences.ts), changed by a bot
// through the settings tool (shared/settings-actions.ts,
// appearance.conversationHeader).
import { localChoice } from "./local-choice";

export const CONVERSATION_HEADER_KEY = "sagax.conversationHeader.v1";
export const CONVERSATION_HEADERS = ["pill", "title"] as const;
export type ConversationHeader = (typeof CONVERSATION_HEADERS)[number];

export const conversationHeaderChoice = localChoice<ConversationHeader>(CONVERSATION_HEADER_KEY, CONVERSATION_HEADERS, "pill");

export function parseConversationHeader(value: string | null | undefined): ConversationHeader {
  return value === "title" ? "title" : "pill";
}

export function setConversationHeader(next: ConversationHeader): void {
  conversationHeaderChoice.set(next);
}

/** The choice, followed live (this window, another window, a bot, another device). */
export function useConversationHeader(): ConversationHeader {
  return conversationHeaderChoice.use();
}
