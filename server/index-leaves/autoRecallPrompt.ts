// @ts-nocheck
/** autoRecallPrompt (#1388). Pure move from server/index.ts. */
import { buildRecall } from "../recall/recall.ts";
export type Host = Record<string, any>;

export function createAutoRecallPrompt(getHost: () => Host): any {
function autoRecallPrompt(bot: BotRecord, threadId: string, message: string, opts: { conversations: boolean; userName: string; budget?: RecallBudget; audience?: MemoryDestination }) {
  const host = getHost();
  const { autoRecallEnabled, semanticRecallEnabled } = host;

  if (bot.memoryEnabled === false || !autoRecallEnabled(host.cfg)) return "";
  const roomByThread = new Map<string, GroupRecord>();
  if (opts.conversations) {
    for (const group of host.store.groups) {
      if (!group.memberIds.includes(bot.id) || !host.roomFeedsBot(group, bot)) continue;
      roomByThread.set(group.threadId, group);
      for (const task of group.tasks ?? []) roomByThread.set(task.threadId, group);
    }
  }
  const privateAllow = host.privateRecallFilter(bot, threadId);
  const threadIds = opts.conversations
    ? [...new Set([bot.threadId, ...(bot.tasks ?? []).map((task) => task.threadId), ...roomByThread.keys()])]
      // On a Cloud home a conversation anyone else wrote in never feeds
      // another: its words would reach the owner's turns (and a lent Mac).
      // On an organization server, only this turn's person's own threads.
      .filter((id) => id !== threadId && (!privateAllow || privateAllow(id)))
    : [];
  try {
    const recalled = buildRecall({
      botId: bot.id,
      message,
      threadIds,
      label: (id) => {
        const room = roomByThread.get(id);
        if (room) return `room ${JSON.stringify(room.name)}`;
        const task = host.store.taskByThread(bot.id, id);
        if (task) return `chat ${JSON.stringify(task.title)}`;
        return id === bot.threadId ? "your main chat" : "an earlier chat";
      },
      author: (hit) => (hit.role === "user" ? hit.peer ?? opts.userName : hit.from ?? bot.name),
      ...(opts.budget ? { budget: opts.budget } : {}),
      ...(opts.audience ? { audience: opts.audience } : {}),
      // the local semantic index (server/recall/semantic-index.ts): on unless
      // switched off; FTS5 still fills the block first
      semantic: semanticRecallEnabled(host.cfg)
    });
    if (recalled) console.log(host.autoRecallLogLine(bot.id, recalled.notes, recalled.conversations, threadId));
    // its memory recalled in this conversation (Total Recall, for whoever wrote that memory)
    if (recalled?.notes) host.recordMastery([{ person: host.achievementThreadPerson(threadId) ?? "", fact: { kind: "memory.recalled", botId: bot.id, threadId } }]);
    return recalled?.text ?? "";
  } catch (err) {
    console.warn(`auto-recall failed for ${bot.id}: ${(err as Error).message}`);
    return "";
  }

}
  return autoRecallPrompt;
}
