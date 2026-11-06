// @ts-nocheck
/** parentThreadModel (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createParentThreadModel(getHost: () => Host): any {
function parentThreadModel(botId: string, parentThreadId: string): { modelSelection?: ModelSelection; approvalMode?: "ask" } {
  const host = getHost();
  const { approvalModeFor, modelSwitchNeedsAsk } = host;

  // The stored profile, never a per-thread projection: the comparison is
  // against the defaults the new thread would otherwise get.
  const bot = host.store.bot(botId);
  const modelSelection = bot && host.store.taskByThread(bot.id, parentThreadId)?.modelSelection;
  if (!bot || !modelSelection) return {};
  const needsAsk = modelSwitchNeedsAsk(approvalModeFor(bot),
    host.registry.cliTarget(bot.modelSelection.instanceId)?.driverKind,
    host.registry.cliTarget(modelSelection.instanceId)?.driverKind);
  return { modelSelection, ...(needsAsk ? { approvalMode: "ask" as const } : {}) };

}
  return parentThreadModel;
}
