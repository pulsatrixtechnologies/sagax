// @ts-nocheck
/** managedBoatOwners (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createManagedBoatOwners(getHost: () => Host): any {
function managedBoatOwners() {
  const host = getHost();
  const { store, teamComputers } = host;

  return [...store.bots.map((bot) => ({
    botId: bot.id,
    name: bot.name,
    // A machine is not safe to mutate while any app-level work or human
    // control lease still names its owner. This is deliberately conservative
    // across destination changes: an old Boat may still contain valuable state.
    inUse:
      bot.busy === true ||
      host.hasDirectDispatch(bot.id) ||
      host.activeGroupTurnForBot(bot.id) !== null ||
      Boolean(host.routines?.activeRunForBot(bot.id)) ||
      host.activeVpsThreads.has(bot.id) ||
      host.computerControl.snapshot(bot.id).held
  })), ...teamComputers.list().map(computer => ({
    botId: host.teamComputerOwner(computer.id), name: computer.name, inUse: host.teamComputerInUse(computer)
  }))];

}
  return managedBoatOwners;
}
