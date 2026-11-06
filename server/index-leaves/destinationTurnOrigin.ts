// @ts-nocheck
/** destinationTurnOrigin (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createDestinationTurnOrigin(getHost: () => Host): any {
function destinationTurnOrigin(bot: BotRecord, threadId: string, person: string) {
  const host = getHost();
  const { ownEnvironmentTurnOrigin, ownLineageFields } = host;
  return ownEnvironmentTurnOrigin({
    speaker: host.turnSpeakers.get(threadId),
    ownerPrincipalId: person,
    internalTurn: host.isInternalTurn(threadId),
    routineLineage: host.turnRoutineLineage.has(threadId),
    automation: Boolean(host.directRequestOwners.get(threadId)?.automation),
    unattended: host.isUnattended(bot.id, threadId),
    ...ownLineageFields(bot, threadId)
  });

}
  return destinationTurnOrigin;
}
