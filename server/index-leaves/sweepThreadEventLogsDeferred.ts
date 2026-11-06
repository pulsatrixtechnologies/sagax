// @ts-nocheck
/** sweepThreadEventLogsDeferred (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createSweepThreadEventLogsDeferred(getHost: () => Host): any {
async function sweepThreadEventLogsDeferred() {
  const host = getHost();

  const retentionDays = threadEventLogRetentionDays(host.cfg);
  if (retentionDays === null) return;
  const openDirect = host.coordinator.activeDirectThreads();
  const candidates: ThreadLogRetentionCandidate[] = [];
  let seen = 0;
  for (const bot of host.store.bots) {
    for (const task of bot.tasks ?? []) {
      candidates.push({
        threadId: task.threadId,
        closedAt: task.closedBy?.at ?? null,
        archivedAt: task.archivedAt ?? null,
        unread: task.unread === true,
        busy: host.threadBusy(bot.id, task.threadId),
        openDirectHandoff: openDirect.has(task.threadId)
      });
      if (++seen % 50 === 0) await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }
  const swept = await host.sweepThreadEventLogsPaced(candidates, retentionDays);
  if (swept > 0) console.log(`[retention] removed event logs for ${swept} idle thread(s) past ${retentionDays} day(s)`);

}
  return sweepThreadEventLogsDeferred;
}
