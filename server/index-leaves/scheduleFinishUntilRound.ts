// @ts-nocheck
/** scheduleFinishUntilRound (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createScheduleFinishUntilRound(getHost: () => Host): any {
function scheduleFinishUntilRound(botId: string, threadId: string, outcome: { ok: boolean; stopped: boolean }) {
  const host = getHost();
  const { DATA_DIR, assertWithinBudget, hasQueuedSteeredMessages } = host;
  const bot = host.store.bot(botId);
  if (!bot) return;
  const goal = host.soloGoals.get(threadId);
  if (goal?.status === "working") {
    host.finishUntilRuns.reset(threadId);
    return;
  }
  const step = host.finishUntilRuns.settle(threadId, { condition: bot.finishUntil, maxRounds: bot.finishUntilMaxRounds, ...outcome });
  if (step.kind === "none") return;
  host.appendFinishUntilRow(threadId, step.line);
  if (step.kind !== "relaunch") return;
  const timer = setTimeout(() => {
    try {
      // The person wrote, stopped or changed the condition in the meantime:
      // their own turn or setting leads, this relaunch is dropped.
      if (host.finishUntilRuns.rounds(threadId) !== step.line.round) return;
      if (!host.store.bot(botId)?.finishUntil) {
        host.finishUntilRuns.reset(threadId);
        return;
      }
      if (host.threadBusy(botId, threadId) || hasQueuedSteeredMessages(botId, threadId) || host.stoppingThreads.has(threadId)) return;
      if (host.voiceCalls.active(threadId) || host.activeGroupTurnForBot(botId) || host.botAtThreadCapacity(botId)) return;
      if (!host.store.projectBotForTask(botId, threadId) || !host.store.taskByThread(botId, threadId)) return;
      try {
        assertWithinBudget(host.cfg, DATA_DIR);
      } catch {
        host.finishUntilRuns.reset(threadId);
        return;
      }
      const speaker = host.turnSpeakers.get(threadId);
      void host.startTurn(botId, step.prompt, { threadId, cardContinuation: true, ...(speaker ? { speaker } : {}) })
        .catch((error) => console.warn(`[finish-until] thread ${threadId}: the relaunch could not start: ${error instanceof Error ? error.message : String(error)}`));
    } catch (error) {
      console.warn("[finish-until] relaunch failed", error);
    }
  }, host.FINISH_UNTIL_RELAUNCH_DELAY_MS);
  timer.unref?.();

}
  return scheduleFinishUntilRound;
}
