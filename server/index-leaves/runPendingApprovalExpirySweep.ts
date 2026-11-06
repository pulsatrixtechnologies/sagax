// @ts-nocheck
/** runPendingApprovalExpirySweep (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createRunPendingApprovalExpirySweep(getHost: () => Host): any {
function runPendingApprovalExpirySweep() {
  const host = getHost();

  try {
    return sweepPendingApprovalExpiry(host.pendingExpiryDeps());
  } catch (error) {
    console.warn(`[approval] pending age expiry failed: ${error instanceof Error ? error.message : String(error)}`);
    return 0;
  }

}
  return runPendingApprovalExpirySweep;
}
