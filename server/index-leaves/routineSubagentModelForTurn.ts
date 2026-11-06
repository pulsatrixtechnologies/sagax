// @ts-nocheck
/** routineSubagentModelForTurn (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createRoutineSubagentModelForTurn(getHost: () => Host): any {
function routineSubagentModelForTurn(botId: string, threadId: string, instance: { instanceId: string; models: { default?: string; options: Array<{ id: string }> } }): { model: string } | null {
  const host = getHost();

  const run = host.activeRoutineRunForThread(threadId);
  if (!run?.subagentModel || run.botId !== botId) return null;
  const bot = host.store.bot(botId);
  if (!bot) return null;
  const decided = host.routineTurnModel({
    model: run.subagentModel,
    botInstanceId: bot.modelSelection.instanceId,
    turnInstanceId: instance.instanceId,
    takenOver: Boolean(host.limitFailoverStore.failover(botId, threadId)),
    offered: host.engineModelIds(instance),
    refusal: host.modelSwitchRefusal(instance.instanceId, run.subagentModel, host.effectiveBotOwner(bot)),
  });
  if (decided && "ignored" in decided) {
    if (!host.routineSubagentModelNoticed.has(run.id)) {
      host.routineSubagentModelNoticed.add(run.id);
      if (host.routineSubagentModelNoticed.size > 500) host.routineSubagentModelNoticed.delete(host.routineSubagentModelNoticed.values().next().value!);
      const line = decided.ignored.replace(/^Routine model/, "Routine sub-agent model");
      console.info(`[routine-subagent-model] ${threadId}: ${line}`);
      host.store.appendMessage(threadId, { role: "bot", kind: "activity", tool: { name: `notice: ${line}`, ok: true } });
    }
    return null;
  }
  return decided;

}
  return routineSubagentModelForTurn;
}
