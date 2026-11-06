// @ts-nocheck
/** botCreationTurnOrigin (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createBotCreationTurnOrigin(getHost: () => Host): any {
function botCreationTurnOrigin(bot: BotRecord, threadId: string) {
  const host = getHost();
  const { ownEnvironmentTurnOrigin } = host;
  // only the person's own words: never their routine or a hop between bots
  return ownEnvironmentTurnOrigin({
    speaker: host.turnSpeakers.get(threadId),
    ownerPrincipalId: host.effectiveBotOwner(bot),
    internalTurn: host.isInternalTurn(threadId),
    routineLineage: host.turnRoutineLineage.has(threadId),
    automation: Boolean(host.directRequestOwners.get(threadId)?.automation),
    unattended: host.isUnattended(bot.id, threadId)
  });

}
  return botCreationTurnOrigin;
}
