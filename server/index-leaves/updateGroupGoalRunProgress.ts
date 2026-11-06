// @ts-nocheck
/** updateGroupGoalRunProgress (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createUpdateGroupGoalRunProgress(getHost: () => Host): any {
function updateGroupGoalRunProgress(operation: GroupTurnOperation, detail: string) {
  const host = getHost();

  const run = operation.goalRun;
  if (!run || run.finished) return;
  const safeDetail = host.redactSecretsInText(detail.trim()).slice(0, 500);
  const current = host.store.messagesFor(operation.threadId).find((message) => message.id === run.cardMessageId);
  if (current?.goalRun?.status === "working" && current.goalRun.detail === safeDetail) return;
  host.store.patchMessage(operation.threadId, run.cardMessageId, {
    text: `Goal in progress: ${safeDetail || redactSecretsInText(run.goal)}`,
    goalRun: {
      runId: run.runId,
      goal: host.redactSecretsInText(run.goal),
      status: "working",
      coordinatorBotId: run.coordinatorBotId,
      coordinatorName: host.redactSecretsInText(run.coordinatorName),
      turnCount: run.turnCount,
      maxTurns: run.maxTurns,
      ...(safeDetail ? { detail: safeDetail } : {}),
      startedAt: run.startedAt
    }
  });

}
  return updateGroupGoalRunProgress;
}
