// @ts-nocheck
/** runPendingApprovalExpirySweep (#1388). Pure move from server/index.ts. */
import { sweepPendingApprovalExpiry, sweepWaitingRowExpiry } from "../approvals/pending-approval-expiry.ts";
export type Host = Record<string, any>;

export function createRunPendingApprovalExpirySweep(getHost: () => Host): any {
function runPendingApprovalExpirySweep() {
  const host = getHost();

  let closed = 0;
  try {
    closed += sweepPendingApprovalExpiry(host.pendingExpiryDeps());
  } catch (error) {
    console.warn(`[approval] pending age expiry failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  // #3471: the questions in words and the proposal cards, same policy
  try {
    closed += sweepWaitingRowExpiry(host.waitingCardSkip.waitingRowExpiryDeps());
  } catch (error) {
    console.warn(`[approval] waiting card age expiry failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  return closed;

}
  return runPendingApprovalExpirySweep;
}
