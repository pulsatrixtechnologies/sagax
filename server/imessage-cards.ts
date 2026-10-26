// A send that is not on the bot's allowed-recipient list waits on a card.
// The pending text lives in this process only. A restart drops it. The
// card in the conversation then answers that the send expired.
import { randomBytes } from "node:crypto";

import { IMESSAGE_REQUEST_PREFIX, type MessageService } from "../shared/imessage.ts";

export type PendingImessage = {
  requestId: string;
  threadId: string;
  botId: string;
  messageId?: string;
  to: string;
  text: string;
  service: MessageService;
};

const pending = new Map<string, PendingImessage>();

export function stageImessageSend(input: Omit<PendingImessage, "requestId" | "messageId">): PendingImessage {
  const requestId = `${IMESSAGE_REQUEST_PREFIX}${randomBytes(8).toString("hex")}`;
  const row: PendingImessage = { ...input, requestId };
  pending.set(requestId, row);
  return row;
}

export function bindImessageMessage(requestId: string, messageId: string): void {
  const row = pending.get(requestId);
  if (row) row.messageId = messageId;
}

export function takeImessageSend(requestId: string, threadId: string): PendingImessage | null {
  const row = pending.get(requestId);
  if (!row || row.threadId !== threadId) return null;
  pending.delete(requestId);
  return row;
}

export function dropImessageSend(requestId: string): void {
  pending.delete(requestId);
}

/** Tests only. */
export function resetImessageSends(): void {
  pending.clear();
}
