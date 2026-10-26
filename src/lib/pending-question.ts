import type { Message } from "@/state/store";

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

