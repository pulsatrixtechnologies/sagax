// @ts-nocheck
/** claimManagedVpsMutation (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createClaimManagedVpsMutation(getHost: () => Host): any {
function claimManagedVpsMutation(containerName: string) {
  const host = getHost();

  const owner = host.store.bots.find((candidate) => host.vps.vpsContainerName(candidate.id) === containerName);
  if (!owner) return () => {};
  const ownerState = host.managedBoatOwners().find((candidate) => candidate.botId === owner.id);
  if (ownerState?.inUse) {
    throw Object.assign(new Error("this VPS computer is in use — stop its bot's work first"), { status: 409 });
  }
  return host.claimBotComputerLifecycle(owner.id);

}
  return claimManagedVpsMutation;
}
