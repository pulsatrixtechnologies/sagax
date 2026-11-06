// @ts-nocheck
/** assertTeamComputerChangeIdle (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createAssertTeamComputerChangeIdle(getHost: () => Host): any {
function assertTeamComputerChangeIdle(before: BotRecord, after: BotRecord) {
  const host = getHost();

  const previous = host.inheritedTeamComputer(before);
  const next = host.inheritedTeamComputer(after);
  if (previous?.id === next?.id) return;
  if (host.botHasActiveTurn(before.id) || host.routines?.activeRunForBot(before.id) || host.botComputerControlSnapshot(before.id).held ||
      [previous, next].some(computer => computer && (host.teamComputerInUse(computer) || host.boatLifecycleBusyBots.has(host.teamComputerOwner(computer.id))))) {
    throw Object.assign(new Error("Stop the affected team's work and release computer control before changing its computer access"), { status: 409 });
  }

}
  return assertTeamComputerChangeIdle;
}
