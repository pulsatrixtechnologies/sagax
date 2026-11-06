// @ts-nocheck
/** runningTurnLevels (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createRunningTurnLevels(getHost: () => Host): any {
function runningTurnLevels(botId: string) {
  const host = getHost();

  const levels: RunningTurnLevels = new Map<string, ApprovalMode>();
  const bot = host.store.bot(botId);
  if (!bot) return levels;
  const own = (threadId: string) =>
    host.approvalModeForTurn(host.store.projectBotForTask(botId, threadId) ?? bot, host.isInternalTurn(threadId), threadId);
  for (const task of host.store.tasks(botId)) {
    if (host.threadBusy(botId, task.threadId)) levels.set(task.threadId, own(task.threadId));
  }
  const routineRun = host.routines?.activeBotRunForBot(botId);
  if (routineRun?.threadId && !levels.has(routineRun.threadId)) levels.set(routineRun.threadId, own(routineRun.threadId));
  const groupTurn = host.activeGroupTurnForBot(botId);
  if (groupTurn) {
    levels.set(groupTurn.threadId, host.roomTurnLevels.forRequest(groupTurn.threadId, botId, () => own(groupTurn.threadId)));
    // the bot's own level there, apart from a level a Chief handed down
    levels.roomOwn = host.approvalModeForTurn(bot, false, groupTurn.threadId);
  }
  return levels;

}
  return runningTurnLevels;
}
