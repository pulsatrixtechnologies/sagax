// @ts-nocheck
/** interruptAllDirectThreads (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createInterruptAllDirectThreads(getHost: () => Host): any {
async function interruptAllDirectThreads(botId: string) {
  const host = getHost();

  const coordinated = host.coordinator.activeDirectThreads();
  const threads = host.store.tasks(botId).filter((task) => task.busy || host.directTurnDispatchClaims.has(task.threadId) || coordinated.has(task.threadId) || host.pendingComputerResumes.has(task.threadId));
  // Revoke every sibling before yielding to any provider teardown.
  for (const task of threads) {
    host.cancelDirectTurnDispatch(botId, task.threadId);
    host.revokeInternalCapabilitiesForThread(task.threadId);
  }
  await Promise.all(threads.map((task) => host.interruptDirectThread(botId, task.threadId)));

}
  return interruptAllDirectThreads;
}
