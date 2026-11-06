// @ts-nocheck
/** importLegacyDelegations (#1388). Pure move from server/index.ts. */
import { takeLegacyDelegations } from "../peers/delegation-receipts.ts";
export type Host = Record<string, any>;

export function createImportLegacyDelegations(getHost: () => Host): any {
function importLegacyDelegations() {
  const host = getHost();
  const { OUTSIDE } = host;

  for (const item of takeLegacyDelegations()) {
    if (host.legacyHandoffsDropped.has(item.sourceThreadId)) continue;
    const sender = host.store.bot(item.sourceBotId);
    const target = host.store.bot(item.toBotId);
    const group = host.store.groupByThread(item.sourceThreadId);
    if (!sender || !target || (!group && !host.store.taskByThread(sender.id, item.sourceThreadId))) continue;
    // A person can reuse a finished run's task for unrelated work: only the
    // old run's handoffs are dropped, not a later request's.
    const run = host.routines?.runForThread(item.sourceThreadId);
    const reused = run?.finishedAt !== undefined && host.store.activePath(item.sourceThreadId).some((message) => message.role === "user" && message.at > run.finishedAt!);
    if (run && !["running", "waiting"].includes(run.status) && !reused) continue;
    const address = { ...(group ? { groupId: group.id } : {}), threadId: item.sourceThreadId, botId: sender.id };
    // Where the ledger would have run it: the thread opened for it, else the
    // conversation the teammate keeps for its peers.
    const threadId = item.targetThreadId && host.store.taskByThread(target.id, item.targetThreadId) ? item.targetThreadId : host.peerThreadFor(target);
    if (!threadId) continue;
    const destination = { threadId, botId: target.id };
    try {
      if (item.external || item.oneWay || group) {
        host.coordinator.enqueueExternal(address, destination, item.message, item.approved, item.oneWay ? "notify" : "work");
      } else {
        const generation = `legacy-${item.id || randomUUID()}`;
        host.coordinator.enqueue(address, generation, undefined, destination, target.id, item.message, item.approved, false, "", undefined, item.origin ?? OUTSIDE);
        host.coordinator.sourceSettled(generation, true);
      }
    } catch (error) {
      console.error(`delegations: a queued handoff from an older release could not be handed on: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

}
  return importLegacyDelegations;
}
