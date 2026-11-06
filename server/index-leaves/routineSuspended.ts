// @ts-nocheck
/** routineSuspended (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createRoutineSuspended(getHost: () => Host): any {
function routineSuspended(routine: Routine, run: RoutineRun | null, reason: RoutineSuspendReason) {
  const host = getHost();
  const { deliverableNotification } = host;

  const bot = host.store.bot(routine.botId);
  const runAs = host.effectiveRunAs(routine);
  const runAsPerson = runAs ? host.principals.byId(runAs) : null;
  const runAsName = runAsPerson?.name || runAsPerson?.login || "";
  host.routineAudit("routine.suspended", runAs, { routine, reason });
  if (!bot) return;
  const group = routine.target === "room-goal" && routine.groupId ? host.store.group(routine.groupId) : undefined;
  const threadId = host.routineSourceOwner(routine)?.threadId ?? group?.threadId ?? bot.threadId;
  const card: WireAccessCard = {
    reason: "routine_delegation", engine: "", botId: bot.id, ownerPrincipalId: host.effectiveBotOwner(bot),
    ...(runAs ? { runAsPrincipalId: runAs } : {}),
    ...(runAsName ? { runAsName: runAsName.slice(0, 200) } : {}),
    routineId: routine.id, routineName: host.redactSecretsInText(routine.name).slice(0, 200), suspendReason: reason
  };
  try {
    host.store.appendMessage(threadId, {
      role: "bot",
      kind: "access",
      from: { botId: bot.id, name: bot.name, color: bot.color },
      access: card
    });
  } catch (error) {
    console.error(`routine: the pause card could not be written: ${error instanceof Error ? error.message : String(error)}`);
  }
  host.notifyAccess(deliverableNotification("routine-failed", bot, threadId, `${redactSecretsInText(routine.name)}: paused (${reason === "person_out" ? "its person was signed out by Perspicax" : "its person can no longer run this bot"})`), card, run?.id);

}
  return routineSuspended;
}
