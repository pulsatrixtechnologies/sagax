// @ts-nocheck
/** routineModelRefusal (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createRoutineModelRefusal(getHost: () => Host): any {
function routineModelRefusal(botId: string, model: string) {
  const host = getHost();

  const bot = host.store.bot(botId);
  if (!bot) return null;
  const instance = host.registry.get(bot.modelSelection.instanceId);
  if (!instance) return null;
  const offered = host.engineModelIds(instance);
  if (offered.length && !offered.includes(model)) return `Model "${model}" is not offered by this bot's engine (${engineDisplayName(instance)}).`;
  return host.modelSwitchRefusal(instance.instanceId, model, host.effectiveBotOwner(bot)) ?? null;

}
  return routineModelRefusal;
}
