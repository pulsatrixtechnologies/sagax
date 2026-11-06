// @ts-nocheck
/** limitCandidatesNow (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createLimitCandidatesNow(getHost: () => Host): any {
function limitCandidatesNow(botId: string, threadId: string, speaker: unknown) {
  const host = getHost();

  const bot = threadId ? host.store.projectBotForTask(botId, threadId) : host.store.bot(botId);
  if (!bot) return [];
  const guestConfined = host.cloudGuestDriven(threadId) || host.botmailConfined(threadId);
  return host.autoEnginesFor(bot, (speaker ?? { origin: "person" }) as TurnSpeaker, guestConfined).map((engine) => ({
    instanceId: engine.instanceId, driverKind: engine.driverKind,
    models: engine.models.options.map((option) => option.id), defaultModel: engine.models.default,
  }));

}
  return limitCandidatesNow;
}
