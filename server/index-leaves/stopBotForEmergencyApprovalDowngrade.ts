// @ts-nocheck
/** stopBotForEmergencyApprovalDowngrade (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createStopBotForEmergencyApprovalDowngrade(getHost: () => Host): any {
async function stopBotForEmergencyApprovalDowngrade(botId: string) {
  const host = getHost();

  const bot = host.store.bot(botId);
  if (!bot) return;
  for (const task of host.store.tasks(botId)) {
    if (task.approvalMode === "full" || task.approvalMode === "custom") {
      host.store.patchTask(botId, task.threadId, { approvalMode: "ask", autoApprove: false, alwaysAllow: [], approvalOwn: "safety" });
    }
  }
  const directStop = host.interruptAllDirectThreads(botId);

  const routineRun = host.routines?.activeBotRunForBot(bot.id);
  if (routineRun) {
    if (routineRun.threadId) host.revokeInternalCapabilitiesForThread(routineRun.threadId);
    host.cancelDirectTurnDispatch(bot.id, routineRun.threadId);
    await host.routines!.cancelRun(routineRun.id);
    if (routineRun.threadId) host.closeOpenApprovals(routineRun.threadId);
    await directStop;
    return;
  }

  const groupTurn = host.activeGroupTurnForBot(bot.id);
  if (groupTurn) {
    host.revokeInternalCapabilitiesForThread(groupTurn.threadId);
    host.cancelGroupTurnOperations(groupTurn.group.id, groupTurn.threadId);
    const results = await Promise.allSettled([
      directStop,
      host.runningTurnInstance(bot, groupTurn.threadId)?.adapter.interruptTurn(groupTurn.threadId),
    ]);
    host.closeOpenApprovals(groupTurn.threadId);
    const failure = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
    if (failure) throw failure.reason;
    return;
  }

  await directStop;

}
  return stopBotForEmergencyApprovalDowngrade;
}
