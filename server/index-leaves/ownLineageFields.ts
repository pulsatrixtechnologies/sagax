// @ts-nocheck
/** ownLineageFields (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createOwnLineageFields(getHost: () => Host): any {
function ownLineageFields(bot: BotRecord, threadId: string): { botOwnerPrincipalId: string; automationTrigger?: string; peerFromOwner?: string; routineAuthorized: boolean } {
  const host = getHost();

  const speaker = host.turnSpeakers.get(threadId);
  const trigger = host.routineTriggerOf(threadId);
  const peerFromOwner = speaker ? host.peerOwnerPrincipal(speaker) : undefined;
  return {
    botOwnerPrincipalId: host.effectiveBotOwner(bot),
    routineAuthorized: host.routineOwnerAuthorizationFor(bot, threadId) !== null,
    ...(trigger ? { automationTrigger: trigger } : {}),
    ...(peerFromOwner ? { peerFromOwner } : {})
  };

}
  return ownLineageFields;
}
