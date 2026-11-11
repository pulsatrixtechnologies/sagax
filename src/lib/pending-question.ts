import type { Message } from "@/state/store";
import type { Pending } from "@/components/PendingApproval";
import { formatQuestionAnswers } from "../../shared/ask-question";
import type { PersonAttentionCard } from "../../shared/person-attention";
import type { ServedWaitingItem } from "../../shared/waiting-items";

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

/** #3512: open offer and proposal cards a bot posted on its own (a
 * proactive proposal: the daily brief's « Garder le brief du jour ? », a
 * watch domain's choice, a daily suggestion), oldest first. */
export function pendingOffers(messages: readonly Message[]): Message[] {
  return messages.filter(
    (m) =>
      m.kind === "options" &&
      m.card?.proactiveProposal &&
      !m.card.requestId &&
      !m.card.answered &&
      !m.card.dismissed &&
      !m.card.expired,
  );
}

/** An input request as the standard answerable card (#3438): one card in
 * the chat for it, never a second box. */
export function inputRequestCard(message: Message): PersonAttentionCard | undefined {
  const request = message.inputRequest;
  if (!request) return undefined;
  const closed = request.answered === true || request.expired === true;
  return {
    kind: "question",
    botId: request.botId,
    botName: request.botName,
    threadId: request.threadId,
    ...(request.title ? { threadTitle: request.title } : {}),
    sourceMessageId: message.id,
    items: [{ text: request.question }],
    // closed: drawn settled (a row saved without a time still is)
    ...(closed ? { handledAt: message.at || 1 } : {}),
  };
}

/** A hand-off's question card and the parked work's input request of the
 * same ask come from the same finished turn (the relayed card and the park),
 * seconds apart: a card pairs with the nearest input request of its work
 * thread within this span, never with one of an earlier or later ask. */
const SAME_ASK_MS = 10 * 60_000;

/** One ask of a waiting work, as a transcript holds it (#3438): the hand-off's
 * card of kind "question", the parked work's input request, or both, with
 * the reminders of that input request. Each ask is open or settled on its
 * own: a work thread asks again once its first question was answered. */
interface Ask {
  card?: Message;
  row?: Message;
  reminders: Message[];
}

function askOf(messages: readonly Message[]): Ask[] {
  const cards = messages.filter((message) => message.attention?.kind === "question" && !message.inputRequest);
  const rows = messages.filter((message) => message.inputRequest && !message.inputRequest.reminder);
  const pairs: Array<{ card: Message; row: Message; gap: number }> = [];
  for (const card of cards) {
    for (const row of rows) {
      if (row.inputRequest!.threadId !== card.attention!.threadId) continue;
      const gap = Math.abs(row.at - card.at);
      if (gap <= SAME_ASK_MS) pairs.push({ card, row, gap });
    }
  }
  pairs.sort((a, b) => a.gap - b.gap || a.row.at - b.row.at);
  const asks = new Map<string, Ask>();
  const byRow = new Map<string, Ask>();
  for (const pair of pairs) {
    if (asks.has(pair.card.id) || byRow.has(pair.row.id)) continue;
    const ask: Ask = { card: pair.card, row: pair.row, reminders: [] };
    asks.set(pair.card.id, ask);
    byRow.set(pair.row.id, ask);
  }
  for (const card of cards) if (!asks.has(card.id)) asks.set(card.id, { card, reminders: [] });
  for (const row of rows) if (!byRow.has(row.id)) byRow.set(row.id, { row, reminders: [] });
  // a reminder repeats the latest question its work asked before it
  const out = [...new Set([...asks.values(), ...byRow.values()])];
  for (const message of messages) {
    const request = message.inputRequest;
    if (!request?.reminder) continue;
    let base: Message | undefined;
    for (const row of rows) if (row.inputRequest!.threadId === request.threadId && row.at <= message.at && (!base || row.at >= base.at)) base = row;
    if (base) byRow.get(base.id)!.reminders.push(message);
    else out.push({ row: message, reminders: [] });
  }
  return out;
}

const rowOpen = (row: Message | undefined): boolean => Boolean(row?.inputRequest && !row.inputRequest.answered && !row.inputRequest.expired);
const cardOpen = (card: Message | undefined): boolean => Boolean(card?.attention && !card.attention.handledAt);

/** The input request rows of a transcript that the card of the same ask
 * already draws (#3438: one rendering per request). A hand-off's question
 * reaches the person's conversation twice, as the relayed card and as the
 * parked work's input request: the card stays, the input request row and
 * its reminders go. Only the card of that same ask hides them: a card the
 * person marked handled leaves a still open input request drawn, and a card
 * of an earlier ask, or one that is not a question, hides nothing. */
export function inputRequestsDrawnElsewhere(messages: readonly Message[]): Set<string> {
  const out = new Set<string>();
  for (const ask of askOf(messages)) {
    if (!ask.card || !ask.row) continue;
    if (!cardOpen(ask.card) && rowOpen(ask.row)) continue;
    out.add(ask.row.id);
    for (const reminder of ask.reminders) out.add(reminder.id);
  }
  return out;
}

/** What the pinned card over the composer holds (#3214, #3543): the
 * server's own items of what waits on the person (GET
 * /api/approvals?waiting=1, shared/waiting-items.ts), the same list Today and
 * the connector read, each drawn with the conversation's card for its kind.
 * `item` is the server's item; `threadId` is set when it sits in another
 * thread than the conversation on screen (an earlier topic, a parallel
 * task), where its answer and "See in the conversation" go. An item of a
 * kind this app does not know, or whose message it was not given, is
 * `other`: its text, and its conversation opens. */
export type PinnedItem =
  | { kind: "approval"; key: string; at: number; item: ServedWaitingItem; pending: Pending; threadId?: string }
  | { kind: "question"; key: string; at: number; item: ServedWaitingItem; message: Message; threadId?: string }
  | { kind: "request"; key: string; at: number; item: ServedWaitingItem; message: Message; card: PersonAttentionCard; threadId?: string }
  | { kind: "offer"; key: string; at: number; item: ServedWaitingItem; message: Message; threadId?: string }
  | { kind: "other"; key: string; at: number; item: ServedWaitingItem; threadId?: string };

/** The pinned item the composer answers with what the person types: one
 * free-text question (a question with a fixed set of options, or a page
 * target choice, is answered from its rows). `threadId` is set for a
 * question of an earlier topic: the answer goes to that topic's thread. */
export function pinnedQuestionAnswer(item: PinnedItem | undefined, text: string): { requestId: string; answer: string; threadId?: string } | null {
  if (!item || item.kind !== "question") return null;
  const card = item.message.card;
  const questions = card?.questionRequest?.questions ?? [];
  if (!card?.requestId || questions.length !== 1 || card.pageTargetChoice) return null;
  const question = questions[0]!;
  if (question.custom === false) return null;
  const typed = text.trim();
  if (!typed) return null;
  const answer = formatQuestionAnswers(questions, [[typed]]);
  if (!answer) return null;
  return item.threadId ? { requestId: card.requestId, answer, threadId: item.threadId } : { requestId: card.requestId, answer };
}
