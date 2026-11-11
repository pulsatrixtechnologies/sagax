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
// conversation after it, or marks it handled (POST /api/approvals/handled).
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

export interface TodayBot { id: string; name: string; hidden?: boolean }

export interface TodayMessage {
  id: string;
  at: number;
  role?: string;
  kind?: string;
  attention?: PersonAttentionCard;
  inputRequest?: WireMessage["inputRequest"];
  card?: { answered?: unknown; dismissed?: unknown; expired?: unknown; proactiveProposal?: { id: string } };
}

export interface TodayProposal { id: string; botId: string; threadId: string; messageId: string; createdAt: number; answered?: string }

export interface TodayDeps {
  bots(): readonly TodayBot[];
  bot(id: string): TodayBot | undefined;
  threads(botId: string): readonly { threadId: string; title?: string; confidential?: boolean; archivedAt?: number }[];
  messages(threadId: string): readonly TodayMessage[];
  /** The viewer is the person this conversation's cards are for. */
  isViewers(bot: TodayBot, threadId: string): boolean;
  /** The open proactive proposals (not answered, not expired). */
  proposals(): readonly TodayProposal[];
  /** The message exactly as the viewer's conversation shows it. */
  project(threadId: string, message: TodayMessage): unknown;
}

/** An attention card is settled once handled, or once the person wrote
 * after it, in that conversation or in the thread the bot asked in (the
 * card's reply goes there): their words are the answer. */
export function attentionSettled(message: TodayMessage, rows: readonly TodayMessage[], sourceRows: readonly TodayMessage[] = []): boolean {
  if (!message.attention) return true;
  if (message.attention.handledAt) return true;
  return rows.some((row) => row.role === "user" && row.at > message.at) || sourceRows.some((row) => row.role === "user" && row.at > message.at);
}

/** The attention cards and proactive proposals waiting on this viewer. */
export function todayRows(deps: TodayDeps): InboxApproval[] {
  const out: InboxApproval[] = [];
  for (const bot of deps.bots()) {
    if (bot.hidden) continue;
    for (const task of deps.threads(bot.id)) {
      if (task.archivedAt || task.confidential === true) continue;
      const rows = deps.messages(task.threadId);
      const asks = pairedAsks(rows);
      const cards = rows.filter((row) => {
        if (row.inputRequest) return inputRequestOpen(row) && !asks.cardOf.has(row.id);
        if (!row.attention) return false;
        // #3512: the ask closed with its input request (answered, expired, skipped)
        const paired = asks.rowOf.get(row.id);
        if (paired && !inputRequestOpen(paired)) return false;
        return !attentionSettled(row, rows, row.attention.threadId && row.attention.threadId !== task.threadId ? deps.messages(row.attention.threadId) : []);
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
    const message = deps.messages(proposal.threadId).find((row) => row.id === proposal.messageId);
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

/** Mark one attention card handled; false when it is not one of this
 * viewer's open cards. */
export function markAttentionHandled(
  deps: Pick<TodayDeps, "bot" | "messages" | "isViewers"> & {
    patch(threadId: string, messageId: string, attention: PersonAttentionCard): void;
    /** #3512: an input request row, marked answered (the person's words went
     * to the waiting work, or they handled it). */
    patchRequest?(threadId: string, messageId: string, inputRequest: NonNullable<TodayMessage["inputRequest"]>): void;
  },
  botId: string, threadId: string, messageId: string, now = Date.now(),
): boolean {
  const bot = deps.bot(botId);
  if (!bot) return false;
  const rows = deps.messages(threadId);
  const message = rows.find((row) => row.id === messageId);
  if (!message || !deps.isViewers(bot, threadId)) return false;
  const asks = pairedAsks(rows);
  if (message.inputRequest) {
    if (!inputRequestOpen(message) || !deps.patchRequest) return false;
    deps.patchRequest(threadId, messageId, { ...message.inputRequest, answered: true });
    const card = asks.cardOf.get(message.id);
    if (card?.attention && !card.attention.handledAt) deps.patch(threadId, card.id, { ...card.attention, handledAt: now });
    return true;
  }
  if (!message.attention || message.attention.handledAt) return false;
  deps.patch(threadId, messageId, { ...message.attention, handledAt: now });
  // the same ask's input request settles with it: every surface drops it at once
  const row = asks.rowOf.get(message.id);
  if (row?.inputRequest && inputRequestOpen(row)) deps.patchRequest?.(threadId, row.id, { ...row.inputRequest, answered: true });
  return true;
}

/** #3471: the person skipped a question in words (an attention card or an
 * input request row) in a conversation of theirs: `close` closes it as
 * skipped and tells the waiting work (waiting-card-skip.ts). */
export function skipPersonRequestCard(
  deps: Pick<TodayDeps, "bot" | "messages" | "isViewers"> & { close(threadId: string, message: TodayMessage): boolean },
  botId: string, threadId: string, messageId: string,
): boolean {
  const bot = deps.bot(botId);
  if (!bot || !deps.isViewers(bot, threadId)) return false;
  const message = deps.messages(threadId).find((row) => row.id === messageId);
  if (!message) return false;
  return deps.close(threadId, message);
}
