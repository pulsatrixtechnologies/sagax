// @ts-nocheck
/** personDirectTurn (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createPersonDirectTurn(getHost: () => Host): any {
function personDirectTurn(bot: BotRecord, threadId: string) {
  const host = getHost();
  const { ownEnvironmentTurnOrigin } = host;
  return ownEnvironmentTurnOrigin({
    speaker: host.turnSpeakers.get(threadId),
    ownerPrincipalId: host.effectiveBotOwner(bot),
    internalTurn: host.isInternalTurn(threadId),
    routineLineage: host.turnRoutineLineage.has(threadId),
    automation: Boolean(host.directRequestOwners.get(threadId)?.automation),
    unattended: host.isUnattended(bot.id, threadId)
  }) === "owner";

}
  return personDirectTurn;
}
