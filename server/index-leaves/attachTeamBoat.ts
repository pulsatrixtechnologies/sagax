// @ts-nocheck
/** attachTeamBoat (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createAttachTeamBoat(getHost: () => Host): any {
async function attachTeamBoat(computer: TeamComputerRecord, botId: string, owner: TurnOwner, canMount: boolean) {
  const host = getHost();

  if (!canMount) throw new Error("This model cannot use the team's cloud computer; choose a model provider with computer tools or an explicit bot destination");
  if (!host.boat.boatConfigured(host.cfg)) throw new Error("The team's Boat account is not configured; reconnect it in Settings");
  const ownerId = host.teamComputerOwner(computer.id);
  if (host.boatLifecycleBusyBots.has(ownerId)) throw new Error("The team computer is being changed; wait for it to finish");
  if (host.computerControl.snapshot(ownerId).held) throw new Error("Release human control of the team computer before starting another turn");
  await host.bindTurnComputer(owner, `computer:box-bot:${ownerId}`, true);
  host.teamComputerTurns.set(owner.threadId, { owner, computerId: computer.id, botId });
  let machine = await host.boat.findBoat(host.cfg, ownerId);
  if (!machine) throw new Error("The team's cloud computer is missing; explicitly create or retry it from the Team map");
  await host.bindTurnComputer(owner, `computer:box:${machine.id}`, true);
  const action = host.boat.boatTurnLifecycleAction(typeof machine.state === "string" ? machine.state : null);
  if (action === "wake") machine = await host.boat.readyBoat(host.cfg, ownerId);
  if (!machine || host.boat.boatTurnLifecycleAction(typeof machine.state === "string" ? machine.state : null) !== "attach") {
    throw new Error("The team computer is not ready; check it in the Team map");
  }
  if (host.turnResourceOwners.get(owner.threadId)?.generation !== owner.generation ||
      !host.turnResources.owns(`computer:box:${machine.id}`, owner)) throw new Error("This computer turn ended while its machine was starting");
  return {
    mount: host.cloudComputerMount(botId, owner, machine.id),
    capture: () => host.boat.screenshotBoat(host.cfg, ownerId, machine!.id)
  };

}
  return attachTeamBoat;
}
