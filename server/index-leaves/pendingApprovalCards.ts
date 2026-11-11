// @ts-nocheck
/** pendingApprovalCards (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createPendingApprovalCards(getHost: () => Host): any {
/** The open approval cards of every bot's tasks and every room and its
 * tasks. #3662: the approval half of pendingInboxCards, which reads only the
 * open request card rows through the store's index: reading each transcript
 * decoded every message of the server's history on the main thread. */
function pendingApprovalCards(): Array<{ bot: BotRecord; threadId: string; message: Message; card: NonNullable<Message["card"]> }> {
  const host = getHost();
  const out: Array<{ bot: BotRecord; threadId: string; message: Message; card: NonNullable<Message["card"]> }> = [];
  for (const { bot, threadId, message, card, question } of host.pendingInboxCards()) {
    if (!question) out.push({ bot, threadId, message, card });
  }
  return out;
}
  return pendingApprovalCards;
}
