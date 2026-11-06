// @ts-nocheck
/** reviewHolds (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createReviewHolds(getHost: () => Host): any {
function reviewHolds(node: HandoffView) {
  const host = getHost();
  const { requestPeerApproval } = host;

  if (node.approvalGranted || node.status !== "queued" || node.executions > 0 || !node.parentId) return false;
  const parent = host.coordinator.node(node.parentId);
  const from = parent ? host.store.bot(parent.botId) : undefined;
  const target = host.store.bot(node.botId);
  if (!parent || !from || !target || !host.peerReviewRequired(from, parent.threadId)) return false;
  if (!host.peerReviews.has(node.id)) {
    host.peerReviews.set(node.id, "asking");
    const decided = (refusal?: string) => {
      if (refusal) host.peerReviews.set(node.id, refusal);
      else { host.peerReviews.delete(node.id); host.coordinator.approve(node.id); }
      host.coordinator.tick();
    };
    // A consultation asks as ask_bot; work and notices as delegate_bot.
    // full-access: peer-contact
    void requestPeerApproval(host.approvalBus, from, target, node.text, node.consult ? "ask_bot" : "delegate_bot", parent.threadId).then(verdict =>
      decided(verdict === "allow" ? undefined : verdict === "deny" ? "Denied by user; no work sent." : `${host.peerApprovalFailure(verdict).error}; no work sent.`),
    () => decided("The review card could not be shown; no work sent.")).catch(host.reportBackgroundError);
  }
  return true;

}
  return reviewHolds;
}
