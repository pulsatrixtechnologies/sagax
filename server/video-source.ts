import type { Message } from "./store.ts";

/** A later queued line must not change the image or idempotency source of
 * work already running, nor lend another room member's image to its payer. */
export function videoSourceMessage(input: {
  messages: readonly Message[];
  messageId?: string;
  startedAt: number;
  principalId?: string | null;
  routine: boolean;
}): Message | undefined {
  if (input.routine) return undefined;
  const eligible = (message: Message) => message.role === "user" && !message.peerAsk
    && (!input.principalId || message.sender?.id?.trim().toLowerCase() === input.principalId.trim().toLowerCase());
  if (input.messageId) return input.messages.find(message => message.id === input.messageId && eligible(message));
  return input.messages.findLast(message => message.at <= input.startedAt && eligible(message));
}
