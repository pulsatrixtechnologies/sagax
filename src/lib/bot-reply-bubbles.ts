// One appearance choice for settled and streaming bot replies.
import { localChoice } from "./local-choice";

export const botReplyBubbles = localChoice("sagax.botReplyBubbles.v1", ["on", "off"] as const, "on");

export function useBotReplyBubbleClass(): string {
  return botReplyBubbles.use() === "on" ? "bg-bubble-bot px-3 py-[7px]" : "py-[7px]";
}
