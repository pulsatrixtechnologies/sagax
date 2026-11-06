// @ts-nocheck
/** drainQueuedChannelSends (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createDrainQueuedChannelSends(getHost: () => Host): any {
function drainQueuedChannelSends(): void {
  const host = getHost();
  if (!host.followupsReady) return;
  // Same one-at-a-time rule as drainQueuedSends.
  if (host.drainingQueuedChannelSends) { host.queuedChannelSendsDrainOwed = true; return; }
  host.drainingQueuedChannelSends = true;
  try { host.drainQueuedChannelSendsNow(); } finally {
    host.drainingQueuedChannelSends = false;
    if (host.queuedChannelSendsDrainOwed) { host.queuedChannelSendsDrainOwed = false; drainQueuedChannelSends(); }
  }
}
  return drainQueuedChannelSends;
}
