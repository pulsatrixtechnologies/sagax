// @ts-nocheck
/** runPendingApprovalExpirySweep (#1388). Pure move from server/index.ts. */
import { sweepPendingApprovalExpiry, sweepWaitingRowExpiry } from "../approvals/pending-approval-expiry.ts";
export type Host = Record<string, any>;

const warn = (what: string, error: unknown) =>
  console.warn(`[approval] ${what} failed: ${error instanceof Error ? error.message : String(error)}`);

export function createRunPendingApprovalExpirySweep(getHost: () => Host): any {
/** #3471: the questions in words and the proposal cards, same policy.
 * #3517: found by the store's query, never by reading every conversation.
 * Sealed rows written before their projection carried the waiting flags
 * are rewritten once, a small batch at a time, and swept when that ends. */
function runWaitingRowExpirySweep() {
  const host = getHost();
  let closed = 0;
  try {
    closed += sweepWaitingRowExpiry(host.waitingCardSkip.waitingRowExpiryDeps());
  } catch (error) {
    warn("waiting card age expiry", error);
  }
  try {
    if (host.hasUnprojectedSealedRows()) {
      void host.reprojectSealedRows().then((rewritten: number) => {
        if (rewritten > 0) sweepWaitingRowExpiry(host.waitingCardSkip.waitingRowExpiryDeps());
      }).catch((error: unknown) => warn("waiting card age expiry of older sealed rows", error));
    }
  } catch (error) {
    warn("waiting card age expiry of older sealed rows", error);
  }
  return closed;
}

/** Every inbox card past its age, then the waiting rows; at the start, the
 * waiting rows wait for the server to listen (`waitingRows: false`). */
function runPendingApprovalExpirySweep(options: { waitingRows?: boolean } = {}) {
  const host = getHost();

  let closed = 0;
  try {
    closed += sweepPendingApprovalExpiry(host.pendingExpiryDeps());
  } catch (error) {
    warn("pending age expiry", error);
  }
  if (options.waitingRows !== false) closed += runWaitingRowExpirySweep();
  return closed;

}
  runPendingApprovalExpirySweep.waitingRows = runWaitingRowExpirySweep;
  return runPendingApprovalExpirySweep;
}
