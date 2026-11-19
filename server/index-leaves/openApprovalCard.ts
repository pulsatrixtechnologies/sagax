// @ts-nocheck
/** #4528: the open permission card of a conversation, newest first. A
 * routine run waiting on it keeps waiting through a restart: the card
 * stays, and its answer starts the run's next turn
 * (server/index-leaves/deliverLatePermission.ts). */
export type Host = Record<string, any>;

export function createOpenApprovalCard(getHost: () => Host): any {
function openApprovalCard(threadId: string) {
  const host = getHost();

  const messages = host.store.messagesFor(threadId);
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]!;
    const card = message.kind === "options" ? message.card : undefined;
    if (!card?.requestId || card.answered || card.dismissed || card.expired) continue;
    if (card.noHold) continue;
    if (host.isApprovalCardMessage(message)) return card;
  }
  return undefined;

}
  return openApprovalCard;
}
