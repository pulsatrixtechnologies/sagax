// @ts-nocheck
/** pendingInboxCards (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createPendingInboxCards(getHost: () => Host): any {
function pendingInboxCards(): Array<{ bot: BotRecord; threadId: string; message: Message; card: NonNullable<Message["card"]>; question: boolean }> {
  const host = getHost();

  const out: Array<{ bot: BotRecord; threadId: string; message: Message; card: NonNullable<Message["card"]>; question: boolean }> = [];
  const threads = new Set<string>();
  for (const bot of host.store.bots) for (const task of host.store.tasks(bot.id)) threads.add(task.threadId);
  for (const group of host.store.groups) {
    threads.add(group.threadId);
    for (const task of host.store.groupTasks(group.id)) threads.add(task.threadId);
  }
  for (const threadId of threads) {
    for (const message of host.store.messagesFor(threadId)) {
      const card = message.card;
      if (!card?.requestId || card.approvalOrigin || card.answered || card.dismissed || card.expired || message.kind !== "options") continue;
      const question = host.isPersistentQuestionCard(card) && !host.isApprovalCardMessage(message);
      if (!question && !host.isApprovalCardMessage(message)) continue;
      const bot = host.botForApproval(threadId, message);
      if (bot) out.push({ bot, threadId, message, card, question });
    }
  }
  return out;

}
  return pendingInboxCards;
}
