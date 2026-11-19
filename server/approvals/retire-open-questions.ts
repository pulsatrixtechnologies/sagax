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

export interface AnsweredInChatDeps {
  messagesFor(threadId: string): Message[];
  /** Work is parked on this card: the person's words go to it instead. */
  parkedOn(messageId: string): boolean;
  patch(threadId: string, messageId: string, card: NonNullable<Message["card"]>): void;
  forget?(threadId: string, requestId: string): void;
}

/** Port of OpenMausBot #5593: the person typed a new line instead of
 * answering. Every open question card of the thread that no work is parked
 * on closes as answered in the chat (a keyed card, a durable ask, stays).
 * Returns the closed request ids. */
export function closeQuestionsAnsweredInChat(deps: AnsweredInChatDeps, threadId: string): string[] {
  const closed: string[] = [];
  for (const message of deps.messagesFor(threadId)) {
    const card = message.card;
    if (!card?.requestId || card.answered || card.dismissed || card.expired || card.askKey) continue;
    if (card.requestType !== "question" && !card.questionRequest) continue;
    if (deps.parkedOn(message.id)) continue;
    deps.patch(threadId, message.id, { ...card, expired: true, options: [], answeredInChat: true });
    deps.forget?.(threadId, card.requestId);
    closed.push(card.requestId);
  }
  return closed;
}

/** Retire every open persistent question card of a thread (#4205: or only
 * the card of row `messageId`, or only the cards drawn at or after `since`,
 * a routine run's own; #4438: `reason`, the line the closed card shows).
 * Returns the retired request ids. */
export function retireOpenQuestions(deps: RetireQuestionsDeps, threadId: string, only: { messageId?: string; since?: number; reason?: string } = {}): string[] {
  const retired: string[] = [];
  for (const message of deps.messagesFor(threadId)) {
    if (only.messageId !== undefined && message.id !== only.messageId) continue;
    if (only.since !== undefined && message.at < only.since) continue;
    const card = message.card;
    if (!card?.requestId || card.answered || card.dismissed || card.expired) continue;
    if (!deps.isPersistentQuestionCard(card)) continue;
    if (deps.isApprovalCardMessage?.(message)) continue;
    // #4438: a card closed because its matter is settled says why
    deps.patch(threadId, message.id, { ...card, expired: true, options: [], ...(only.reason?.trim() ? { answerNote: only.reason.trim() } : {}) });
    deps.forget?.(threadId, card.requestId);
    retired.push(card.requestId);
  }
  return retired;
}
