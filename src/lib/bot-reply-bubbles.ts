// Settings > Appearance > Conversation: how a bot's own reply is drawn.
//
// - "Show bot replies in bubbles" (`sagax.botReplyBubbles.v1`, "on" | "off",
//   on by default, the reference look). Off keeps every sentence a separate
//   message but draws it without the bubble.
// - "Accent on bot bubbles" (`sagax.botBubble.v1`, "1" | "0", off by default,
//   the reference grey). On tints ONLY the bot's own reply bubble with the
//   accent. The phone reads the very same key (ios BotBubble.swift, "1" is
//   on, absent is off), so the choice follows the person to every device.
//
// Only a bot's reply asks for this class (Bubble, RoomTextMessage,
// LiveReply). Another person's message in a room and every other surface that
// shares the grey keep `bg-bubble-bot` alone.
import { localChoice } from "./local-choice";

export const botReplyBubbles = localChoice("sagax.botReplyBubbles.v1", ["on", "off"] as const, "on");
export const botBubbleAccent = localChoice("sagax.botBubble.v1", ["1", "0"] as const, "0");

/** Pure rule, shared by the hook and the tests. */
export function botReplyBubbleClass(bubbles: boolean, accent: boolean): string {
  if (!bubbles) return "py-[7px]";
  return accent ? "bg-bubble-bot bot-reply-accent px-3 py-[7px]" : "bg-bubble-bot px-3 py-[7px]";
}

export function useBotReplyBubbleClass(): string {
  const bubbles = botReplyBubbles.use() === "on";
  const accent = botBubbleAccent.use() === "1";
  return botReplyBubbleClass(bubbles, accent);
}
