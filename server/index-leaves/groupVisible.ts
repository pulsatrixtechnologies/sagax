// @ts-nocheck
/** groupVisible (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createGroupVisible(getHost: () => Host): any {
function groupVisible(group: { id?: unknown; humanIds?: string[]; section?: unknown; peopleDm?: boolean; archivedAt?: number }, viewerId: string | undefined) {
  const host = getHost();

  // The last person left it (server/groups/group-leave.ts): kept, listed to no one.
  if (group.archivedAt) return false;
  // A conversation between two people is theirs alone (server/people/people-dms.ts):
  // not an admin's, a section's, nor the operator's at this computer.
  if (group.peopleDm) return host.isPeopleDmParticipant(group, viewerId);
  if (!viewerId) return true;
  return seesChannel(group, viewerId, host.authzViewerFromId(viewerId), host.roomSectionAccess(group));

}
  return groupVisible;
}
