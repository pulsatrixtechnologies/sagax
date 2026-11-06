// @ts-nocheck
/** finishGroupGoalRun (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createFinishGroupGoalRun(getHost: () => Host): any {
function finishGroupGoalRun(   groupId: string,   operation: GroupTurnOperation,   status: Exclude<GroupGoalRunStatus, "working">,   detail: string, ) {
  const host = getHost();
  const { deliverableNotification } = host;

  const run = operation.goalRun;
  if (!run || run.finished) return;
  run.finished = true;
  const finishedAt = Date.now();
  const safeDetail = host.redactSecretsInText(detail.trim()).slice(0, 500);
  const card: GroupGoalRunCardData = {
    runId: run.runId,
    goal: host.redactSecretsInText(run.goal),
    status,
    coordinatorBotId: run.coordinatorBotId,
    coordinatorName: host.redactSecretsInText(run.coordinatorName),
    turnCount: run.turnCount,
    maxTurns: run.maxTurns,
    detail: safeDetail,
    startedAt: run.startedAt,
    finishedAt
  };
  // A calendar-triggered team goal reuses its RoutineRun id for this card.
  // Manual goals have unrelated ids, so the manager safely ignores them.
  const routineRun = host.routines?.finishGoalRun(run.runId, status, safeDetail);
  if (routineRun?.status === "cancelled") {
    host.pendingDelegationWakes.delete(operation.threadId);
  }
  // Member-level turn completions are intentionally private/intermediate for
  // a team goal, so the normal direct-routine notification path never fires.
  // Notify once from the correlated terminal receipt instead.
  // A scheduled team goal that stops to ask is the one outcome a person
  // most needs to hear about — it must never be filed as a quiet completion.
  if (routineRun?.status === "waiting") {
    const coordinator = host.store.bot(routineRun.botId);
    if (coordinator) {
      const notificationBot = host.routineSourceOwner(routineRun)?.bot ?? coordinator;
      host.notify(deliverableNotification(
        "question",
        notificationBot,
        host.routineSourceThread(routineRun) ?? routineRun.threadId ?? operation.threadId,
        safeDetail || `${routineRun.routineName} needs your input`,
        { avatarUrl: notificationBot.avatarUrl },
      ));
    }
  }
  if (routineRun?.status === "completed" && !routineRun.quiet && host.routineEffectivePostResults(routineRun)) {
    const coordinator = host.store.bot(routineRun.botId);
    if (coordinator) {
      const notificationBot = host.routineSourceOwner(routineRun)?.bot ?? coordinator;
      host.notify(deliverableNotification(
        "done",
        notificationBot,
        host.routineSourceThread(routineRun) ?? routineRun.threadId ?? operation.threadId,
        safeDetail || routineRun.routineName,
        { avatarUrl: notificationBot.avatarUrl },
      ));
    }
  }
  const group = host.store.group(groupId);
  const ownsThread = group?.dm
    ? group.threadId === operation.threadId
    : Boolean(group && host.store.groupTaskByThread(group.id, operation.threadId));
  if (!ownsThread) return;
  const fallbackState = status === "completed"
    ? "completed"
    : status === "needs-input"
      ? "needs your input"
      : status === "limit-reached"
        ? "reached its limit"
        : status;
  host.store.patchMessage(operation.threadId, run.cardMessageId, {
    text: `Goal ${fallbackState}: ${card.detail || card.goal}`,
    goalRun: card
  });

}
  return finishGroupGoalRun;
}
