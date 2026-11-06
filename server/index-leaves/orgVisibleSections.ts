// @ts-nocheck
/** orgVisibleSections (#1388). Pure move from server/index.ts. */
import { sectionRole } from "../auth/authz.ts";
import { UNCLAIMED_OWNER } from "../rooms/section-channels.ts";
export type Host = Record<string, any>;

export function createOrgVisibleSections(getHost: () => Host): any {
function orgVisibleSections(all: readonly string[], viewerId: string | undefined) {
  const host = getHost();

  if (host.IDENTITY.kind !== "perspicax" || !viewerId || !host.sectionChannels) return [...all];
  const viewer = host.authzViewerFromId(viewerId)!;
  const me = viewerId.trim().toLowerCase();
  const visible = new Set<string>();
  for (const record of host.sectionChannels.list()) {
    // #2045 isolation: a team nobody can be shown to own is listed for nobody.
    if (record.ownerPrincipalId.trim().toLowerCase() === UNCLAIMED_OWNER) continue;
    if (record.ownerPrincipalId.trim().toLowerCase() === me) visible.add(record.name);
    else if (record.members.length > 0 && sectionRole(viewer, { ...record }) !== null) visible.add(record.name);
  }
  const ordered = all.filter((name) => visible.has(name));
  for (const name of visible) if (!ordered.includes(name)) ordered.push(name);
  return ordered;

}
  return orgVisibleSections;
}
