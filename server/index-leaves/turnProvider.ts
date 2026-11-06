// @ts-nocheck
/** turnProvider (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createTurnProvider(getHost: () => Host): any {
function turnProvider(bot: BotRecord, runOn?: RoutineRunOn, threadId?: string) {
  const host = getHost();

  // Organization server: Cloud is the person's server environment. A cloud
  // routine, a team computer and the Computer engine are not a Boat or a VPS.
  if (host.IDENTITY.kind === "perspicax") return null;
  if (runOn === "cloud" || host.inheritedTeamComputer(bot)) return "box";
  const wants = host.turnSurfacePlan(bot, runOn, threadId).computer;
  if (wants !== undefined && wants !== "cloud") return null;
  return bot.cloudBackend === "vps" ? "vps" : wants === "cloud" ? "box" : null;

}
  return turnProvider;
}
