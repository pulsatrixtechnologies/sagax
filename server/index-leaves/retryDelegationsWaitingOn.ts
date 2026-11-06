// @ts-nocheck
/** retryDelegationsWaitingOn (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createRetryDelegationsWaitingOn(getHost: () => Host): any {
function retryDelegationsWaitingOn(botId: string) {
  const host = getHost();

  if (host.releasedBots.has(botId)) return;
  host.releasedBots.add(botId);
  queueMicrotask(() => {
    host.releasedBots.delete(botId);
    host.drainDelegationWakes();
    host.coordinator.tick();
  });

}
  return retryDelegationsWaitingOn;
}
