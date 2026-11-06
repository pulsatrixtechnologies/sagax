// @ts-nocheck
/** revokeEarlierTurnCapabilities (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createRevokeEarlierTurnCapabilities(getHost: () => Host): any {
function revokeEarlierTurnCapabilities(threadId: string) {
  const host = getHost();

  host.computerSelectionTurns.delete(threadId);
  host.turnWorkplaces.delete(threadId);
  void host.perspicaxMcp?.endThread(threadId);
  const generation = host.activeInternalGenerationByThread.get(threadId);
  if (generation) host.revokeInternalCapabilityGeneration(threadId, generation);
  // Defensive cleanup for any generation orphaned before exact ownership was
  // introduced. This force variant is used only by explicit stop/delete and
  // before a brand-new generation is published, never by a stale async catch.
  for (const [token, capability] of host.internalCapabilities) {
    if (capability.threadId === threadId) host.internalCapabilities.delete(token);
  }

}
  return revokeEarlierTurnCapabilities;
}
