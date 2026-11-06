// @ts-nocheck
/** dispatchDelegationWake (#1388). Pure move from server/index.ts. */
import { isTurnAdmissionBlocked } from "../turns/turn-dispatch-guard.ts";
import { buildDelegationFailurePrompt, buildDelegationRevivalPrompt } from "../peers/delegation-receipts.ts";
export type Host = Record<string, any>;

export function createDispatchDelegationWake(getHost: () => Host): any {
function dispatchDelegationWake(botId: string, threadId: string, targetName: string, failureReason?: string, routineRunId?: string, budgetAcquired = false, speaker?: TurnSpeaker) {
  const host = getHost();

  if (!host.store.taskByThread(botId, threadId)) return;
  if (!host.routineDelegationCanResume(threadId, routineRunId)) return;
  if (!budgetAcquired && !host.delegationWakeBudget.tryAcquire(threadId)) {
    host.routines?.failThread(threadId, "Delegation follow-up limit reached; review the run before retrying");
    return;
  }
  const prompt = failureReason
    ? buildDelegationFailurePrompt(targetName, failureReason)
    : buildDelegationRevivalPrompt(targetName);
  void host.startTurn(botId, prompt, {
    threadId,
    cardContinuation: true,
    unattended: host.isUnattended(botId, threadId),
    ...(speaker ? { speaker } : {})
  })
    .then(() => undefined)
    .catch((error) => {
      if (!host.store.taskByThread(botId, threadId)) return;
      const message = error instanceof Error ? error.message : String(error);
      // Raced with a user turn claiming the bot — retry once it settles.
      // This is the same logical wake, so keep its original budget charge.
      if (isTurnAdmissionBlocked(error)) {
        host.pendingDelegationWakes.set(threadId, { botId, targetName, failureReason, routineRunId, budgetAcquired: true, ...(speaker ? { speaker } : {}) });
        return;
      }
      host.store.appendMessage(threadId, {
        role: "bot",
        kind: "activity",
        tool: host.failedTurnTool(`could not resume after delegation — ${message}`)
      });
      host.routines?.failThread(threadId, `Could not resume after delegation: ${message}`);
    });

}
  return dispatchDelegationWake;
}
