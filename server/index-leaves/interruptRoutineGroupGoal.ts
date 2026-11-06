// @ts-nocheck
/** interruptRoutineGroupGoal (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createInterruptRoutineGroupGoal(getHost: () => Host): any {
async function interruptRoutineGroupGoal(   groupId: string,   threadId: string,   outcome?: { status: "stopped" | "limit-reached"; detail: string }, ) {
  const host = getHost();

  host.videoGenerations.cancelThread(threadId);
  const speaker = host.groupSpeakers.get(threadId);
  const bot = speaker ? host.store.bot(speaker.botId) : undefined;
  host.cancelGroupTurnOperations(groupId, threadId, outcome);
  host.revokeInternalCapabilitiesForThread(threadId);
  await (bot ? host.runningTurnInstance(bot, threadId) : null)
    ?.adapter.interruptTurn(threadId)
    .catch(host.reportBackgroundError);
  host.closeOpenApprovals(threadId);

}
  return interruptRoutineGroupGoal;
}
