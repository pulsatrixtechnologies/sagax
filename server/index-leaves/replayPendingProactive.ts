// @ts-nocheck
/** replayPendingProactive (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createReplayPendingProactive(getHost: () => Host): any {
function replayPendingProactive() {
  const host = getHost();

  for (const row of host.proactivePending.take()) {
    try {
      if (row.ref.kind === "peer") {
        const child = host.coordinator.node(row.ref.noticeId);
        if (!child || child.botId !== row.botId || !child.oneWay || !["completed", "failed", "cancelled", "expired"].includes(child.status)) continue;
        host.offerPeerNotice(child, child.parentId ? host.coordinator.node(child.parentId) : undefined);
      } else {
        const ref = row.ref;
        const room = host.store.group(ref.groupId);
        const poster = host.store.bot(ref.posterId);
        if (!room || !poster || room.threadId !== ref.threadId) continue;
        const posted = host.store.messagesFor(room.threadId).find((message) => message.id === ref.messageId);
        if (!posted || typeof posted.text !== "string" || !posted.text.trim()) continue;
        host.offerRoomPostToBots(room, poster, posted.text, posted.id, ref.hops, row.botId);
      }
    } catch (error) {
      console.warn(`[proactive] a pending event could not be replayed: ${error instanceof Error ? error.name : "error"}`);
    }
  }

}
  return replayPendingProactive;
}
