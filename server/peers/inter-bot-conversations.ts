// Bot-to-bot conversations shown in both bots' chats (2026-10-19).
//
// A conversation one bot opened on another (a "pair" or "work" thread, or an
// agent ask) lives on the destination bot and is never listed in a sidebar.
// The wire bot now names it on BOTH ends, so each chat can show the same
// exchange as the same quiet centered line the transcript already uses for a
// bot-to-bot exchange, at its place in time (startedAt):
//
//   - the destination's chat names it as "in" (the other bot opened it);
//   - the origin's chat names it as "out" (this bot opened it on the other).
//
// An outside agent's conversation (a person's AI client over MCP, kind
// "agent", shared/agent-conversation.ts) has one end only: the bot's chat
// names it "in", with the agent's name and its `agent:<slug>` id.
//
// Only names and ids travel here; the messages are read through
// GET /api/threads/:id/messages, so a viewer sees the transcript by the same
// rule as any thread. `mayRead` is that rule applied to the conversation: on
// an organization server a person who cannot read the thread, or cannot use
// both bots, gets no entry at all (see botForViewer in server/index.ts).
import type { WireBotConversation } from "../../shared/wire.ts";

export interface ConversationTask {
  threadId: string;
  updatedAt?: number;
  createdAt?: number;
  routineRunId?: string;
  confidential?: boolean;
  openedBy?: { botId?: string; name?: string; kind?: string };
}
export interface ConversationBot { id: string; name?: string; tasks?: readonly ConversationTask[] }

const LIMIT = 10;

/**
 * `hasMessages`: whether the thread holds a message yet. A thread that was
 * opened but never written to (the other bot's turn never started) is not
 * listed: its line opened a blank sheet (#1502). A running one is, since its
 * first message is on its way. Asked only for the rows that could be shown,
 * newest first, until LIMIT of them hold messages.
 */
export function interBotConversations(
  botId: string,
  bots: readonly ConversationBot[],
  mayRead: (owner: ConversationBot, task: ConversationTask, other: ConversationBot | undefined) => boolean = () => true,
  isRunning: (ownerId: string, threadId: string) => boolean = () => false,
  hasMessages: (ownerId: string, threadId: string) => boolean = () => true,
): WireBotConversation[] {
  const byId = new Map(bots.map((bot) => [bot.id, bot]));
  const out: Array<WireBotConversation & { ownerId: string }> = [];
  const add = (owner: ConversationBot, task: ConversationTask, otherId: string, direction: "in" | "out") => {
    if (task.routineRunId || task.confidential === true) return;
    const other = byId.get(otherId);
    if (!mayRead(owner, task, other)) return;
    const name = (direction === "in" ? other?.name ?? task.openedBy?.name : other?.name) ?? "";
    const kind = task.openedBy?.kind;
    out.push({
      ownerId: owner.id,
      threadId: task.threadId,
      otherBotId: otherId,
      otherName: name.trim().slice(0, 120),
      direction,
      ...(kind === "work" || kind === "pair" || kind === "agent" ? { kind } : {}),
      updatedAt: task.updatedAt ?? task.createdAt ?? 0,
      ...(typeof task.createdAt === "number" ? { startedAt: task.createdAt } : {}),
      ...(isRunning(owner.id, task.threadId) ? { running: true } : {}),
    });
  };
  const self = byId.get(botId);
  for (const task of self?.tasks ?? []) {
    const opener = task.openedBy?.botId;
    if (opener && opener !== botId) add(self!, task, opener, "in");
  }
  for (const bot of bots) {
    if (bot.id === botId) continue;
    for (const task of bot.tasks ?? []) {
      if (task.openedBy?.botId === botId) add(bot, task, bot.id, "out");
    }
  }
  const shown: WireBotConversation[] = [];
  for (const { ownerId, ...row } of out.filter((row) => row.otherName).sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))) {
    if (shown.length >= LIMIT) break;
    if (!row.running && !hasMessages(ownerId, row.threadId)) continue;
    shown.push(row);
  }
  return shown;
}
