// @ts-nocheck
/** agentTurnState (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createAgentTurnState(getHost: () => Host): any {
function agentTurnState(agentId: string, threadId: string) {
  const host = getHost();
  const { queuedThreadPosition } = host;

  const task = host.store.taskByThread(agentId, threadId);
  if (task?.activity === "waiting-on-you") return "waiting";
  if (host.threadBusy(agentId, threadId)) return "running";
  if (queuedThreadPosition(agentId, threadId) !== null || host.coordinator.activeDirect(threadId)) return "queued";
  // 2026-11-03: a question card that outlived its turn (ask_choice where nobody watches) waits on the person
  return host.openQuestionCard(threadId) ? "waiting" : "idle";

}
  return agentTurnState;
}
