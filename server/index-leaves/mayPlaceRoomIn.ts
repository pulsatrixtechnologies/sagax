// @ts-nocheck
/** mayPlaceRoomIn (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createMayPlaceRoomIn(getHost: () => Host): any {
function mayPlaceRoomIn(auth: RequestAuth, sectionName: string) {
  const host = getHost();

  if (host.IDENTITY.kind !== "perspicax" || !host.sectionChannels) return false;
  host.orgSectionNames();
  const owner = auth.kind === "session" ? auth.session.principalId?.trim() || host.localPrincipalId() : host.localPrincipalId();
  // #2045: the caller's own team with this name, never the first byName hit.
  const record = host.sectionChannels.byNameForOwner(sectionName, owner) ?? host.sectionChannels.byName(sectionName);
  if (!record) return false;
  const viewer = host.authzViewerFor(auth);
  if (!viewer || viewer.orgAdmin) return true;
  if (viewer.disabled) return false;
  return roleRank(sectionRole(viewer, recordAccess(record))) >= roleRank("participant");

}
  return mayPlaceRoomIn;
}
