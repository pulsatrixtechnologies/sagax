// @ts-nocheck
/** ownEnvironmentOrigin (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createOwnEnvironmentOrigin(getHost: () => Host): any {
function ownEnvironmentOrigin(bot: BotRecord, threadId: string) {
  const host = getHost();
  const { ownEnvironmentTurnOrigin, ownLineageFields } = host;
  return ownEnvironmentTurnOrigin({
    speaker: host.turnSpeakers.get(threadId),
    ownerPrincipalId: host.effectiveBotOwner(bot),
    internalTurn: host.isInternalTurn(threadId),
    routineLineage: host.turnRoutineLineage.has(threadId),
    automation: Boolean(host.directRequestOwners.get(threadId)?.automation),
    unattended: host.isUnattended(bot.id, threadId),
    ...ownLineageFields(bot, threadId)
  });

}
  return ownEnvironmentOrigin;
}
