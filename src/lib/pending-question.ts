import type { Message } from "@/state/store";
import type { Pending } from "@/components/PendingApproval";
import { formatQuestionAnswers } from "../../shared/ask-question";

/** Open question cards on a thread (a bot's structured ask), oldest first.
 * Answered, dismissed and expired ones drop out. Permission cards are not
 * questions: they keep taking over the composer (see PendingApproval). */
export function pendingQuestions(messages: readonly Message[]): Message[] {
  return messages.filter(
    (m) =>
      m.kind === "options" &&
      m.card?.requestId &&
      m.card.questionRequest &&
      !m.card.tool &&
      !m.card.answered &&
      !m.card.dismissed &&
      !m.card.expired,
  );
}


/** What the pinned card over the composer holds (#3214): every approval
 * and every open question of the conversation, oldest first, so the person
 * answers in the order the bots asked. */
export type PinnedItem =
  | { kind: "approval"; key: string; at: number; pending: Pending }
  | { kind: "question"; key: string; at: number; message: Message };

export function pinnedItems(approvals: readonly Pending[], questions: readonly Message[]): PinnedItem[] {
  const items: PinnedItem[] = [
    ...approvals.map((pending): PinnedItem => ({ kind: "approval", key: `approval:${pending.threadId ?? ""}:${pending.requestId}`, at: pending.message.at, pending })),
    ...questions.map((message): PinnedItem => ({ kind: "question", key: `question:${message.card?.requestId ?? message.id}`, at: message.at, message })),
  ];
  return items.sort((a, b) => a.at - b.at);
}

/** The pinned item the composer answers with what the person types: one
 * free-text question (a question with a fixed set of options, or a page
 * target choice, is answered from its rows). */
export function pinnedQuestionAnswer(item: PinnedItem | undefined, text: string): { requestId: string; answer: string } | null {
  if (!item || item.kind !== "question") return null;
  const card = item.message.card;
  const questions = card?.questionRequest?.questions ?? [];
  if (!card?.requestId || questions.length !== 1 || card.pageTargetChoice) return null;
  const question = questions[0]!;
  if (question.custom === false) return null;
  const typed = text.trim();
  if (!typed) return null;
  const answer = formatQuestionAnswers(questions, [[typed]]);
  return answer ? { requestId: card.requestId, answer } : null;
}
