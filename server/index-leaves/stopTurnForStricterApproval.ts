// @ts-nocheck
/** stopTurnForStricterApproval (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createStopTurnForStricterApproval(getHost: () => Host): any {
async function stopTurnForStricterApproval(botId: string, threadId: string) {
  const host = getHost();

  const bot = host.store.bot(botId);
  if (!bot) return;
  const groupTurn = host.activeGroupTurnForBot(botId);
  const routineRun = host.routines?.activeBotRunForBot(botId);
  if (groupTurn?.threadId === threadId) {
    host.revokeInternalCapabilitiesForThread(threadId);
    host.cancelGroupTurnOperations(groupTurn.group.id, threadId);
    await host.runningTurnInstance(bot, threadId)?.adapter.interruptTurn(threadId);
    host.closeOpenApprovals(threadId);
  } else if (routineRun?.threadId === threadId) {
    host.revokeInternalCapabilitiesForThread(threadId);
    host.cancelDirectTurnDispatch(botId, threadId);
    await host.routines!.cancelRun(routineRun.id);
    host.closeOpenApprovals(threadId);
  } else {
    await host.stopDirectThread(botId, threadId);
  }
  host.store.appendMessage(threadId, {
    role: "bot",
    kind: "activity",
    tool: { name: host.STRICTER_APPROVAL_STOP_NOTE, ok: true }
  });

}
  return stopTurnForStricterApproval;
}
