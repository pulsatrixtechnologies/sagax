// @ts-nocheck
/** coordinatorSlotUse (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createCoordinatorSlotUse(getHost: () => Host): any {
function coordinatorSlotUse(n: HandoffView): { used: number; max: number; hardBlocked: boolean } | undefined {
  const host = getHost();

  if (host.reviewHolds(n)) return { used: 0, max: 0, hardBlocked: true };
  if (n.oneWay && n.priority !== "now" && n.parentId && ["source", "running"].includes(host.coordinator.node(n.parentId)?.status ?? "")) {
    return { used: 0, max: 0, hardBlocked: true };
  }
  // A room turn holds no thread slot (unattendedDispatchState): no slot
  // math, so host.busy admits it. Counted as {used 0, max 0}, every room
  // handoff and goal worker waited "for a free slot" forever (DEL-08).
  if (n.groupId) return undefined;
  // DEL-08's slot admission bypasses host.busy, where queued work used to
  // explain the person's card holding the last slot. Keep that receipt.
  host.noteQueuedBehindPerson(n);
  const hardBlocked = host.threadBusy(n.botId, n.threadId) || Boolean(host.activeGroupTurnForBot(n.botId));
  return {
    used: host.botBusyThreadCount(n.botId),
    max: botMaxConcurrentThreads(host.store.bot(n.botId), host.cfg),
    hardBlocked
  };

}
  return coordinatorSlotUse;
}
