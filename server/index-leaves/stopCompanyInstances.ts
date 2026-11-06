// @ts-nocheck
/** stopCompanyInstances (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createStopCompanyInstances(getHost: () => Host): any {
async function stopCompanyInstances(ids: string[]) {
  const host = getHost();
  const { groupSpeakers } = host;

  if (!ids.length) return;
  if (host.companyShutdown) {
    for (const id of ids) { host.providerAuthSessions.clearInstance(id); host.bus.detach(id); }
    return;
  }
  const cause = "turn interrupted — the Company connection changed";
  const selected = new Set(ids);
  for (const id of ids) host.providerInstancesChanging.add(id);
  const direct = host.store.bots.flatMap(bot => host.store.tasks(bot.id)
    .filter(task => host.threadBusy(bot.id, task.threadId) && selected.has(host.botForThread(bot.id, task.threadId)!.modelSelection.instanceId))
    .map(task => ({ botId: bot.id, threadId: task.threadId, owner: host.turnResourceOwners.get(task.threadId), generation: host.directTurnGenerationByThread.get(task.threadId) })));
  // These engines stay attached while their turns end, so a turn's own end
  // can settle its requester before the loop below: either way it hears this.
  for (const { threadId } of direct) host.turnStops.stopping(threadId, host.liveTurnByThread.get(threadId), cause);
  // Not the person's Stop: the teammates' replies still come back.
  await Promise.all(direct.map(task => host.interruptDirectThread(task.botId, task.threadId, { cause: "engine-change" })));
  for (const { botId, threadId, owner, generation } of direct) {
    const interrupted = host.stoppedTurnText(threadId, host.liveTurnByThread.get(threadId), cause);
    host.releaseTurnResources(owner);
    host.settleDirectFollowup(owner?.generation, { ok: false, text: interrupted });
    // Another member of this cancellation batch can settle slowly while a
    // completed thread starts a personal turn. Never clear that new owner.
    if (host.directTurnGenerationByThread.get(threadId) !== generation) continue;
    host.stopScreenPoller(botId, threadId); host.releaseLocalVmThread(threadId);
    host.watchdog.settle(threadId); host.closeOpenApprovals(threadId); host.directTurnBots.delete(threadId);
    host.finalizeDelegationWatch(threadId, false, "", `Delegated turn did not finish — ${interrupted}`);
    host.routines?.failThread(threadId, "Company connection changed while this thread was running");
    if (host.store.taskByThread(botId, threadId)) {
      host.store.appendMessage(threadId, { role: "bot", kind: "activity", tool: { name: "Company connection changed — choose whether to reconnect or use a personal model", ok: false } });
      host.store.setTaskActivity(botId, threadId, "idle");
    }
  }
  // Freeze this cancellation batch across interruptTurn's asynchronous yield.
  // oxlint-disable-next-line unicorn/no-useless-spread
  for (const [threadId, speaker] of [...groupSpeakers]) {
    if (host.groupSpeakers.get(threadId) !== speaker) continue;
    const bot = host.store.bot(speaker.botId);
    if (!bot || !selected.has(bot.modelSelection.instanceId)) continue;
    const group = host.store.groupByThread(threadId);
    const owner = host.turnResourceOwners.get(threadId);
    if (group) host.cancelGroupTurnOperations(group.id, threadId, { status: "stopped", detail: host.stoppedTurnOutcome({ reason: cause, activities: [] }), byHarness: true });
    host.revokeInternalCapabilitiesForThread(threadId);
    await host.runningTurnInstance(bot, threadId)?.adapter.interruptTurn(threadId);
    const stillOwned = host.groupSpeakers.get(threadId) === speaker &&
      host.turnResourceOwners.get(threadId)?.generation === owner?.generation;
    host.releaseTurnResources(owner);
    if (!stillOwned) continue;
    host.releaseLocalVmThread(threadId);
    host.watchdog.settle(threadId); host.closeOpenApprovals(threadId);
    host.groupSpeakers.delete(threadId);
    if (group) host.store.patchGroup(group.id, { busyBotId: null });
    host.store.setActivity(bot.id, "idle");
  }
  for (const id of ids) { host.providerAuthSessions.clearInstance(id); host.bus.detach(id); }

}
  return stopCompanyInstances;
}
