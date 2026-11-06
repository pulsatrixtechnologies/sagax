// @ts-nocheck
/** revokeAllInternalCapabilities (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createRevokeAllInternalCapabilities(getHost: () => Host): any {
function revokeAllInternalCapabilities() {
  const host = getHost();

  host.computerSelectionTurns.clear();
  host.turnWorkplaces.clear();
  if (host.perspicaxMcp) host.perspicaxEnding = host.perspicaxMcp.endAll();
  host.internalCapabilities.clear();
  host.sessionCredentials.clear();
  host.activeInternalGenerationByThread.clear();
  host.internalGenerationByProviderTurn.clear();

}
  return revokeAllInternalCapabilities;
}
