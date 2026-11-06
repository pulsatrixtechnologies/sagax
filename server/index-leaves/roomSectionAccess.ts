// @ts-nocheck
/** roomSectionAccess (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createRoomSectionAccess(getHost: () => Host): any {
function roomSectionAccess(group: { id?: unknown; section?: unknown; sectionId?: unknown }) {
  const host = getHost();

  if (host.IDENTITY.kind !== "perspicax" || typeof group.id !== "string" || !host.sectionChannels) return null;
  if (typeof group.sectionId === "string" && group.sectionId.trim()) {
    const byId = host.sectionChannels.accessForRoom(
      typeof group.section === "string" ? group.section : "",
      group.id,
      group.sectionId,
    );
    if (byId) return byId;
  }
  if (typeof group.section !== "string" || !group.section) return null;
  return host.sectionChannels.accessForRoom(group.section, group.id);

}
  return roomSectionAccess;
}
