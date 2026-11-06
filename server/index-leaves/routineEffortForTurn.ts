// @ts-nocheck
/** routineEffortForTurn (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createRoutineEffortForTurn(getHost: () => Host): any {
function routineEffortForTurn(botId: string, threadId: string, instance: ProviderInstance, model: string): { effort: EffortLevel } | null {
  const host = getHost();

  const run = host.activeRoutineRunForThread(threadId);
  const bot = host.store.bot(botId);
  if (!run?.effort || run.botId !== botId || !bot) return null;
  const decided = host.routineTurnEffort({
    effort: run.effort,
    botInstanceId: bot.modelSelection.instanceId,
    turnInstanceId: instance.instanceId,
    takenOver: Boolean(host.limitFailoverStore.failover(botId, threadId)),
    option: instance.models.options.find(option => option.id === model),
    levels: instance.adapter.capabilities.effortLevels,
  });
  if (decided && "ignored" in decided) {
    if (!host.routineEffortNoticed.has(run.id)) {
      host.routineEffortNoticed.add(run.id);
      if (host.routineEffortNoticed.size > 500) host.routineEffortNoticed.delete(host.routineEffortNoticed.values().next().value!);
      host.store.appendMessage(threadId, { role: "bot", kind: "activity", tool: { name: `notice: ${decided.ignored}`, ok: true } });
    }
    return null;
  }
  return decided;

}
  return routineEffortForTurn;
}
