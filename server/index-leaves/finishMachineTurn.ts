// @ts-nocheck
/** finishMachineTurn (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createFinishMachineTurn(getHost: () => Host): any {
function finishMachineTurn(messageId: string, outcome: { ok: boolean; text: string }) {
  const host = getHost();

  const held = host.machineTurnDone.get(messageId);
  if (!held) return;
  host.machineTurnDone.delete(messageId);
  host.machinePrompts.delete(messageId);
  host.machineProgressIds.delete(messageId);
  for (const [requestId, row] of host.machineApprovals) {
    if (row.threadId === held.threadId) host.machineApprovals.delete(requestId);
  }
  host.queuedWorkerTurns = host.queuedWorkerTurns.filter((item) => item.messageId !== messageId || item.botId !== held.botId);
  host.forgetInflight(messageId);
  host.store.setTaskActivity(held.botId, held.threadId, "idle");
  if (!outcome.ok) held.onError?.(outcome.text || "The turn failed.");
  held.coordination?.(outcome);
  held.settle?.();

}
  return finishMachineTurn;
}
