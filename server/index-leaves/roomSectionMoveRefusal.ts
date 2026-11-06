// @ts-nocheck
/** roomSectionMoveRefusal (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createRoomSectionMoveRefusal(getHost: () => Host): any {
function roomSectionMoveRefusal(auth: RequestAuth, group: GroupRecord, next: unknown) {
  const host = getHost();
  const { sectionKey } = host;

  if (host.IDENTITY.kind !== "perspicax" || !host.sectionChannels) return null;
  const viewer = host.authzViewerFor(auth);
  if (!viewer || viewer.orgAdmin) return null;
  const from = sectionKey(group.section);
  const to = typeof next === "string" ? next.trim() : "";
  if (from === to) return null;
  host.orgSectionNames();
  const me = viewer.principalId.trim().toLowerCase();
  for (const name of [from, to]) {
    if (!name) continue;
    // #2045: prefer the viewer's own team when two people share the name.
    const record = host.sectionChannels.byNameForOwner(name, me) ?? host.sectionChannels.byName(name);
    if (record && !canModerateSection(viewer, recordAccess(record))) return "only a moderator of both sections may move this room";
  }
  const someoneElse = (group.humanIds ?? []).some((entry) => {
    if (entry.startsWith("team:")) return true;
    return (entry.startsWith("user:") ? entry.slice(5) : entry).trim().toLowerCase() !== me;
  });
  if (to && someoneElse) return "only a room whose only person is you can be moved into a section";
  return null;

}
  return roomSectionMoveRefusal;
}
