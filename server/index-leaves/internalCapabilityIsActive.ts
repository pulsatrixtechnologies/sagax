// @ts-nocheck
/** internalCapabilityIsActive (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createInternalCapabilityIsActive(getHost: () => Host): any {
function internalCapabilityIsActive(capability: InternalCapability) {
  const host = getHost();

  if (capability.generation === host.EXTERNAL_RUNTIME_GENERATION) {
    return Boolean(capability.externalRuntime && capability.externalRuntime.botId === capability.botId &&
      capability.externalRuntime.threadId === capability.threadId &&
      host.externalRuntimeIsActive(host.EXTERNAL_RUNTIMES_FILE, capability.externalRuntime, id => host.store.bot(id)));
  }
  const switching = host.computerSelectionTurns.get(capability.threadId);
  if ((capability.kind === "computer" || capability.kind === "browser") &&
      switching?.generation === capability.generation && switching.selected) return false;
  if (capability.teamComputerId) {
    const pinned = host.teamComputerTurns.get(capability.threadId);
    if (pinned?.computerId !== capability.teamComputerId || pinned.owner.generation !== capability.generation ||
        pinned.botId !== capability.botId) return false;
  }
  if (capability.localVmTarget) {
    const owner = host.localVmLeaseFor(capability.localVmTarget).current(host.localVmOwnerBusy);
    if (host.localVmThreadTargets.get(capability.threadId) !== capability.localVmTarget ||
        owner?.threadId !== capability.threadId || owner.botId !== capability.botId) return false;
  }
  return (
    capability.orphanExpiresAt > Date.now() &&
    host.activeInternalGenerationByThread.get(capability.threadId) === capability.generation
  );

}
  return internalCapabilityIsActive;
}
