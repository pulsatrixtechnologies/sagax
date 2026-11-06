// @ts-nocheck
/** clearDirectTurnDispatch (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createClearDirectTurnDispatch(getHost: () => Host): any {
function clearDirectTurnDispatch(threadId: string, claimId: string) {
  const host = getHost();

  if (host.directTurnDispatchClaims.get(threadId)?.id === claimId) {
    host.directTurnDispatchClaims.delete(threadId);
    // A fast provider can settle before its dispatch ACK. Its first cleanup
    // still saw this reservation, so releasing it must retry the final fence.
    host.settleTrackedRequest(threadId);
  }

}
  return clearDirectTurnDispatch;
}
