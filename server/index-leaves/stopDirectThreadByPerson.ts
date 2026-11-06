// @ts-nocheck
/** stopDirectThreadByPerson (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createStopDirectThreadByPerson(getHost: () => Host): any {
async function stopDirectThreadByPerson(botId: string, threadId: string, utteranceId?: string) {
  const host = getHost();

  host.videoGenerations.cancelThread(threadId, botId);
  // #1329: Stop between two relaunches (no turn running) ends the run
  // here; a running turn ends it when it settles as stopped.
  if (!host.threadBusy(botId, threadId)) {
    const spent = host.finishUntilRuns.rounds(threadId);
    const bot = host.store.bot(botId);
    host.finishUntilRuns.reset(threadId);
    if (spent > 0 && bot?.finishUntil) host.appendFinishUntilRow(threadId, { status: "stopped", condition: bot.finishUntil, round: spent, max: host.finishUntilRounds(bot.finishUntilMaxRounds) });
  }
  await host.stopDirectThread(botId, threadId, utteranceId);
  // the bot's own sub-agents of this conversation stop with it
  await host.stopOwnSubagents(botId, threadId);

}
  return stopDirectThreadByPerson;
}
