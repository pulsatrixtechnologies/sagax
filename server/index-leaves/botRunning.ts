// @ts-nocheck
/** botRunning (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createBotRunning(getHost: () => Host): any {
function botRunning(botId: string) {
  const host = getHost();

  const bot = host.store.bot(botId);
  if (!bot) return false;
  if (host.store.tasks(botId).some((task) => task.busy || host.directClaimOccupies(task.threadId) || host.coordinator.activeDirect(task.threadId))) return true;
  if (host.threadBusy(botId, bot.threadId)) return true;
  if (host.routines?.activeBotRunForBot(botId) || host.routines?.activeRunForBot(botId)) return true;
  return host.activeGroupTurnForBot(botId) !== null;

}
  return botRunning;
}
