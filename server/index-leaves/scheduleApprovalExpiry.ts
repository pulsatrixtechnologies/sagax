// @ts-nocheck
/** scheduleApprovalExpiry (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createScheduleApprovalExpiry(getHost: () => Host): any {
function scheduleApprovalExpiry(   target: { threadId: string; requestId: string; messageId: string; instanceId: string; botId: string; botName: string },   ms: number, ) {
  const host = getHost();
  const { DATA_DIR, appendDecision } = host;

  const timer = setTimeout(() => {
    const { threadId, requestId, messageId } = target;
    const open = () => {
      const card = host.store.messagesFor(threadId).find((m) => m.id === messageId)?.card;
      return card && card.requestId === requestId && !card.answered && !card.dismissed && !card.expired ? card : undefined;
    };
    const card = open();
    if (!card) return;
    void (async () => {
      const instance = host.runningTurnEngines.get(threadId) ?? host.registry.get(target.instanceId);
      try {
        await instance?.adapter.respondToRequest(threadId, requestId, { behavior: "deny", message: "Nobody answered this approval in time, so it was declined." });
      } catch { /* the request is gone either way: nothing ran */ }
      const settled = host.store.messagesFor(threadId).find((m) => m.id === messageId)?.card;
      if (settled && !settled.expired && (!settled.answered || settled.answered === "deny")) {
        host.store.patchMessage(threadId, messageId, { card: { ...settled, expired: true, options: [] } });
      }
      host.askMessageByRequest.delete(`${threadId}:${requestId}`);
      host.pendingCommandRules.delete(`${threadId}:${requestId}`);
      host.withdrawApprovalNotice(threadId, requestId, "expired");
      appendDecision(DATA_DIR, {
        threadId, requestId, botId: target.botId, botName: target.botName,
        tool: card.tool, summary: card.subtitle, decision: "auto-denied", source: "expired"
      });
    })().catch(() => console.error("[approval] Could not expire an unanswered approval."));
  }, ms);
  timer.unref?.();

}
  return scheduleApprovalExpiry;
}
