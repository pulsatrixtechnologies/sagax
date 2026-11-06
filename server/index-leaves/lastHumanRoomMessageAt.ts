// @ts-nocheck
/** lastHumanRoomMessageAt (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createLastHumanRoomMessageAt(getHost: () => Host): any {
function lastHumanRoomMessageAt(group: GroupRecord) {
  const host = getHost();

  const messages = host.store.messagesFor(group.threadId);
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.role === "user" && message.kind === "text" && !message.via) return message.at;
  }
  return undefined;

}
  return lastHumanRoomMessageAt;
}
