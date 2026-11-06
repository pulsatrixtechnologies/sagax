// @ts-nocheck
/** teamComputerInUse (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createTeamComputerInUse(getHost: () => Host): any {
function teamComputerInUse(computer: TeamComputerRecord) {
  const host = getHost();
  const { sectionKey, teamComputerTurns } = host;
  computer = host.teamComputers.get(computer.id) ?? computer;
  return host.computerControl.snapshot(host.teamComputerOwner(computer.id)).held ||
    [...teamComputerTurns.values()].some(turn => turn.computerId === computer.id) ||
    host.store.bots.some(bot => computer.section !== null && sectionKey(bot.section) === computer.section && (
      host.botHasActiveTurn(bot.id) || Boolean(host.routines?.activeRunForBot(bot.id)) || host.computerControl.snapshot(bot.id).held
    ));

}
  return teamComputerInUse;
}
