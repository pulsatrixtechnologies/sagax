// What a bot that reads "Waiting for you" waits on (2026-11-09, #3159: three
// bots sat on "Waiting for you…" with nothing in their chat to answer).
//
// The sidebar names the card ("Waiting for you: Which repo should I file
// it in?") and a click opens the bot's chat on it. The card is looked up in
// the threads that hold the bot's waiting state, newest first; a card copied
// into the person's conversation (origin-approvals.ts) is shown where the
// copy is, since that is the one the chat draws.

import type { OptionCardData, WaitingOnCard, WireMessage as Message } from "../../shared/wire.ts";

export const WAITING_ON_TEXT_MAX = 120;

/** One line a person reads for a card: a question's own words, an
 * approval's plain sentence, else its summary. */
export function waitingOnText(card: OptionCardData): string {
  const question = !card.tool && !card.plain;
  // A question card's title is the generic "Your bot has a question"; its
  // words are the question itself (the subtitle), QA 0.8.77.
  const raw = question
    ? card.questionRequest?.questions?.[0]?.question?.trim() || card.subtitle || card.title
    : card.plain?.title || card.subtitle || card.title;
  const line = (raw ?? "").replace(/\s+/g, " ").trim();
  return line.length > WAITING_ON_TEXT_MAX ? `${line.slice(0, WAITING_ON_TEXT_MAX - 1).trimEnd()}…` : line;
}

/** The newest open card in the first thread that holds one. `threads` is in
 * the order the bot's waiting is read (its selected thread first). */
export function waitingOnCard(
  threads: readonly string[],
  messagesFor: (threadId: string) => readonly Message[],
  live: (card: OptionCardData | undefined) => unknown,
): WaitingOnCard | undefined {
  for (const threadId of new Set(threads)) {
    const messages = messagesFor(threadId);
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i]!;
      const card = message.kind === "options" ? message.card : undefined;
      if (!card || !live(card)) continue;
      const shown = card.approvalDestination;
      return { threadId: shown?.threadId ?? threadId, messageId: shown?.messageId ?? message.id, text: waitingOnText(card) };
    }
  }
  return undefined;
}

/** The teammates a coordinating thread waits on, by name, once each. */
export function teammateNames(botIds: readonly string[], nameOf: (botId: string) => string | undefined): string[] {
  const names: string[] = [];
  for (const id of botIds) {
    const name = nameOf(id)?.trim();
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}
