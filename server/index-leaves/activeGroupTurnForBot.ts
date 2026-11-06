// @ts-nocheck
/** activeGroupTurnForBot (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createActiveGroupTurnForBot(getHost: () => Host): any {
function activeGroupTurnForBot(botId: string): { group: GroupRecord; threadId: string } | null {
  const host = getHost();

  for (const group of host.store.groups) {
    for (const operation of host.groupTurnOperations.get(group.id) ?? []) {
      if (!operation.cancelled && operation.botIds.has(botId)) {
        return { group, threadId: operation.threadId };
      }
    }
    for (const [threadId, speaker] of host.groupSpeakers) {
      if (speaker.botId !== botId) continue;
      const ownsThread = group.dm
        ? group.threadId === threadId
        : Boolean(host.store.groupTaskByThread(group.id, threadId));
      if (ownsThread) return { group, threadId };
    }
    if (group.busyBotId === botId) {
      return { group, threadId: group.threadId };
    }
  }
  return null;

}
  return activeGroupTurnForBot;
}
