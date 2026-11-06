// @ts-nocheck
/** routineModelForTurn (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createRoutineModelForTurn(getHost: () => Host): any {
function routineModelForTurn(botId: string, threadId: string, instance: { instanceId: string; models: { default?: string; options: Array<{ id: string }> } }): { model: string } | null {
  const host = getHost();

  const run = host.activeRoutineRunForThread(threadId);
  if (!run?.model || run.botId !== botId) return null;
  const bot = host.store.bot(botId);
  if (!bot) return null;
  const decided = host.routineTurnModel({
    model: run.model,
    botInstanceId: bot.modelSelection.instanceId,
    turnInstanceId: instance.instanceId,
    takenOver: Boolean(host.limitFailoverStore.failover(botId, threadId)),
    offered: host.engineModelIds(instance),
    refusal: host.modelSwitchRefusal(instance.instanceId, run.model, host.effectiveBotOwner(bot)),
  });
  if (decided && "ignored" in decided) {
    if (!host.routineModelNoticed.has(run.id)) {
      host.routineModelNoticed.add(run.id);
      if (host.routineModelNoticed.size > 500) host.routineModelNoticed.delete(host.routineModelNoticed.values().next().value!);
      console.info(`[routine-model] ${threadId}: ${decided.ignored}`);
      host.store.appendMessage(threadId, { role: "bot", kind: "activity", tool: { name: `notice: ${decided.ignored}`, ok: true } });
    }
    return null;
  }
  return decided;

}
  return routineModelForTurn;
}
