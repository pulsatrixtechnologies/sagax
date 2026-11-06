// @ts-nocheck
/** streamDigestEngine (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createStreamDigestEngine(getHost: () => Host): any {
function streamDigestEngine(bot: BotRecord) {
  const host = getHost();
  const { DATA_DIR, assertWithinBudget } = host;
  if (host.hostedModels && !host.hostedModels.allows(bot.modelSelection)) return null;
  const instance = host.registry.get(bot.modelSelection.instanceId);
  if (!instance?.generateText || host.policyModelRefusal(instance)) return null;
  try {
    assertWithinBudget(host.cfg, DATA_DIR);
  } catch {
    return null;
  }
  return instance;

}
  return streamDigestEngine;
}
