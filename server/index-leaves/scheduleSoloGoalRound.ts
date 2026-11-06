// @ts-nocheck
/** scheduleSoloGoalRound (#1388). Pure move from server/index.ts. */
import { soloGoalContinuePrompt, soloGoalLine } from "../solo-goal.ts";
export type Host = Record<string, any>;

export function createScheduleSoloGoalRound(getHost: () => Host): any {
function scheduleSoloGoalRound(botId: string, threadId: string, outcome: { ok: boolean; stopped: boolean }) {
  const host = getHost();
  const { DATA_DIR, assertWithinBudget, hasQueuedSteeredMessages } = host;
  const goal = host.soloGoals.get(threadId);
  if (!goal || goal.status !== "working") return;
  if (outcome.stopped) {
    const stopped = host.soloGoals.stop(threadId);
    if (stopped) host.appendSoloGoalRow(threadId, soloGoalLine(stopped));
    return;
  }
  if (!outcome.ok) return;
  const timer = setTimeout(() => {
    try {
      const current = host.soloGoals.get(threadId);
      if (!current || current.status !== "working") return;
      if (host.threadBusy(botId, threadId) || hasQueuedSteeredMessages(botId, threadId) || host.stoppingThreads.has(threadId)) return;
      if (host.voiceCalls.active(threadId) || host.activeGroupTurnForBot(botId) || host.botAtThreadCapacity(botId)) return;
      if (!host.store.projectBotForTask(botId, threadId) || !host.store.taskByThread(botId, threadId)) return;
      try {
        assertWithinBudget(host.cfg, DATA_DIR);
      } catch {
        return;
      }
      if (!host.soloGoals.nextRound(threadId)) {
        host.appendSoloGoalRow(threadId, { ...soloGoalLine(current), status: "paused", rounds: current.rounds });
        return;
      }
      const speaker = host.turnSpeakers.get(threadId);
      void host.startTurn(botId, soloGoalContinuePrompt(current), { threadId, cardContinuation: true, ...(speaker ? { speaker } : {}) })
        .catch((error) => console.warn(`[goal] thread ${threadId}: the next turn could not start: ${error instanceof Error ? error.message : String(error)}`));
    } catch (error) {
      console.warn("[goal] next turn failed", error);
    }
  }, host.SOLO_GOAL_ROUND_DELAY_MS);
  timer.unref?.();

}
  return scheduleSoloGoalRound;
}
