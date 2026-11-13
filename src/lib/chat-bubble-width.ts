// How wide a chat bubble may grow. Prose keeps the narrow reading measure;
// tables, diagrams, charts, widgets and email drafts get a wide card; a live
// terminal takes the whole transcript column (less the gutter the other rows
// keep), so a shell prompt has its columns and the widget follows the column.
// The person's chat-width preference (#2004) scales the column and the bubble
// caps together: reading (960 / 560 / 780, the default), wide (1280 / 747 /
// 1040) and full (fills the pane; fit up to 960, wide uncapped inside the
// gutter). Classes are full string literals so Tailwind keeps them.
// The column's side gutter is 16px and a bubble's text 15/22, the reference
// app's transcript at every window width (#4093, the table "Shell by window
// width" in docs/design/ux-reference-grokbot-cursor.md).
import { useChatWidth, type ChatWidth } from "./chat-width-preference";

/** The transcript column of a conversation: a 1:1 (ChatView), a room
 * (GroupView) and an open bot-to-bot conversation (BotExchangeChip) share it,
 * inside a scroll pane with a px-4 gutter (16px, the reference's). */
export function chatColumnClass(width: ChatWidth = "reading"): string {
  switch (width) {
    case "wide":
      return "mx-auto flex w-full max-w-[1280px] flex-col gap-3";
    case "full":
      return "mx-auto flex w-full max-w-none flex-col gap-3";
    default:
      return "mx-auto flex w-full max-w-[960px] flex-col gap-3";
  }
}

/** Default reading column. Galleries and static markup keep this constant. */
export const CHAT_COLUMN_CLASS = chatColumnClass("reading");

/** Pixel cap of the column, or null when the column fills the pane. */
export function chatColumnMaxPx(width: ChatWidth): number | null {
  switch (width) {
    case "wide":
      return 1280;
    case "full":
      return null;
    default:
      return 960;
  }
}

/** Composer dock gutter: mirrors the transcript column (its px-4 pane) so
 * the field and a card pinned over it line up with the cards of the chat:
 * one card width at every size (#3581). */
export function chatComposerShellClass(width: ChatWidth = "reading"): string {
  switch (width) {
    case "wide":
      return "pointer-events-none relative overflow-x-clip px-[max(16px,calc((100%-1280px)/2))] pb-4";
    case "full":
      return "pointer-events-none relative overflow-x-clip px-4 pb-4";
    default:
      return "pointer-events-none relative overflow-x-clip px-[max(16px,calc((100%-960px)/2))] pb-4";
  }
}

/** A chat bubble's text (a bot's reply, the person's message, a room's
 * line): the reference's transcript prose, 15px on a 22px line (#4093). The
 * prose blocks inside (1.75 elsewhere) keep the 22px line too, through
 * `.chat-bubble-type` in styles.css: a CSS rule, so the bubble's own class
 * list never names the prose class its child carries. */
export const CHAT_BUBBLE_TEXT_CLASS = "chat-bubble-type text-[15px] leading-[22px]";

export type ChatBubbleWidth = "fit" | "wide" | "column";

export function chatBubbleWidthClasses(width: ChatWidth = "reading"): Record<ChatBubbleWidth, string> {
  switch (width) {
    case "wide":
      return {
        fit: "w-fit max-w-[min(80%,747px,calc(100%-82px))]",
        wide: "w-full max-w-[min(94%,1040px,calc(100%-82px))]",
        column: "w-full max-w-[calc(100%-82px)]",
      };
    case "full":
      return {
        fit: "w-fit max-w-[min(80%,960px,calc(100%-82px))]",
        wide: "w-full max-w-[min(94%,calc(100%-82px))]",
        column: "w-full max-w-[calc(100%-82px)]",
      };
    default:
      return {
        fit: "w-fit max-w-[min(80%,560px,calc(100%-82px))]",
        wide: "w-full max-w-[min(94%,780px,calc(100%-82px))]",
        column: "w-full max-w-[calc(100%-82px)]",
      };
  }
}

/** Default reading bubble caps. Galleries and static markup keep this constant. */
export const CHAT_BUBBLE_WIDTH_CLASS = chatBubbleWidthClasses("reading");

/** Room live reply that is not a wide block: w-fit with the preference's wide measure. */
export function chatRoomFitClass(width: ChatWidth = "reading"): string {
  switch (width) {
    case "wide":
      return "w-fit max-w-[min(94%,1040px,calc(100%-82px))]";
    case "full":
      return "w-fit max-w-[min(94%,calc(100%-82px))]";
    default:
      return "w-fit max-w-[min(94%,780px,calc(100%-82px))]";
  }
}

export function chatBubbleWidth({ terminal, wide }: { terminal: boolean; wide: boolean }): ChatBubbleWidth {
  if (terminal) return "column";
  return wide ? "wide" : "fit";
}

export function useChatColumnClass(): string {
  return chatColumnClass(useChatWidth());
}

export function useChatBubbleWidthClasses(): Record<ChatBubbleWidth, string> {
  return chatBubbleWidthClasses(useChatWidth());
}

export function useChatComposerShellClass(): string {
  return chatComposerShellClass(useChatWidth());
}

export function useChatRoomFitClass(): string {
  return chatRoomFitClass(useChatWidth());
}
