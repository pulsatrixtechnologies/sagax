// @ts-nocheck
/** localVmInventoryPayload (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createLocalVmInventoryPayload(getHost: () => Host): any {
async function localVmInventoryPayload() {
  const host = getHost();
  const { containerComputerStatus, containerRuntimeStatus, discoverExistingPerBotLocalVms, localVmMaxInstances } = host;

  const runtime = await containerRuntimeStatus();
  if (!runtime.runtime || !runtime.daemonUp) {
    return {
      instances: [],
      maxInstances: localVmMaxInstances(host.cfg),
      available: false,
      problem: runtime.runtime ? `Start ${runtime.runtime} first` : "Install a supported container runtime first"
    };
  }
  const existing = await discoverExistingPerBotLocalVms(host.store.bots, runtime.runtime);
  const statuses = await Promise.all(existing.map(({ target }) =>
    containerComputerStatus(undefined, undefined, target),
  ));
  const instances = existing.flatMap(({ bot, target }, index) => {
    const status = statuses[index];
    if (!status) return [];
    host.noteLocalVmSeen(target, status);
    const inUse = host.localVmActiveThreads.has(target.key) ||
      host.localVmLeaseFor(target).current(host.localVmOwnerBusy) !== null;
    const entry = localVmInventoryEntry(bot, status, inUse);
    return entry ? [entry] : [];
  });
  return { instances, maxInstances: localVmMaxInstances(host.cfg), available: true, problem: null };

}
  return localVmInventoryPayload;
}
