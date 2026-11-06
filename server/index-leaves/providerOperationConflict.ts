// @ts-nocheck
/** providerOperationConflict (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createProviderOperationConflict(getHost: () => Host): any {
function providerOperationConflict(provider: RemoteComputerProvider) {
  const host = getHost();

  if (provider === "vps" && host.activeVpsThreads.size > 0) {
    return "stop the active VPS turn before changing the SSH config alias";
  }
  if (host.managedBoatOwners().some((owner) => owner.inUse)) {
    return `stop active bot work and computer control before changing ${provider === "box" ? "the Boat account" : "the VPS connection"}`;
  }
  if (host.boatLifecycleBusyBots.size > 0 || host.vpsPreviewRequests.size > 0) {
    return "wait for cloud computer actions to finish before changing provider settings";
  }
  if (provider === "box") {
    if (host.boatInventoryRequestsBusyIds.size > 0 || host.orphanBoatLifecycleBusyIds.size > 0) {
      return "wait for cloud computer actions to finish before changing the Boat account";
    }
    const deletingBoatIds = new Set(host.boatDeletionSnapshot().map((entry) => entry.boxId));
    if (host.boatCreateRecoverySnapshot().some(
      (entry) => !entry.resolved && (!entry.boxId || !deletingBoatIds.has(entry.boxId)),
    )) {
      return "finish reconciling pending cloud computer creation before changing the Boat account";
    }
  } else if (host.vps.vpsLifecycleBusy()) {
    return "wait for VPS computer actions to finish before changing the SSH config alias";
  }
  return null;

}
  return providerOperationConflict;
}
