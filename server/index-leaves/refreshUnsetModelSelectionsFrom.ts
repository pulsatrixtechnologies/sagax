// @ts-nocheck
/** refreshUnsetModelSelectionsFrom (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createRefreshUnsetModelSelectionsFrom(getHost: () => Host): any {
async function refreshUnsetModelSelectionsFrom(instances?: readonly SelectableInstance[]) {
  const host = getHost();
  const { namesEngine, withNewBotEffort } = host;

  if (host.registry.provisional(instances)) return;
  const selectable = host.selectableInstances<SelectableInstance>(instances ?? await host.registry.describe());
  host.bootSelection = await host.defaultSelection(undefined, selectable.filter(instance => readyToRun(instance, host.selectionContext)));
  if (host.hostedModels) {
    for (const bot of host.store.bots) host.healBotEngine(bot);
    return;
  }
  if (!host.bootSelection.instanceId || !host.bootSelection.model) return;
  const selection = withNewBotEffort(host.bootSelection, host.cfg.newBotDefaults?.profile.modelSelection?.effort,
    host.registry.get(host.bootSelection.instanceId)?.adapter.capabilities.effortLevels);
  for (const bot of host.store.bots) {
    if (!namesEngine(bot.modelSelection)) host.store.applyModelDefault(bot.id, bot.modelSelection.auto === true ? { ...selection, auto: true } : selection);
  }

}
  return refreshUnsetModelSelectionsFrom;
}
