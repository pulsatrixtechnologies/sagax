// #2634: a question the person declines from an AI client (member API
// `decision: deny`) whose turn already ended must not come back as a message
// of theirs. The late-answer path (deliverLateQuestionAnswer) posts the answer
// as the person's next message, which put a sentence they never wrote under
// their name. A decline only closes the card, as declined: no new turn, no
// message, and the bot never reads a stale question as answered.
import { isPersistentQuestionCard } from "../../shared/ask-question.ts";
import type { Message } from "../store.ts";

export interface DeclineStore {
  messagesFor(threadId: string): Message[];
  patchMessage(threadId: string, messageId: string, patch: Partial<Message>): unknown;
}

/** True when this respond body declines a question (and nothing else). */
export function isQuestionDecline(body: Record<string, unknown>, card: Message["card"] | undefined): boolean {
  return body.declined === true && body.behavior === "answer" && isPersistentQuestionCard(card);
}

/** Close a declined question whose turn is over. Returns the respond reply. */
export function closeDeclinedQuestion(store: DeclineStore, threadId: string, messageId: string): { status: number; body: Record<string, unknown> } {
  const card = store.messagesFor(threadId).find((message) => message.id === messageId)?.card;
  if (!card) return { status: 404, body: { error: "this question is no longer available" } };
  if (card.answered || card.dismissed || card.expired) return { status: 409, body: { error: "this question has already been answered" } };
  store.patchMessage(threadId, messageId, { card: { ...card, answered: "deny", dismissed: true } });
  return { status: 200, body: { ok: true, outcome: "declined" } };
}
