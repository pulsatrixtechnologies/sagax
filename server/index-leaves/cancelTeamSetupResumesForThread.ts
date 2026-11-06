// @ts-nocheck
/** cancelTeamSetupResumesForThread (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createCancelTeamSetupResumesForThread(getHost: () => Host): any {
function cancelTeamSetupResumesForThread(threadId: string) {
  const host = getHost();

  // Invalidate before provider teardown can synchronously drain the queue.
  // The generation also prevents an in-flight dispatch failure requeueing
  // its old entry after Stop or deletion has already cancelled it.
  host.teamSetupResumeGenerations.set(threadId, (host.teamSetupResumeGenerations.get(threadId) ?? 0) + 1);
  for (const [key, entry] of host.pendingTeamSetupResumes) {
    if (entry.request.threadId === threadId) host.pendingTeamSetupResumes.delete(key);
  }

}
  return cancelTeamSetupResumesForThread;
}
