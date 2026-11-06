// @ts-nocheck
/** routineSourceOwner (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createRoutineSourceOwner(getHost: () => Host): any {
function routineSourceOwner(run: Pick<RoutineRun, "botId" | "sourceThreadId" | "resultsThreadId">) {
  const host = getHost();
  const { canReachPeer } = host;

  if (run.resultsThreadId) {
    const bot = host.store.bot(run.botId);
    const task = bot && host.store.taskByThread(bot.id, run.resultsThreadId);
    return bot && !bot.hidden && task && !task.routineRunId
      ? { bot, group: undefined, threadId: task.threadId }
      : null;
  }
  // Without a results snapshot (a run from before every routine reported to
  // its bot's main thread, or a bot with no visible thread) the chat that
  // made the routine is the destination.
  const threadId = run.sourceThreadId?.trim();
  if (!threadId) return null;
  // Validate before messagesFor(): Store lazily opens transcript storage, so
  // reading an orphan id first would recreate a deleted conversation.
  const bot = host.store.bot(run.botId);
  if (!bot) return null;
  // The source is stamped from the confirmed request, never calendar input.
  // A request for a teammate runs as that teammate but reports to the bot
  // whose conversation held the card. Recheck their section before sharing
  // a result, since either bot may have moved since confirmation.
  const sourceBot = host.store.botByThread(threadId);
  if (sourceBot && !sourceBot.hidden && !host.store.taskByThread(sourceBot.id, threadId)?.routineRunId &&
    (sourceBot.id === bot.id || canReachPeer(sourceBot, bot))) {
    return { bot: sourceBot, group: undefined, threadId };
  }
  const group = host.store.groupByThread(threadId);
  return group?.memberIds.includes(bot.id) ? { bot, group, threadId } : null;

}
  return routineSourceOwner;
}
