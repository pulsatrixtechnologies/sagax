// @ts-nocheck
/** speakerOwnWordsTurn (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createSpeakerOwnWordsTurn(getHost: () => Host): any {
function speakerOwnWordsTurn(bot: BotRecord, threadId: string) {
  const host = getHost();
  const { ownEnvironmentTurnOrigin } = host;
  const speaker = host.turnSpeakers.get(threadId);
  const principal = speaker?.origin === "person" ? speaker.principalId?.trim() : undefined;
  return ownEnvironmentTurnOrigin({
    speaker,
    ownerPrincipalId: speaker?.origin === "operator" ? host.effectiveBotOwner(bot) : principal ?? "",
    internalTurn: host.isInternalTurn(threadId),
    routineLineage: host.turnRoutineLineage.has(threadId),
    automation: Boolean(host.directRequestOwners.get(threadId)?.automation),
    unattended: host.isUnattended(bot.id, threadId)
  }) === "owner";

}
  return speakerOwnWordsTurn;
}
