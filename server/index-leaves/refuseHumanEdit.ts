// @ts-nocheck
/** refuseHumanEdit (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createRefuseHumanEdit(getHost: () => Host): any {
function refuseHumanEdit(auth: RequestAuth, body: unknown, before: readonly string[] = [], ownerChecked = false) {
  const host = getHost();
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  if (!Object.prototype.hasOwnProperty.call(body, "humanIds")) return null;
  const after = (body as { humanIds?: unknown }).humanIds;
  if (host.IDENTITY.kind === "perspicax" && Array.isArray(after)) {
    // Slice 4 (D5): `team:<id>` names a Perspicax team this server knows.
    for (const entry of after) {
      if (typeof entry !== "string" || !entry.startsWith("team:")) continue;
      const id = entry.slice(5);
      if (!/^[0-9A-Za-z]{1,64}$/.test(id) || !(host.orgTeams.has(id) || host.principals.membersOfTeam(id).length)) return "unknown team: choose a team from the organization directory";
    }
  }
  // A member who owns the room adds people the organization directory lists
  // as active and the organization's teams (checked just above).
  if (ownerChecked && host.IDENTITY.kind === "perspicax" && Array.isArray(after) && host.channelActorRole(auth) === "member") {
    const unseen = firstUnseenPerson({ actorId: host.channelActorId(auth), before, after, visible: (id) => host.resolveOrgGrantee(id).ok });
    if (unseen !== null) return "unknown person: choose someone from the organization directory";
  }
  // Organization server: the group's owner rule already decided (group-ownership.ts).
  if (ownerChecked) return null;
  const role = host.channelActorRole(auth);
  if (role && canEditHumans(role)) return null;
  // A team manager changes the entries of their teams and members; adding
  // one needs the room to list one of their teams already.
  if (host.IDENTITY.kind === "perspicax" && Array.isArray(after) && after.every((entry) => typeof entry === "string")) {
    if (canEditRoomHumans(host.authzViewerFor(auth), { before, after: after as string[], teamsOf: host.principalTeams })) return null;
  }
  return "forbidden: only an owner or an admin can change channel people";

}
  return refuseHumanEdit;
}
