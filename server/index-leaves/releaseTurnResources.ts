// @ts-nocheck
/** releaseTurnResources (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createReleaseTurnResources(getHost: () => Host): any {
function releaseTurnResources(owner: TurnOwner | undefined): void {
  const host = getHost();
  if (!owner) return;
  if (host.autoVmClaims.get(owner.threadId)?.owner.generation === owner.generation) host.autoVmClaims.delete(owner.threadId);
  if (host.settlingResourceOwners.get(owner.threadId) === owner.generation) host.settlingResourceOwners.delete(owner.threadId);
  host.turnResources.release(owner);
  if (host.turnResourceOwners.get(owner.threadId)?.generation === owner.generation) host.turnResourceOwners.delete(owner.threadId);
  if (host.turnComputerResources.get(owner.threadId)?.owner.generation === owner.generation) host.turnComputerResources.delete(owner.threadId);
  const teamTurn = host.teamComputerTurns.get(owner.threadId);
  if (teamTurn?.owner.generation === owner.generation) {
    host.stopScreenPoller(teamTurn.botId, owner.threadId);
    host.teamComputerTurns.delete(owner.threadId);
  }
}
  return releaseTurnResources;
}
