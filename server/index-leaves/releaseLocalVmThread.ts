// @ts-nocheck
/** releaseLocalVmThread (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createReleaseLocalVmThread(getHost: () => Host): any {
function releaseLocalVmThread(threadId: string) {
  const host = getHost();
  const { localVmMode } = host;

  // Covers lazy claims too (issue #1361): every settle path funnels through
  // here or through releaseTurnResources, so a turn that ends before its
  // first screen call leaves no claim slot behind.
  host.autoVmClaims.delete(threadId);
  host.hostScreenTurns.delete(threadId);
  const target = host.localVmThreadTargets.get(threadId);
  if (!target) return;
  // Renew affinity at settlement so a turn that consumed part of the TTL
  // still leaves the full window after it ends; failed claims never reach
  // here (no target), so only settled turns renew. A turn longer than the
  // TTL finds its entry expired — touch() alone would drop it — so renew
  // with the seat the turn actually ran on. A target recorded before a
  // mid-turn mode change is not a pool seat; touch still covers that.
  if (localVmMode(host.cfg) === "pool") {
    const pooled = /^pool:(\d+)$/.exec(target.key);
    if (pooled) host.localVmSeatPool.renew(threadId, Number(pooled[1]));
    else host.localVmSeatPool.touch(threadId);
  }
  host.localVmLeaseFor(target).release(threadId);
  if (host.localVmActiveThreads.get(target.key) === threadId) host.localVmActiveThreads.delete(target.key);
  host.localVmThreadTargets.delete(threadId);

}
  return releaseLocalVmThread;
}
