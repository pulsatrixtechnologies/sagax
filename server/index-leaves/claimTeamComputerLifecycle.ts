// @ts-nocheck
/** claimTeamComputerLifecycle (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createClaimTeamComputerLifecycle(getHost: () => Host): any {
function claimTeamComputerLifecycle(computer: TeamComputerRecord) {
  const host = getHost();

  if (host.computerProviderConfigTransitions.has("box")) throw Object.assign(new Error(host.providerTransitionMessage("box")), { status: 409 });
  if (host.teamComputerInUse(computer)) throw Object.assign(new Error("This team computer is in use; stop the team's work and release computer control first"), { status: 409 });
  return host.claimBotComputerLifecycle(host.teamComputerOwner(computer.id));

}
  return claimTeamComputerLifecycle;
}
