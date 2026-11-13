// @ts-nocheck
/** openQuestionCard (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createOpenQuestionCard(getHost: () => Host): any {
function openQuestionCard(threadId: string) {
  const host = getHost();

  const messages = host.store.messagesFor(threadId);
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]!;
    const card = message.kind === "options" ? message.card : undefined;
    if (!card?.requestId || card.answered || card.dismissed || card.expired) continue;
    // #4205: a card raised with wait false waits for the person but holds
    // nothing: not the run, not the conversation's turn state
    if (card.noHold) continue;
    if (host.isPersistentQuestionCard(card) && !host.isApprovalCardMessage(message)) return card;
  }
  return undefined;

}
  return openQuestionCard;
}
