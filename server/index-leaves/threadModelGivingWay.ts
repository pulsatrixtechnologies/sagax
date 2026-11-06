// @ts-nocheck
/** threadModelGivingWay (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createThreadModelGivingWay(getHost: () => Host): any {
function threadModelGivingWay(botId: string, threadId: string) {
  const host = getHost();

  const bot = host.store.bot(botId);
  const own = host.store.taskByThread(botId, threadId)?.modelSelection;
  if (!bot || !own) return null;
  return host.threadModelFallback(own, bot.modelSelection, host.threadEngine, {
    refusal: (instance) => host.policyModelRefusal(instance) ?? host.orgEngineAllowRefusal(instance.instanceId, host.effectiveBotOwner(bot)),
    ...(host.hostedModels ? { allows: (selection: ModelSelection) => host.hostedModels!.allows(selection) } : {})
  }) ? own : null;

}
  return threadModelGivingWay;
}
