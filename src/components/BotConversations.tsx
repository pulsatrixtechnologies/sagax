// A bot-to-bot conversation named on both ends (WireBot.botConversations,
// server/inter-bot-conversations.ts) is drawn as the same quiet centered line
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

export type BotConversationRow = NonNullable<Bot["botConversations"]>[number];

/** The thread's lines, each credited to its bot. The thread belongs to the
 * destination bot: a line names its speaker (`from`), else a person-side line
 * is the origin bot's words and a reply is the destination's. */
export function creditedLines(messages: readonly Message[], self: Pick<Bot, "id" | "name" | "color">, other: { id: string; name: string; color?: string }, direction: "in" | "out"): Message[] {
  const origin = direction === "in" ? other : self;
  const destination = direction === "in" ? self : other;
  const party = (bot: { id: string; name: string; color?: string }) => ({ botId: bot.id, name: bot.name, color: (bot.color ?? "blue") as NonNullable<Message["from"]>["color"] });
  return messages.map((message) => message.from ? message : { ...message, from: party(message.role === "user" ? origin : destination) });
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

export function BotConversationLine({ self, row, bots, showToolCalls = false }: { self: Pick<Bot, "id" | "name" | "color">; row: BotConversationRow; bots: readonly Bot[]; showToolCalls?: boolean }) {
  const [run, setRun] = useState<ExchangeRun | null>(null);
  const other = avatarBot({ id: row.otherBotId, name: row.otherName }, bots);
  const open = () => {
    void api<{ messages?: Message[] }>(`/api/threads/${row.threadId}/messages?limit=200`)
      .then((page) => page.messages ?? [])
      .catch(() => [] as Message[])
      .then((messages) => {
        const otherParty = { id: row.otherBotId, name: row.otherName, color: other.color };
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
      name={row.otherName}
      color={other.color}
      testId="bot-exchange-chip"
      attributes={{ "data-bot-conversation": row.direction, "data-thread-chip": row.threadId }}
      label={t("chat.goToConversationWith", { name: row.otherName })}
      onClick={open}
    >
      {run && <ExchangeSheet run={run} bots={bots} showToolCalls={showToolCalls} onClose={() => setRun(null)} />}
    </ConversationLink>
  );
}
