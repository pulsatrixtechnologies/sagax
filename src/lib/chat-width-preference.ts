// Settings > Appearance > Conversation > "Chat width": how wide the
// transcript column, the composer and the message bubbles may grow on a
// wide window. "reading" (960px, the default) keeps today's measure;
// "wide" (~1280px) and "full" (fills the pane with a modest gutter) let
// tables and code use the space. A preference of the person, for every
// conversation: kept like the other appearance choices (localStorage, and
// per person on an organization server through shared/user-preferences.ts),
// changed by a bot through the settings tool (shared/settings-actions.ts,
// appearance.chatWidth), applied live (#2004).
import { localChoice } from "./local-choice";

export const CHAT_WIDTH_KEY = "sagax.chatWidth.v1";
export const CHAT_WIDTHS = ["reading", "wide", "full"] as const;
export type ChatWidth = (typeof CHAT_WIDTHS)[number];

export const chatWidthChoice = localChoice<ChatWidth>(CHAT_WIDTH_KEY, CHAT_WIDTHS, "reading");

export function parseChatWidth(value: string | null | undefined): ChatWidth {
  if (value === "reading" || value === "wide" || value === "full") return value;
  return "reading";
}

export function setChatWidth(next: ChatWidth): void {
  chatWidthChoice.set(next);
}

/** The choice, followed live (this window, another window, a bot, another device). */
export function useChatWidth(): ChatWidth {
  return chatWidthChoice.use();
}
