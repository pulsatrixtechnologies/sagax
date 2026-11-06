// @ts-nocheck
/** turnsHeldOnGroup (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createTurnsHeldOnGroup(getHost: () => Host): any {
function turnsHeldOnGroup(group: GroupRecord) {
  const host = getHost();

  const threadIds = host.groupThreadIds(group);
  const queued = host.queuedWorkerTurns.flatMap((item) => {
    const located = host.locateChannelMessage(item.messageId);
    return located ? [{ messageId: item.messageId, threadId: located.threadId }] : [];
  });
  const inflight = host.allInflightIds().flatMap((messageId) => {
    const located = host.locateChannelMessage(messageId);
    return located ? [{ messageId, threadId: located.threadId }] : [];
  });
  return turnsOpenForMembership({ threadIds, queued, inflight });

}
  return turnsHeldOnGroup;
}
