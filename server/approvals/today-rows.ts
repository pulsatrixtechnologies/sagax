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
import type { InboxApproval } from "../../shared/approvals-inbox.ts";
import { inboxKey } from "../../shared/approvals-inbox.ts";
import type { PersonAttentionCard } from "../../shared/person-attention.ts";

export const ATTENTION_PREFIX = "attention:";
export const PROACTIVE_PREFIX = "proactive:";

export interface TodayBot { id: string; name: string; hidden?: boolean }

export interface TodayMessage {
  id: string;
  at: number;
  role?: string;
  kind?: string;
  attention?: PersonAttentionCard;
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
      const cards = rows.filter((row) => row.attention && !attentionSettled(row, rows,
        row.attention.threadId && row.attention.threadId !== task.threadId ? deps.messages(row.attention.threadId) : []));
      if (!cards.length || !deps.isViewers(bot, task.threadId)) continue;
      for (const message of cards) {
        const card = message.attention!;
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
          message: deps.project(task.threadId, message),
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

/** Mark one attention card handled; false when it is not one of this
 * viewer's open cards. */
export function markAttentionHandled(
  deps: Pick<TodayDeps, "bot" | "messages" | "isViewers"> & { patch(threadId: string, messageId: string, attention: PersonAttentionCard): void },
  botId: string, threadId: string, messageId: string, now = Date.now(),
): boolean {
  const bot = deps.bot(botId);
  if (!bot) return false;
  const message = deps.messages(threadId).find((row) => row.id === messageId);
  if (!message?.attention || message.attention.handledAt || !deps.isViewers(bot, threadId)) return false;
  deps.patch(threadId, messageId, { ...message.attention, handledAt: now });
  return true;
}
