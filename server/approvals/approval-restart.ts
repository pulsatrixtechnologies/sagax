// Approval cards that outlived a restart.
//
// A permission card's live request (the engine process, the Sagax gate
// broker's hold, the outbound relay) is memory-only. After a restart the
// card is still on the thread but nothing can deliver an answer to it, so
// it would sit "pending" forever and keep owning the composer. Re-arming a
// timer cannot help (the request it would decline is gone), so every such
// card is closed at startup: it reads Expired, the action never ran, and
// the audit log says why.
import type { Message } from "../store.ts";

export interface StaleApproval {
  threadId: string;
  message: Message;
}

export interface ExpireDeps {
  open: () => StaleApproval[];
  patch: (threadId: string, messageId: string, card: NonNullable<Message["card"]>) => void;
  decide: (row: { threadId: string; requestId: string; tool?: string; summary?: string }) => void;
}

/** Expire every open approval card left from before this boot. Returns the count. */
export function expireApprovalsAfterRestart(deps: ExpireDeps): number {
  let expired = 0;
  for (const { threadId, message } of deps.open()) {
    const card = message.card;
    if (!card?.requestId || card.requestType !== "permission" || card.answered || card.dismissed || card.expired) continue;
    deps.patch(threadId, message.id, { ...card, answered: "deny", expired: true, options: [] });
    // A linked view is closed too, including an interrupted two-write link,
    // but only the source call records a decision.
    if (card.approvalOrigin) continue;
    deps.decide({ threadId, requestId: card.requestId, tool: card.tool, summary: card.subtitle });
    expired++;
  }
  return expired;
}
