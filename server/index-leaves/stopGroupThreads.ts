// @ts-nocheck
/** stopGroupThreads (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createStopGroupThreads(getHost: () => Host): any {
async function stopGroupThreads(   group: GroupRecord,   threadIds: readonly string[],   outcome?: { status: "stopped" | "limit-reached"; detail: string; byHarness?: boolean }, ) {
  const host = getHost();

  const interruptTargets = threadIds.map((threadId) => {
    const speaker = host.groupSpeakers.get(threadId);
    const busy = speaker
      ? host.store.bot(speaker.botId)
      : threadId === group.threadId && group.busyBotId
        ? host.store.bot(group.busyBotId)
        : undefined;
    return {
      threadId,
      instance: busy ? host.runningTurnInstance(busy, threadId) : undefined
    };
  });
  // Abort every queued operation before the first provider round trip;
  // otherwise one queued task could begin while Stop awaits interruption
  // of the task ahead of it.
  for (const { threadId } of interruptTargets) host.cancelGroupTurnOperations(group.id, threadId, outcome);
  for (const { threadId, instance } of interruptTargets) {
    host.videoGenerations.cancelThread(threadId);
    host.revokeInternalCapabilitiesForThread(threadId);
    await instance?.adapter.interruptTurn(threadId).catch(host.reportBackgroundError);
    host.closeOpenApprovals(threadId);
  }

}
  return stopGroupThreads;
}
