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
  // #3542: the open option cards, found by the store's index of open
  // request cards: never every transcript of every bot and room (each
  // GET /api/approvals decoded every row of the server's history)
  for (const { threadId, message } of host.openRequestCardRows()) {
    if (!threads.has(threadId)) continue;
    const card = message.card;
    if (!card?.requestId || card.approvalOrigin || card.answered || card.dismissed || card.expired || message.kind !== "options") continue;
    const question = host.isPersistentQuestionCard(card) && !host.isApprovalCardMessage(message);
    if (!question && !host.isApprovalCardMessage(message)) continue;
    const bot = host.botForApproval(threadId, message);
    if (bot) out.push({ bot, threadId, message, card, question });
  }
  return out;

}
  return pendingInboxCards;
}
