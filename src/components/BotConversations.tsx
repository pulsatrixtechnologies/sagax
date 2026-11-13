// A bot-to-bot conversation named on both ends (WireBot.botConversations,
// server/peers/inter-bot-conversations.ts) is drawn as the same quiet centered line
// the transcript uses for a bot-to-bot exchange (ConversationLink), at its
// place in time, never stacked above the chat. Clicking it opens the same
// exchange sheet a collapsed exchange opens (A ⇄ B, each bot's lines, Close
// Chat). The server only names a conversation to a viewer who may read it, on
// both bots; the messages come from the same thread route as any conversation.
import { useState } from "react";
import { api, type Bot, type Message } from "@/state/store";
import type { ExchangeRun } from "@/lib/bot-exchange";
import { t } from "@/lib/i18n";
import { ConversationLink } from "./ConversationLink";
import { ExchangeSheet, avatarBot } from "./BotExchangeChip";
import { isAgentParty } from "./PartyAvatar";

export type BotConversationRow = NonNullable<Bot["botConversations"]>[number];

/** The thread's lines, each credited to its bot. The thread belongs to the
 * destination bot: a line names its speaker (`from`), else a person-side line
 * is the origin bot's words and a reply is the destination's. */
export function creditedLines(messages: readonly Message[], self: Pick<Bot, "id" | "name" | "color">, other: { id: string; name: string; color?: string }, direction: "in" | "out"): Message[] {
  const origin = direction === "in" ? other : self;
  const destination = direction === "in" ? self : other;
  const party = (bot: { id: string; name: string; color?: string }) => ({ botId: bot.id, name: bot.name, color: (bot.color ?? "blue") as NonNullable<Message["from"]>["color"] });
  // An outside agent's conversation (2026-10-29): its lines are stamped as
  // an AI client's (#291); here they are that agent's, named after it.
  const agentLines = isAgentParty(other.id);
  return messages.map((message) => {
    if (agentLines && message.aiClient === true && !message.peerAsk) return { ...message, aiClient: undefined, from: party(other) };
    return message.from ? message : { ...message, from: party(message.role === "user" ? origin : destination) };
  });
}

/** Where each line goes: before the first row that starts after it. Rows
 * older than the loaded window are left out while earlier pages remain. */
export function conversationAnchors(rows: readonly BotConversationRow[], rowStarts: readonly number[], hasMore: boolean): { before: Map<number, BotConversationRow[]>; after: BotConversationRow[] } {
  const before = new Map<number, BotConversationRow[]>();
  const after: BotConversationRow[] = [];
  const sorted = [...rows].sort((a, b) => (a.startedAt ?? a.updatedAt ?? 0) - (b.startedAt ?? b.updatedAt ?? 0));
  for (const row of sorted) {
    const at = row.startedAt ?? row.updatedAt ?? 0;
    const index = rowStarts.findIndex((start) => start > at);
    if (index === 0 && hasMore) continue;
    if (index === -1) after.push(row);
    else before.set(index, [...(before.get(index) ?? []), row]);
  }
  return { before, after };
}

/** The conversations to draw for a thread: only the main chat names them, and
 * one the transcript already links to keeps its own line there. */
export function visibleConversationRows(selfBot: Pick<Bot, "botConversations" | "mainThreadId" | "threadId"> | undefined, threadId: string, transcript: readonly Message[]): BotConversationRow[] {
  const rows = selfBot?.botConversations ?? [];
  if (!selfBot || !rows.length || threadId !== (selfBot.mainThreadId ?? selfBot.threadId)) return [];
  const linked = new Set(transcript.flatMap((message) => [message.threadRef?.threadId, message.comm?.threadId]).filter(Boolean));
  return rows.filter((row) => row.threadId !== threadId && !linked.has(row.threadId));
}

/** Splits the rows into the ones older than the first loaded line (they open
 * the topic, so they fold behind "Earlier topics") and the ones that sit in
 * the middle of the transcript. With no line yet, every row is a leading one.
 * Rows older than a partial window stay out while earlier pages remain. */
export function splitLeadingConversations(rows: readonly BotConversationRow[], firstAt: number | undefined, hasMore: boolean): { leading: BotConversationRow[]; inline: BotConversationRow[] } {
  const leading: BotConversationRow[] = [];
  const inline: BotConversationRow[] = [];
  for (const row of rows) {
    const at = row.startedAt ?? row.updatedAt ?? 0;
    if (firstAt === undefined || at < firstAt) {
      if (!hasMore) leading.push(row);
    } else inline.push(row);
  }
  return { leading, inline };
}

/** One row per bot, the most recent, newest first. */
export function dedupeConversations(rows: readonly BotConversationRow[]): BotConversationRow[] {
  const latest = new Map<string, BotConversationRow>();
  const when = (row: BotConversationRow) => row.updatedAt ?? row.startedAt ?? 0;
  for (const row of rows) {
    const key = row.otherBotId || row.threadId;
    const kept = latest.get(key);
    if (!kept || when(row) > when(kept)) latest.set(key, row);
  }
  return [...latest.values()].sort((a, b) => when(b) - when(a));
}

/** The compact list inside the unfolded "Earlier topics". */
export function EarlierConversationList({ self, rows, bots }: { self: Pick<Bot, "id" | "name" | "color">; rows: readonly BotConversationRow[]; bots: readonly Bot[] }) {
  const list = dedupeConversations(rows);
  if (!list.length) return null;
  return (
    <div className="flex flex-col items-start px-1 py-1" data-earlier-conversations>
      {list.map((row) => <BotConversationLine key={`earlier:${row.threadId}`} self={self} row={row} bots={bots} compact />)}
    </div>
  );
}

export function BotConversationLine({ self, row, bots, compact = false }: { self: Pick<Bot, "id" | "name" | "color">; row: BotConversationRow; bots: readonly Bot[]; compact?: boolean }) {
  const [run, setRun] = useState<ExchangeRun | null>(null);
  // a failed read says so in the sheet, never a blank sheet (#1502)
  const [loadError, setLoadError] = useState(false);
  const other = avatarBot({ id: row.otherBotId, name: row.otherName }, bots);
  const open = () => {
    void api<{ messages?: Message[] }>(`/api/threads/${row.threadId}/messages?limit=200`)
      .then((page) => ({ messages: page.messages ?? [], failed: false }))
      .catch(() => ({ messages: [] as Message[], failed: true }))
      .then(({ messages, failed }) => {
        const otherParty = { id: row.otherBotId, name: row.otherName, color: other.color };
        setLoadError(failed);
        setRun({
          id: `conversation:${row.threadId}`,
          messages: creditedLines(messages, self, otherParty, row.direction),
          party: otherParty,
          ends: [{ id: self.id, name: self.name, color: self.color }, otherParty],
        });
      });
  };
  return (
    <ConversationLink
      bot={other}
      agentId={row.otherBotId}
      name={row.otherName}
      color={other.color}
      testId="bot-exchange-chip"
      attributes={{ "data-bot-conversation": row.direction, "data-thread-chip": row.threadId }}
      label={t("chat.goToConversationWith", { name: row.otherName })}
      compact={compact}
      onClick={open}
    >
      {run && <ExchangeSheet run={run} bots={bots} loadError={loadError} onRetry={open} onClose={() => setRun(null)} />}
    </ConversationLink>
  );
}
