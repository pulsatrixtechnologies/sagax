// @ts-nocheck
/** replaceQueuedWorkerTurns (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createReplaceQueuedWorkerTurns(getHost: () => Host): any {
function replaceQueuedWorkerTurns(next: DeviceQueuedTurn[]) {
  const host = getHost();

  const keyOf = (item: DeviceQueuedTurn) => `${item.deviceId}\0${item.userId}\0${item.messageId}\0${item.botId ?? ""}`;
  const prev = new Set(host.queuedWorkerTurns.filter((item) => !item.started).map(keyOf));
  host.queuedWorkerTurns = next;
  for (const item of next) {
    if (item.botId) host.machineTurnBots.set(`${item.deviceId}\0${item.messageId}`, item.botId);
    if (!item.started && !prev.has(keyOf(item))) host.turnBell.notify(item.deviceId, item.userId);
  }

}
  return replaceQueuedWorkerTurns;
}
