// @ts-nocheck
/** applyOrgEngineAllowList (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createApplyOrgEngineAllowList(getHost: () => Host): any {
function applyOrgEngineAllowList() {
  const host = getHost();

  const allowed = host.orgAllowedEngines();
  if (!allowed) return;
  const engines = host.registry.entries().map((entry) => ({
    instanceId: entry.instanceId,
    installed: host.engineInstalled(entry.instanceId),
    defaultModel: host.registry.get(entry.instanceId)?.models.default ?? ""
  }));
  const preferred = host.cfg.newBotDefaults?.profile.modelSelection ?? host.cfg.defaultModelSelection;
  for (const { id } of host.store.bots) {
    const bot = host.store.bot(id);
    if (!bot) continue;
    // #1098: an engine its owner pays for with their own subscription or
    // key is theirs to keep, only when the organization lets own accounts
    // through (2026-10-30, `ownAccountsOutsideList`)
    const owner = host.effectiveBotOwner(bot);
    const ownKept = (instanceId: string) => host.orgOwnAccountsOutsideList() && host.personPaysEngine(owner, instanceId);
    const next = ownKept(bot.modelSelection.instanceId) ? null : host.allowedFallbackSelection(bot.modelSelection, allowed, engines, preferred);
    if (next) {
      host.store.applyModelDefault(id, next);
      console.log(`[org] bot=${id} engine ${bot.modelSelection.instanceId} is not allowed by the organization; now on Auto (${next.instanceId})`);
      // 2026-10-18 the bot's conversation says so in one plain line
      // (a status notice, drawn in the reader's language from tool.engineMove,
      // src/lib/activity-runs.ts), never a raw error.
      const move = { from: host.orgEngineName(bot.modelSelection.instanceId), to: host.orgEngineName(next.instanceId) };
      if (bot.threadId) host.store.appendMessage(bot.threadId, { role: "bot", kind: "activity", tool: { name: `notice: ${orgEngineMoveLine(move)}`, ok: true, engineMove: move } });
    }
    const stray = (host.store.bot(id)?.tasks ?? [])
      .filter((task) => task.modelSelection && !host.engineAllowed(allowed, task.modelSelection.instanceId) && !ownKept(task.modelSelection.instanceId))
      .map((task) => task.threadId);
    if (stray.length) host.store.followBotModel(id, stray, (from, to) => host.hostedModels?.resetTask(from, to) ?? {});
  }

}
  return applyOrgEngineAllowList;
}
