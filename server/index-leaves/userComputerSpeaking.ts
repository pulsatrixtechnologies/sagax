// @ts-nocheck
/** userComputerSpeaking (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createUserComputerSpeaking(getHost: () => Host): any {
function userComputerSpeaking(principal: string | null, capability: { botId: string; threadId: string }): { speaker: TurnSpeaker | undefined; context: { botOwner?: string; automationTrigger?: string } } {
  const host = getHost();

  if (principal) return { speaker: host.personSpeaker(principal), context: {} };
  const bot = host.store.bot(capability.botId);
  const trigger = host.routineTriggerOf(capability.threadId);
  return {
    speaker: host.turnSpeakers.get(capability.threadId),
    context: { ...(bot ? { botOwner: host.effectiveBotOwner(bot) } : {}), ...(trigger ? { automationTrigger: trigger } : {}) }
  };

}
  return userComputerSpeaking;
}
