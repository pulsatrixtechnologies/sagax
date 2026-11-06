// @ts-nocheck
/** applyStricterApprovalLive (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createApplyStricterApprovalLive(getHost: () => Host): any {
async function applyStricterApprovalLive(botId: string, before: RunningTurnLevels) {
  const host = getHost();

  const bot = host.store.bot(botId);
  if (!bot || before.size === 0) return;
  // A room turn answers at the level it was sent with; only a stricter own
  // level lowers it for the rest of that turn.
  const groupTurn = host.activeGroupTurnForBot(botId);
  if (groupTurn && before.has(groupTurn.threadId) && before.roomOwn) {
    const ownNow = host.approvalModeForTurn(bot, false, groupTurn.threadId);
    if (liveApprovalTightens(before.roomOwn, ownNow)) host.roomTurnLevels.tighten(groupTurn.threadId, botId, ownNow);
  }
  const after = host.runningTurnLevels(botId);
  const stops: Array<Promise<void>> = [];
  for (const [threadId, was] of before) {
    const now = after.get(threadId);
    if (!now || !liveApprovalTightens(was, now)) continue;
    const adapter = host.runningTurnInstance(bot, threadId)?.adapter;
    const applied = await (adapter?.applyApprovalMode?.(threadId, now) ?? Promise.resolve(false)).catch(() => false);
    if (!applied) stops.push(host.stopTurnForStricterApproval(botId, threadId));
  }
  const failure = (await Promise.allSettled(stops)).find((result): result is PromiseRejectedResult => result.status === "rejected");
  if (failure) throw failure.reason;

}
  return applyStricterApprovalLive;
}
