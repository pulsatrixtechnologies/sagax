// @ts-nocheck
/** localVmTargetForStatus (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createLocalVmTargetForStatus(getHost: () => Host): any {
function localVmTargetForStatus(botId: string, threadId?: string) {
  const host = getHost();
  const { localVmMode, poolLocalVmTarget } = host;

  if (localVmMode(host.cfg) !== "pool") return host.localVmTargetForBot(botId);
  // An in-flight turn keeps its claimed seat even after its affinity TTL
  // decays: prefer the live target so a preview cannot land on another seat.
  const activeTarget = threadId ? host.localVmThreadTargets.get(threadId) : undefined;
  if (activeTarget) return activeTarget;
  return poolLocalVmTarget((threadId ? host.localVmSeatPool.affinitySeat(threadId) : null) ?? 0);

}
  return localVmTargetForStatus;
}
