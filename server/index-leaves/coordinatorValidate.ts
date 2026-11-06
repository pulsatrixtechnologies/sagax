// @ts-nocheck
/** coordinatorValidate (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createCoordinatorValidate(getHost: () => Host): any {
function coordinatorValidate(node: HandoffView, parent?: HandoffView) {
  const host = getHost();

  // A one-way notice that started belongs to its recipient (send_to_bot
  // moves ownership): a later change to the sender's peers or review does
  // not take it back. Its thread and bot must still exist.
  if (node.oneWay && node.executions > 0) return host.roomHandoffProblem(node);
  const route = host.roomHandoffProblem(node, parent);
  if (route) return route;
  const refused = host.peerReviews.get(node.id);
  if (refused && refused !== "asking") return refused;
  if (!parent || node.approvalGranted || !host.store.bot(parent.botId)?.approvePeerComms || host.fullAccessForSource(parent.botId, parent.threadId)) return undefined;
  // Work that never started waits for the person's card (reviewHolds);
  // work already under way needs a request the person approved.
  return node.status === "queued" && node.executions === 0 ? undefined : "Sender now requires peer approval; submit a new approved request";

}
  return coordinatorValidate;
}
