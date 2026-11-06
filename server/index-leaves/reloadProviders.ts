// @ts-nocheck
/** reloadProviders (#1388). Pure move from server/index.ts. */
import { failedTurnTool } from "../../shared/failed-turn.ts";
import { changedInstanceIds, engineLaunches } from "../config.ts";
import { stoppedTurnOutcome } from "../turns/turn-outcome.ts";
export type Host = Record<string, any>;

export function createReloadProviders(getHost: () => Host): any {
async function reloadProviders(before: Record<string, unknown>) {
  const host = getHost();
  const configs = host.providerConfigs();
  const changed = new Set(changedInstanceIds(before, engineLaunches(configs)));
  if (!changed.size) return;
  const onChanged = (botId: string, threadId: string) => changed.has(host.threadEngineId(botId, threadId) ?? "");
  const direct = host.store.bots.flatMap((bot) => host.store.tasks(bot.id)
    .filter((task) => host.threadBusy(bot.id, task.threadId) && onChanged(bot.id, task.threadId))
    .map((task) => ({ botId: bot.id, threadId: task.threadId, owner: host.turnResourceOwners.get(task.threadId) })));
  const rooms = [...host.groupSpeakers.entries()].filter(([threadId, speaker]) => onChanged(speaker.botId, threadId));
  const cause = "turn interrupted — provider settings changed";
  host.providerFleetReloading = true;
  for (const id of changed) host.providerInstancesChanging.add(id);
  // Those engines' processes are about to die: revoke before the first await.
  host.revokeEngineCapabilities(changed);
  for (const id of changed) { host.providerAuthSessions.clearInstance(id); host.bus.detach(id); }
  for (const task of direct) host.cancelDirectTurnDispatch(task.botId, task.threadId);
  for (const [threadId] of rooms) {
    const group = host.store.groupByThread(threadId);
    // The room's assignments, queued ones too, fail with this cause, and its
    // goal run says it: neither reads as the person's Stop.
    if (group) host.cancelGroupTurnOperations(group.id, threadId, { status: "stopped", detail: stoppedTurnOutcome({ reason: cause, activities: [] }), byHarness: true });
  }
  try {
    const kept = [...changed].filter((id) => Object.hasOwn(configs, id));
    await Promise.all([...changed].filter((id) => !Object.hasOwn(configs, id)).map((id) => host.registry.dispose(id)));
    await host.registry.load(Object.fromEntries(kept.map((id) => [id, configs[id]])), host.decorateHostedProvider);
    host.bus.attach(kept.flatMap((id) => host.registry.get(id) ?? []));
  } finally {
    // Settle every exact conversation, not whichever one is selected now.
    // Teardown can swallow terminal events; no task may remain busy forever.
    for (const { botId, threadId, owner } of direct) {
      const interrupted = host.stoppedTurnText(threadId, host.liveTurnByThread.get(threadId), cause);
      host.stopScreenPoller(botId, threadId);
      host.releaseLocalVmThread(threadId);
      host.releaseTurnResources(owner);
      host.endForeignTurns(threadId);
      host.vpsThreadEnded(botId, threadId);
      host.watchdog.settle(threadId);
      host.closeOpenApprovals(threadId);
      host.directTurnBots.delete(threadId);
      host.runningTurnEngines.delete(threadId);
      host.routines?.failThread(threadId, "Provider settings changed while this thread was running");
      if (host.store.taskByThread(botId, threadId)) {
        host.store.appendMessage(threadId, {
          role: "bot", kind: "activity",
          tool: failedTurnTool(cause)
        });
        host.store.setTaskActivity(botId, threadId, "idle");
      }
      host.settleDirectFollowup(owner?.generation, { ok: false, text: interrupted });
    }
    for (const [threadId, speaker] of rooms) {
      host.releaseLocalVmThread(threadId);
      host.releaseTurnResources(host.turnResourceOwners.get(threadId));
      host.endForeignTurns(threadId);
      host.watchdog.settle(threadId);
      host.closeOpenApprovals(threadId);
      if (host.groupSpeakers.get(threadId) !== speaker) continue;
      host.runningTurnEngines.delete(threadId);
      host.groupSpeakers.delete(threadId);
      const group = host.store.groupByThread(threadId);
      if (group) host.store.patchGroup(group.id, { busyBotId: host.activeGroupSpeaker(group.id)?.botId ?? null });
      host.store.setActivity(speaker.botId, "idle");
    }
    for (const id of changed) host.providerInstancesChanging.delete(id);
    host.providerFleetReloading = false;
  }
  // killed turns settle here without a turn.completed event, so anything
  // queued behind them drains now — onto the freshly loaded fleet
  host.drainQueuedSends();
}
  return reloadProviders;
}
