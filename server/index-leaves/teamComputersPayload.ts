// @ts-nocheck
/** teamComputersPayload (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createTeamComputersPayload(getHost: () => Host): any {
async function teamComputersPayload() {
  const host = getHost();

  const entries = host.teamComputers.list();
  const inventory = await host.boat.listManagedBoats(host.cfg, host.managedBoatOwners());
  return {
    configured: inventory.configured,
    ...(inventory.problem ? { problem: inventory.problem } : {}),
    computers: entries.map(entry => {
      const machine = inventory.instances.find(instance => instance.ownerBotId === host.teamComputerOwner(entry.id));
      return {
        id: entry.id, name: entry.name, section: entry.section,
        ...(entry.sectionId ? { sectionId: entry.sectionId } : {}),
        held: host.computerControl.snapshot(host.teamComputerOwner(entry.id)).held,
        state: host.boatLifecycleBusyBots.has(host.teamComputerOwner(entry.id)) ? "working" : machine?.state ?? (inventory.available ? "missing" : "unavailable"),
        ...(entry.problem || inventory.problem ? { problem: entry.problem || inventory.problem! } : {})
      };
    })
  };

}
  return teamComputersPayload;
}
