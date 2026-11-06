// @ts-nocheck
/** healBotEngine (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createHealBotEngine(getHost: () => Host): any {
function healBotEngine(bot: BotRecord) {
  const host = getHost();
  const { namesEngine, withNewBotEffort } = host;

  if (namesEngine(bot.modelSelection)) return bot;
  const fallback = host.hostedModels ? host.hostedModels.select(host.cfg.defaultModelSelection ?? undefined) : host.bootSelection;
  if (!fallback.instanceId || !fallback.model) return bot;
  const selection = withNewBotEffort(fallback, host.cfg.newBotDefaults?.profile.modelSelection?.effort,
    host.registry.get(fallback.instanceId)?.adapter.capabilities.effortLevels);
  return host.store.applyModelDefault(bot.id, bot.modelSelection.auto === true ? { ...selection, auto: true } : selection) ?? bot;

}
  return healBotEngine;
}
