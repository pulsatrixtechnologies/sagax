// @ts-nocheck
/** locateChannelMessage (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createLocateChannelMessage(getHost: () => Host): any {
function locateChannelMessage(messageId: string): { threadId: string; messages: Message[] } | null {
  const host = getHost();

  for (const group of host.store.groups) {
    for (const threadId of host.groupThreadIds(group)) {
      const messages = host.store.messagesFor(threadId);
      if (messages.some((message) => message.id === messageId)) return { threadId, messages };
    }
  }
  return null;

}
  return locateChannelMessage;
}
