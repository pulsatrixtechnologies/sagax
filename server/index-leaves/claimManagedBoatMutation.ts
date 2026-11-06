// @ts-nocheck
/** claimManagedBoatMutation (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createClaimManagedBoatMutation(getHost: () => Host): any {
function claimManagedBoatMutation(instance: boat.ManagedBoatInventoryInstance): () => void{
  const host = getHost();

  const ownerBotId = instance.ownerBotId;
  const teamComputer = host.teamComputers.list().find(computer => host.teamComputerOwner(computer.id) === ownerBotId);
  if (teamComputer) return host.claimTeamComputerLifecycle(teamComputer);
  if (!ownerBotId) {
    if (host.orphanBoatLifecycleBusyIds.has(instance.boxId)) {
      throw Object.assign(new Error("this cloud computer is being changed — wait for it to finish"), { status: 409 });
    }
    host.orphanBoatLifecycleBusyIds.add(instance.boxId);
    return () => host.orphanBoatLifecycleBusyIds.delete(instance.boxId);
  }
  const owner = host.managedBoatOwners().find((candidate) => candidate.botId === ownerBotId);
  if (owner?.inUse) {
    throw Object.assign(new Error("this cloud computer is in use — stop its bot's work first"), { status: 409 });
  }
  return host.claimBotComputerLifecycle(ownerBotId);

}
  return claimManagedBoatMutation;
}
