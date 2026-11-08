// @ts-nocheck
/** agentTurnState (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createAgentTurnState(getHost: () => Host): any {
function agentTurnState(agentId: string, threadId: string) {
  const host = getHost();
  const { queuedThreadPosition } = host;

  const task = host.store.taskByThread(agentId, threadId);
  if (task?.activity === "waiting-on-you") return "waiting";
  const busy = host.threadBusy(agentId, threadId);
  // 2026-11-08 (#2922): a live card of the CURRENT turn (created after its
  // prompt) the person must answer, in this thread or in a thread it handed
  // work to, means the turn waits on them even while the engine still counts
  // it as running (activity reset to working by an earlier answer, a
  // teammate's card two levels down). A card under model review is not for
  // the person yet; a card left by an earlier turn is not this turn's.
  if (!host.agentPendingApproval) {
    if (busy) return "running";
    if (queuedThreadPosition(agentId, threadId) !== null || host.coordinator.activeDirect(threadId)) return "queued";
    return host.openQuestionCard(threadId) ? "waiting" : "idle";
  }
  const open = host.agentPendingApproval(agentId, threadId)?.open ?? [];
  if (open.some((row) => row.threadId !== threadId)) return "waiting";
  if (open.length && (busy || task?.activity === "working")) return "waiting";
  if (busy) return "running";
  if (queuedThreadPosition(agentId, threadId) !== null || host.coordinator.activeDirect(threadId)) return "queued";
  // 2026-11-03: a question card that outlived its turn (ask_choice where
  // nobody watches) waits on the person; only the last turn's, never one a
  // later prompt already moved past (#2922)
  return open.some((row) => host.isPersistentQuestionCard?.(row.card) && !host.isApprovalCardMessage?.(row.message)) ? "waiting" : "idle";

}
  return agentTurnState;
}
