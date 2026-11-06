// @ts-nocheck
/** turnSurfacePlan (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createTurnSurfacePlan(getHost: () => Host): any {
function turnSurfacePlan(bot: BotRecord, runOn?: RoutineRunOn, threadId?: string) {
  const host = getHost();
  const { builtInBrowserEnabled, honouredPin, remoteComputerForTurn, resolveSurface } = host;

  const instance = host.registry.get(bot.modelSelection.instanceId);
  const remote = remoteComputerForTurn({
    organization: host.IDENTITY.kind === "perspicax",
    // A cloud-only bot (server/bots/cloud-only-bots.ts) always runs as a cloud run.
    runOnCloud: runOn === "cloud" || host.cloudOnlyBot(bot.id),
    hasTeamComputer: Boolean(host.inheritedTeamComputer(bot))
  });
  return resolveSurface({
    destination: remote.forceCloud ? "cloud" : bot.computer,
    pinnedSurface: remote.forceCloud || !threadId ? null : honouredPin(host.store.taskByThread(bot.id, threadId)) ?? host.computerSelectionMoves.get(threadId) ?? null,
    browserOn: builtInBrowserEnabled(host.cfg) && bot.browser !== false && instance?.adapter.capabilities.browserMcp === true
  });

}
  return turnSurfacePlan;
}
