// @ts-nocheck
/** releaseDataDirLeaseAtExit (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createReleaseDataDirLeaseAtExit(getHost: () => Host): any {
function releaseDataDirLeaseAtExit() {
  const host = getHost();

  if (host.dataDirLeaseReleaseAttempted) return;
  host.dataDirLeaseReleaseAttempted = true;
  try {
    host.dataDirLease.release();
  } catch (error) {
    // A failed release deliberately leaves a stale, owner-token-protected
    // lease. The next process can recover it only after this PID is dead.
    console.error(`[data-directory] lease release failed: ${error instanceof Error ? error.message : String(error)}`);
  }

}
  return releaseDataDirLeaseAtExit;
}
