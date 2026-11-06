// @ts-nocheck
/** drainComputerResumes (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createDrainComputerResumes(getHost: () => Host): any {
function drainComputerResumes() {
  const host = getHost();

  for (const [key, entry] of host.pendingComputerResumes) {
    if (!host.connectorThread(entry.botId, entry.threadId)) {
      host.pendingComputerResumes.delete(key);
      continue;
    }
    // A newer ask replaced the parked work: the resume is stale, not blocked.
    const latestUser = host.store.activePath(entry.threadId).findLast((message) => message.role === "user")?.id;
    if (entry.afterMessageId !== undefined && latestUser !== entry.afterMessageId) {
      host.pendingComputerResumes.delete(key);
      continue;
    }
    // A newer generation owns the thread — a new turn superseded the parked
    // one — so the parked resume is stale too. The parked turn's OWN
    // generation is still current while it settles: the lazy-claim park
    // registers its resume before the interrupt lands, and a drain in that
    // window must keep the entry (#1651), not read busy as superseded.
    const activeGeneration = host.activeInternalGenerationByThread.get(entry.threadId);
    if (activeGeneration !== undefined && activeGeneration !== entry.generation) {
      host.pendingComputerResumes.delete(key);
      continue;
    }
    // Busy under the parked generation: the turn is still settling. Keep the
    // entry; the next drain (its completion, the next release) dispatches.
    if (host.threadBusy(entry.botId, entry.threadId)) continue;
    if (!host.turnResources.free(entry.resource)) continue;
    host.pendingComputerResumes.delete(key);
    host.dispatchComputerResume(entry);
  }

}
  return drainComputerResumes;
}
