// @ts-nocheck
/** drainQueuedSends (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createDrainQueuedSends(getHost: () => Host): any {
function drainQueuedSends() {
  const host = getHost();
  if (!host.followupsReady) return;
  if (host.drainingQueuedSends) { host.queuedSendsDrainOwed = true; return; }
  host.drainingQueuedSends = true;
  try { host.drainQueuedSendsNow(); host.drainAgentReplyWakes(); } finally {
    host.drainingQueuedSends = false;
    if (host.queuedSendsDrainOwed) { host.queuedSendsDrainOwed = false; drainQueuedSends(); }
  }
}
  return drainQueuedSends;
}
