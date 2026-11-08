// #2608: a send_prompt with on_busy "supersede" stops the caller's running
// turn, but closeOpenApprovals keeps persistent question cards on purpose so a
// late answer can still resume them. A superseded turn must not leave its
// ask_choice question pending: the thread would stay "waiting" and the new
// prompt would wait behind a question nobody will answer. Retire those cards
// as expired (same shape as the age expiry), which also withdraws the notice
// and settles the waiting activity through the store patch hook.
import type { Message } from "../store.ts";

export interface RetireQuestionsDeps {
  messagesFor(threadId: string): Message[];
  isPersistentQuestionCard(card: NonNullable<Message["card"]>): boolean;
  isApprovalCardMessage?(message: Message): boolean;
  patch(threadId: string, messageId: string, card: NonNullable<Message["card"]>): void;
  forget?(threadId: string, requestId: string): void;
}

/** Retire every open persistent question card of a thread. Returns the retired request ids. */
export function retireOpenQuestions(deps: RetireQuestionsDeps, threadId: string): string[] {
  const retired: string[] = [];
  for (const message of deps.messagesFor(threadId)) {
    const card = message.card;
    if (!card?.requestId || card.answered || card.dismissed || card.expired) continue;
    if (!deps.isPersistentQuestionCard(card)) continue;
    if (deps.isApprovalCardMessage?.(message)) continue;
    deps.patch(threadId, message.id, { ...card, expired: true, options: [] });
    deps.forget?.(threadId, card.requestId);
    retired.push(card.requestId);
  }
  return retired;
}
