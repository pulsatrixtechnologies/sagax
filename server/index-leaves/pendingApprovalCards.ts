// @ts-nocheck
/** pendingApprovalCards (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createPendingApprovalCards(getHost: () => Host): any {
function pendingApprovalCards(): Array<{ bot: BotRecord; threadId: string; message: Message; card: NonNullable<Message["card"]> }> {
  const host = getHost();

  const out: Array<{ bot: BotRecord; threadId: string; message: Message; card: NonNullable<Message["card"]> }> = [];
  const threads = new Set<string>();
  for (const bot of host.store.bots) for (const task of host.store.tasks(bot.id)) threads.add(task.threadId);
  for (const group of host.store.groups) {
    threads.add(group.threadId);
    for (const task of host.store.groupTasks(group.id)) threads.add(task.threadId);
  }
  for (const threadId of threads) {
    for (const message of host.store.messagesFor(threadId)) {
      const card = message.card;
      if (!card?.requestId || card.approvalOrigin || card.answered || card.dismissed || card.expired || !host.isApprovalCardMessage(message)) continue;
      const bot = host.botForApproval(threadId, message);
      if (bot) out.push({ bot, threadId, message, card });
    }
  }
  return out;

}
  return pendingApprovalCards;
}
