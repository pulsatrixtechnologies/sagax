// The Today box (#2689, 2026-11-08): one place for everything a bot waits
// on the person for, with its age. The Approvals list already held the
// permission, question and proposal cards (option cards with a requestId).
// Two kinds never reached it and stayed buried in a conversation:
//
//  - a person-attention card (#2014, shared/person-attention.ts): "needs
//    you" or "has a question for you", posted in the person's own
//    conversation with the bot. Production, 2026-11-06: Ember's card waited
//    about 38 h because nothing listed it.
//  - a proactive proposal (server/proactive/proactive-wake.ts): the bot
//    offers to handle an event, answered by POST /api/bots/:id/proactive/:id.
//
// This module lists both for one viewer, pure, with the host's checks as
// deps. An attention card leaves the box when the person replies in that
// conversation after it, or marks it handled (POST /api/approvals/handled), which tells
// the waiting work as a skip does (#3543).
//
// #3512: a parked teammate's input request row (WireMessage.inputRequest) is
// a question in words too, and the pinned row already drew it: Today lists
// it as well, as an attention row, once per ask (the hand-off's card and the
// input request of the same ask are one item, as the pinned row pairs them,
// src/lib/pending-question.ts). Today is the one source of what waits on the
// person (shared/waiting-items.ts): an ask whose input request closed
// (answered elsewhere, expired, skipped, its bot-to-bot exchange ended)
// leaves with it.
import type { InboxApproval } from "../../shared/approvals-inbox.ts";
import { inboxKey } from "../../shared/approvals-inbox.ts";
import type { PersonAttentionCard } from "../../shared/person-attention.ts";
import type { WireMessage } from "../../shared/wire.ts";

export const ATTENTION_PREFIX = "attention:";
export const PROACTIVE_PREFIX = "proactive:";
export const FORM_PREFIX = "form:";

export interface TodayBot { id: string; name: string; hidden?: boolean }

export interface TodayMessage {
  id: string;
  at: number;
  role?: string;
  kind?: string;
  attention?: PersonAttentionCard;
  inputRequest?: WireMessage["inputRequest"];
  card?: { answered?: unknown; dismissed?: unknown; expired?: unknown; proactiveProposal?: { id: string } };
  text?: string;
  widget?: { root?: unknown; settled?: unknown };
}

export interface TodayProposal { id: string; botId: string; threadId: string; messageId: string; createdAt: number; answered?: string }

/** #4234: a routine run's form moved into the conversation it reports to
 * (server/routines/routine-run-widget.ts), as its run keeps it. */
export interface TodayForm { botId: string; threadId: string; widgetId: string; routineName?: string }

export interface TodayDeps {
  bots(): readonly TodayBot[];
  bot(id: string): TodayBot | undefined;
  threads(botId: string): readonly { threadId: string; title?: string; confidential?: boolean; archivedAt?: number }[];
  messages(threadId: string): readonly TodayMessage[];
  /** The viewer is the person this conversation's cards are for. */
  isViewers(bot: TodayBot, threadId: string): boolean;
  /** The open proactive proposals (not answered, not expired). */
  proposals(): readonly TodayProposal[];
  /** #4234: the forms routine runs moved into a conversation; each waits
   * on the person until it is answered. */
  forms?(): readonly TodayForm[];
  /** The message exactly as the viewer's conversation shows it. */
  project(threadId: string, message: TodayMessage): unknown;
  /** #3542: the store's own reads of what is open. When given, Today reads
   * no transcript: only the rows that may still wait, the halves of their
   * asks and one indexed row for "the person wrote after it". Without it,
   * the same reads are made over `messages` (transcriptReader). */
  open?: TodayReader;
}

/** #3542: what Today reads, so its cost follows what is open, never the
 * length of a history (GET /api/approvals?waiting=1 is asked every time a
 * card opens or closes, by every person with the app open). */
export interface TodayReader {
  /** Every row that may still wait on someone: an input request neither a
   * reminder, answered nor expired; an attention card not handled; a
   * proposal card still open. A superset: todayRows checks each row. */
  rows(): readonly { threadId: string; message: TodayMessage }[];
  /** The rows of a thread between two times (inclusive) that may be one half
   * of an ask (an attention card, an input request), open or not. */
  asks(threadId: string, from: number, to: number): readonly TodayMessage[];
  /** The person wrote in this thread after `at`. */
  wroteAfter(threadId: string, at: number): boolean;
  /** One message of a thread. */
  message(threadId: string, messageId: string): TodayMessage | undefined;
}

/** The reads of TodayReader made over whole transcripts (`deps.messages`):
 * the same answers, at the cost of every row of every conversation. */
export function transcriptReader(deps: Pick<TodayDeps, "bots" | "threads" | "messages">): TodayReader {
  return {
    rows: () => {
      const out: Array<{ threadId: string; message: TodayMessage }> = [];
      const seen = new Set<string>();
      for (const bot of deps.bots()) {
        for (const task of deps.threads(bot.id)) {
          if (seen.has(task.threadId)) continue;
          seen.add(task.threadId);
          for (const message of deps.messages(task.threadId)) if (mayWait(message)) out.push({ threadId: task.threadId, message });
        }
      }
      return out;
    },
    asks: (threadId, from, to) => deps.messages(threadId).filter((row) => row.at >= from && row.at <= to && Boolean(row.inputRequest || row.attention)),
    wroteAfter: (threadId, at) => deps.messages(threadId).some((row) => row.role === "user" && row.at > at),
    message: (threadId, messageId) => deps.messages(threadId).find((row) => row.id === messageId),
  };
}

/** A row that may still wait on the person as a question in words (the
 * store's index of open waiting rows, messages_open_waiting_rows). */
function mayWait(message: TodayMessage): boolean {
  if (message.inputRequest) return inputRequestOpen(message);
  return Boolean(message.attention && !message.attention.handledAt);
}

/** An attention card is settled once handled, or once the person wrote
 * after it, in that conversation or in the thread the bot asked in (the
 * card's reply goes there): their words are the answer. */
export function attentionSettled(message: TodayMessage, rows: readonly TodayMessage[], sourceRows: readonly TodayMessage[] = []): boolean {
  if (!message.attention) return true;
  if (message.attention.handledAt) return true;
  return rows.some((row) => row.role === "user" && row.at > message.at) || sourceRows.some((row) => row.role === "user" && row.at > message.at);
}

/** The same check through the reader: one indexed row per thread at most.
 * #4098: also what settles a routine's open items for its outcome. */
export function attentionSettledBy(read: Pick<TodayReader, "wroteAfter">, threadId: string, message: TodayMessage): boolean {
  if (!message.attention || message.attention.handledAt) return true;
  if (read.wroteAfter(threadId, message.at)) return true;
  const source = message.attention.threadId;
  return Boolean(source && source !== threadId && read.wroteAfter(source, message.at));
}

/** The halves of the asks around a thread's open rows: a card pairs with an
 * input request within SAME_ASK_MS, and a rival of that pair sits within as
 * much again, so twice the span on each side is read, never the whole
 * transcript. */
function asksAround(read: TodayReader, threadId: string, open: readonly TodayMessage[]): TodayMessage[] {
  const spans: Array<[number, number]> = [];
  for (const row of [...open].sort((a, b) => a.at - b.at)) {
    const from = row.at - 2 * SAME_ASK_MS;
    const to = row.at + 2 * SAME_ASK_MS;
    const last = spans.at(-1);
    if (last && from <= last[1]) last[1] = Math.max(last[1], to);
    else spans.push([from, to]);
  }
  const out = new Map<string, TodayMessage>();
  for (const [from, to] of spans) for (const row of read.asks(threadId, from, to)) out.set(row.id, row);
  return [...out.values()];
}

/** The attention cards and proactive proposals waiting on this viewer. */
export function todayRows(deps: TodayDeps): InboxApproval[] {
  const read = deps.open ?? transcriptReader(deps);
  const out: InboxApproval[] = [];
  // #3542: the rows that may still wait, by thread, in time order
  const waiting = new Map<string, TodayMessage[]>();
  for (const { threadId, message } of read.rows()) {
    if (!mayWait(message)) continue;
    const list = waiting.get(threadId);
    if (list) list.push(message);
    else waiting.set(threadId, [message]);
  }
  for (const list of waiting.values()) list.sort((a, b) => a.at - b.at);
  for (const bot of deps.bots()) {
    if (bot.hidden) continue;
    for (const task of deps.threads(bot.id)) {
      if (task.archivedAt || task.confidential === true) continue;
      const open = waiting.get(task.threadId);
      if (!open?.length) continue;
      const asks = pairedAsks(asksAround(read, task.threadId, open));
      const cards = open.filter((row) => {
        if (row.inputRequest) return inputRequestOpen(row) && !asks.cardOf.has(row.id);
        if (!row.attention) return false;
        // #3512: the ask closed with its input request (answered, expired, skipped)
        const paired = asks.rowOf.get(row.id);
        if (paired && !inputRequestOpen(paired)) return false;
        return !attentionSettledBy(read, task.threadId, row);
      });
      if (!cards.length || !deps.isViewers(bot, task.threadId)) continue;
      for (const message of cards) {
        const card = message.attention ?? inputRequestAttention(message)!;
        const projected = deps.project(task.threadId, message);
        out.push({
          key: inboxKey(task.threadId, `${ATTENTION_PREFIX}${message.id}`),
          threadId: task.threadId,
          requestId: `${ATTENTION_PREFIX}${message.id}`,
          messageId: message.id,
          botId: bot.id,
          botName: bot.name,
          ...(card.threadTitle ? { threadTitle: card.threadTitle.slice(0, 200) } : task.title ? { threadTitle: task.title.slice(0, 200) } : {}),
          ...(card.routineName ? { routineName: card.routineName.slice(0, 200) } : {}),
          scope: "mine",
          kind: "attention",
          at: message.at,
          decidable: true,
          bulk: "question",
          // an input request row reads as the same "needs you" card
          message: message.attention ? projected : withAttention(projected, card),
        });
      }
    }
  }
  for (const proposal of deps.proposals()) {
    if (proposal.answered) continue;
    const bot = deps.bot(proposal.botId);
    if (!bot || bot.hidden) continue;
    const message = read.message(proposal.threadId, proposal.messageId);
    if (!message?.card || message.card.answered || message.card.dismissed || message.card.expired) continue;
    if (!deps.isViewers(bot, proposal.threadId)) continue;
    const title = deps.threads(bot.id).find((task) => task.threadId === proposal.threadId)?.title;
    out.push({
      key: inboxKey(proposal.threadId, `${PROACTIVE_PREFIX}${proposal.id}`),
      threadId: proposal.threadId,
      requestId: `${PROACTIVE_PREFIX}${proposal.id}`,
      messageId: message.id,
      botId: bot.id,
      botName: bot.name,
      // the bot's own conversation carries its name: "Echo · Echo" says nothing
      ...(title && title !== bot.name ? { threadTitle: title.slice(0, 200) } : {}),
      scope: "mine",
      kind: "proposal",
      proactiveId: proposal.id,
      at: message.at,
      decidable: true,
      bulk: "proposal",
      message: deps.project(proposal.threadId, message),
    });
  }
  // #4234: a routine run's form waits on the person until it is answered,
  // one item each, read from the run that moved it (no transcript is read)
  const listed = new Set<string>();
  for (const form of deps.forms?.() ?? []) {
    const key = inboxKey(form.threadId, `${FORM_PREFIX}${form.widgetId}`);
    if (listed.has(key)) continue;
    const bot = deps.bot(form.botId);
    if (!bot || bot.hidden) continue;
    const task = deps.threads(bot.id).find((candidate) => candidate.threadId === form.threadId);
    if (!task || task.archivedAt || task.confidential === true) continue;
    const message = read.message(form.threadId, form.widgetId);
    if (message?.kind !== "widget" || !message.widget?.root || message.widget.settled) continue;
    if (!deps.isViewers(bot, form.threadId)) continue;
    listed.add(key);
    out.push({
      key,
      threadId: form.threadId,
      requestId: `${FORM_PREFIX}${form.widgetId}`,
      messageId: message.id,
      botId: bot.id,
      botName: bot.name,
      ...(task.title && task.title !== bot.name ? { threadTitle: task.title.slice(0, 200) } : {}),
      ...(form.routineName ? { routineName: form.routineName.slice(0, 200) } : {}),
      scope: "mine",
      kind: "form",
      at: message.at,
      decidable: true,
      bulk: "special",
      message: deps.project(form.threadId, message),
    });
  }
  return out;
}

/** A hand-off's question card and the parked work's input request of the
 * same ask come seconds apart: a card pairs with the nearest input request
 * of its work thread within this span (src/lib/pending-question.ts). */
export const SAME_ASK_MS = 10 * 60_000;

/** An input request row still waiting on the person. */
export function inputRequestOpen(message: TodayMessage): boolean {
  const request = message.inputRequest;
  return Boolean(request && !request.reminder && !request.answered && !request.expired);
}

/** The asks of one transcript: each hand-off question card with the input
 * request of the same ask, nearest first, each used once. */
export function pairedAsks(rows: readonly TodayMessage[]): { rowOf: Map<string, TodayMessage>; cardOf: Map<string, TodayMessage> } {
  const cards = rows.filter((row) => row.attention?.kind === "question" && !row.inputRequest && row.attention.threadId);
  const requests = rows.filter((row) => row.inputRequest && !row.inputRequest.reminder);
  const pairs: Array<{ card: TodayMessage; row: TodayMessage; gap: number }> = [];
  for (const card of cards) {
    for (const row of requests) {
      if (row.inputRequest!.threadId !== card.attention!.threadId) continue;
      const gap = Math.abs(row.at - card.at);
      if (gap <= SAME_ASK_MS) pairs.push({ card, row, gap });
    }
  }
  pairs.sort((a, b) => a.gap - b.gap || a.row.at - b.row.at);
  const rowOf = new Map<string, TodayMessage>();
  const cardOf = new Map<string, TodayMessage>();
  for (const pair of pairs) {
    if (rowOf.has(pair.card.id) || cardOf.has(pair.row.id)) continue;
    rowOf.set(pair.card.id, pair.row);
    cardOf.set(pair.row.id, pair.card);
  }
  return { rowOf, cardOf };
}

/** An input request row as the "needs you" card it is drawn as (the pinned
 * row's inputRequestCard, src/lib/pending-question.ts). */
export function inputRequestAttention(message: TodayMessage): PersonAttentionCard | undefined {
  const request = message.inputRequest;
  if (!request) return undefined;
  return {
    kind: "question",
    botId: request.botId,
    botName: request.botName,
    threadId: request.threadId,
    ...(request.title ? { threadTitle: request.title } : {}),
    sourceMessageId: message.id,
    items: [{ text: request.question }],
  } as PersonAttentionCard;
}

function withAttention(projected: unknown, attention: PersonAttentionCard): unknown {
  return projected && typeof projected === "object" ? { ...(projected as Record<string, unknown>), attention } : projected;
}

/** #3471, #3543: the person settled a question in words (an attention card
 * or an input request row) of a conversation of theirs: skipped, marked
 * handled, or answered with their own words. `close` closes it the one way
 * (waiting-card-skip.ts, closePersonRequest) and tells the waiting work;
 * the other half of the same ask (the hand-off's card and its input
 * request) closes with it, quietly, so every surface drops it at once.
 * False when it is not one of this viewer's open questions. */
export function settlePersonRequestCard(
  deps: Pick<TodayDeps, "bot" | "messages" | "isViewers"> & {
    close(threadId: string, message: TodayMessage, quiet?: boolean): boolean;
  },
  botId: string, threadId: string, messageId: string,
): boolean {
  const bot = deps.bot(botId);
  if (!bot || !deps.isViewers(bot, threadId)) return false;
  const rows = deps.messages(threadId);
  const message = rows.find((row) => row.id === messageId);
  if (!message || !deps.close(threadId, message)) return false;
  const asks = pairedAsks(rows);
  const partner = message.inputRequest ? asks.cardOf.get(message.id) : asks.rowOf.get(message.id);
  // read again: the waiting work's own settle may have closed it already
  const current = partner ? deps.messages(threadId).find((row) => row.id === partner.id) : undefined;
  if (current) deps.close(threadId, current, true);
  return true;
}
