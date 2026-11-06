// @ts-nocheck
/** interruptAllDirectThreads (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createInterruptAllDirectThreads(getHost: () => Host): any {
async function interruptAllDirectThreads(botId: string): Promise<void> {
  const host = getHost();
  // Every thread with a turn, or with a root the runtime still owes a turn
  // (parked on cards, queued on a seat, waiting on teammates).
  const coordinated = host.coordinator.activeDirectThreads();
  const threads = host.store.tasks(botId).filter((task) => task.busy || host.directTurnDispatchClaims.has(task.threadId) || coordinated.has(task.threadId));
  // Revoke every sibling before yielding to any provider teardown.
  for (const task of threads) {
    host.cancelDirectTurnDispatch(botId, task.threadId);
    host.revokeInternalCapabilitiesForThread(task.threadId);
  }
  await Promise.all(threads.map((task) => host.interruptDirectThread(botId, task.threadId)));
}
  return interruptAllDirectThreads;
}
