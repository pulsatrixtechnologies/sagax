import type { Message, Task } from "@/state/store";
import type { Pending } from "@/components/PendingApproval";
import { formatQuestionAnswers } from "../../shared/ask-question";
import type { PersonAttentionCard } from "../../shared/person-attention";
import { segmentsAbove } from "./single-stream";

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
 * watch domain's choice, a daily suggestion), oldest first. They wait on the
 * person like a question, and were pinned nowhere: one sat in an older topic
 * where nothing showed it. */
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

/** A question in words a bot's work left for the person (#3438): the card
 * of a hand-off's question (WireMessage.attention, kind "question") or a
 * parked teammate's input request (WireMessage.inputRequest), drawn as the
 * same card. `card.threadId` is the waiting work's thread, where the
 * answer goes. */
export interface PersonRequest {
  message: Message;
  card: PersonAttentionCard;
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

/** The open questions in words of a transcript, oldest first, one per ask
 * (#3438). The card of an ask settles once handled or once its input
 * request was answered or closed; the person writing about something else
 * in the conversation leaves it open (their answer goes to the waiting
 * work's thread, #3214). An input request settles once answered or closed. */
export function pendingRequests(messages: readonly Message[]): PersonRequest[] {
  const out: PersonRequest[] = [];
  for (const ask of askOf(messages)) {
    const open = ask.row ? rowOpen(ask.row) : true;
    if (!open) continue;
    if (ask.card && cardOpen(ask.card)) {
      out.push({ message: ask.card, card: ask.card.attention! });
      continue;
    }
    if (!ask.row) continue;
    const card = inputRequestCard(ask.row);
    if (card) out.push({ message: ask.row, card });
  }
  return out.sort((a, b) => a.message.at - b.message.at);
}

/** What waits in one earlier topic of the conversation (#3438): its open
 * approvals too, each with `threadId` set to the topic (or to the thread a
 * relayed card came from), where the decision goes. */
export interface TopicPending {
  threadId: string;
  questions: readonly Message[];
  requests: readonly PersonRequest[];
  approvals?: readonly Pending[];
  /** #3512: its open offer cards */
  offers?: readonly Message[];
}

/** The earlier topics of a bot's one conversation that may hold something
 * the person has to answer (#3438): those that wait on the person, the one
 * the bot's "Waiting for you" names, and those with news unread (a hand-off's
 * question marks its topic unread). Each one's transcript is read for its
 * open cards. */
export function topicsToScan(tasks: readonly Task[] | undefined, currentThreadId: string, waitingOnThreadId?: string): string[] {
  return segmentsAbove(tasks, currentThreadId)
    .filter((task) => task.activity === "waiting-on-you" || task.unread === true || task.threadId === waitingOnThreadId)
    .map((task) => task.threadId);
}

/** What the pinned card over the composer holds (#3214, #3438): every
 * approval, every open question card and every open question in words the
 * bot left for the person, in this topic and in the earlier topics of the
 * same conversation, oldest first, so the person answers in the order the
 * bots asked. `threadId` is set on an item of an earlier topic: the topic
 * its card sits in, where "See in the conversation" goes. */
export type PinnedItem =
  | { kind: "approval"; key: string; at: number; pending: Pending; threadId?: string }
  | { kind: "question"; key: string; at: number; message: Message; threadId?: string }
  | { kind: "request"; key: string; at: number; message: Message; card: PersonAttentionCard; threadId?: string }
  | { kind: "offer"; key: string; at: number; message: Message; threadId?: string };

export function pinnedItems(
  approvals: readonly Pending[],
  questions: readonly Message[],
  requests: readonly PersonRequest[] = [],
  topics: readonly TopicPending[] = [],
  offers: readonly Message[] = [],
): PinnedItem[] {
  const question = (message: Message, threadId?: string): PinnedItem => ({ kind: "question", key: `question:${message.card?.requestId ?? message.id}`, at: message.at, message, ...(threadId ? { threadId } : {}) });
  const request = (entry: PersonRequest, threadId?: string): PinnedItem => ({ kind: "request", key: `request:${entry.card.threadId}:${entry.card.items[0]?.text ?? entry.message.id}`, at: entry.message.at, message: entry.message, card: entry.card, ...(threadId ? { threadId } : {}) });
  const approval = (pending: Pending, threadId?: string): PinnedItem => ({ kind: "approval", key: `approval:${pending.threadId ?? threadId ?? ""}:${pending.requestId}`, at: pending.message.at, pending, ...(threadId ? { threadId } : {}) });
  const offer = (message: Message, threadId?: string): PinnedItem => ({ kind: "offer", key: `offer:${message.card?.proactiveProposal?.id ?? message.id}`, at: message.at, message, ...(threadId ? { threadId } : {}) });
  const all: PinnedItem[] = [
    ...approvals.map((pending) => approval(pending)),
    ...questions.map((message) => question(message)),
    ...requests.map((entry) => request(entry)),
    ...offers.map((message) => offer(message)),
    ...topics.flatMap((topic) => [
      ...(topic.approvals ?? []).map((pending) => approval({ ...pending, threadId: pending.threadId ?? topic.threadId }, topic.threadId)),
      ...topic.questions.map((message) => question(message, topic.threadId)),
      ...topic.requests.map((entry) => request(entry, topic.threadId)),
      ...(topic.offers ?? []).map((message) => offer(message, topic.threadId)),
    ]),
  ];
  // one item per request: the same ask seen in two topics is pinned once
  const seen = new Set<string>();
  const items = all.filter((item) => !seen.has(item.key) && Boolean(seen.add(item.key)));
  return items.sort((a, b) => a.at - b.at);
}

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
