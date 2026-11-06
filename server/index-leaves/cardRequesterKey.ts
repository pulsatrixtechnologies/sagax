// @ts-nocheck
/** cardRequesterKey (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createCardRequesterKey(getHost: () => Host): any {
function cardRequesterKey(threadId: string, requestId: string) {
  const host = getHost();

  const thread = host.store.messagesFor(threadId);
  const index = thread.findIndex((message) => message.card?.requestId === requestId);
  if (index < 0) return undefined;
  const card = thread[index]!;
  return host.linePersonKey(card.requestMessageId
    ? thread.find((message) => message.id === card.requestMessageId)
    : thread.slice(0, index).findLast((message) => message.role === "user"));

}
  return cardRequesterKey;
}
