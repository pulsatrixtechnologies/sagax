// @ts-nocheck
/** forceStopBot (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createForceStopBot(getHost: () => Host): any {
async function forceStopBot(botId: string) {
  const host = getHost();

  const bot = host.store.bot(botId);
  if (!bot) return;
  const work: Array<Promise<unknown>> = [host.interruptAllDirectThreads(botId)];
  // Its own routine run and a room goal it coordinates, each once.
  const routineRuns = [host.routines?.activeBotRunForBot(bot.id), host.routines?.activeRunForBot(bot.id)]
    .filter((run, index, all): run is NonNullable<typeof run> => Boolean(run) && all.findIndex((other) => other?.id === run!.id) === index);
  for (const routineRun of routineRuns) {
    if (routineRun.threadId) host.revokeInternalCapabilitiesForThread(routineRun.threadId);
    host.cancelDirectTurnDispatch(bot.id, routineRun.threadId);
    work.push(host.routines!.cancelRun(routineRun.id).then(() => { if (routineRun.threadId) host.closeOpenApprovals(routineRun.threadId); }));
  }
  const groupTurn = host.activeGroupTurnForBot(bot.id);
  if (groupTurn) {
    host.revokeInternalCapabilitiesForThread(groupTurn.threadId);
    host.cancelGroupTurnOperations(groupTurn.group.id, groupTurn.threadId);
    work.push(Promise.resolve(host.runningTurnInstance(bot, groupTurn.threadId)?.adapter.interruptTurn(groupTurn.threadId)).then(() => host.closeOpenApprovals(groupTurn.threadId)));
  }
  const results = await Promise.allSettled(work);
  const failure = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
  if (failure) throw failure.reason;

}
  return forceStopBot;
}
