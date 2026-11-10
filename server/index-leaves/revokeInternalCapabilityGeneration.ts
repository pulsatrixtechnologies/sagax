// @ts-nocheck
/** revokeInternalCapabilityGeneration (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createRevokeInternalCapabilityGeneration(getHost: () => Host): any {
function revokeInternalCapabilityGeneration(threadId: string, generation: string): Promise<void> {
  const host = getHost();
  // Slice 5: the turn's Perspicax MCP tokens go with its capabilities.
  // Callers that do not await keep the previous fire-and-forget behavior.
  // A call warm awaits it so the tokens are in the warm map before the
  // first spoken turn looks for them.
  const retired = host.perspicaxMcp?.endGeneration(threadId, generation) ?? Promise.resolve();
  if (host.standInRoots.delete(generation)) host.coordinator.endTurn(generation, { ok: true, text: "" });
  host.endForeignTurns(threadId, generation);
  if (host.guestDrivenTurns.get(threadId) === generation) host.guestDrivenTurns.delete(threadId);
  for (const [token, capability] of host.internalCapabilities) {
    if (capability.threadId === threadId && capability.generation === generation) {
      host.internalCapabilities.delete(token);
    }
  }
  if (host.activeInternalGenerationByThread.get(threadId) === generation) {
    host.activeInternalGenerationByThread.delete(threadId);
  }
  if (host.turnWorkplaces.get(threadId)?.generation === generation) host.turnWorkplaces.delete(threadId);
  // #3296: the turn is over (done, failed or stopped): so is its wait row
  host.endSandboxWakeRows?.({ threadId, generation });
  host.internalGenerationByProviderTurn.deleteGeneration(threadId, generation);
  return retired;
}
  return revokeInternalCapabilityGeneration;
}
