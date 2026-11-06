// @ts-nocheck
/** runAsChooserFor (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createRunAsChooserFor(getHost: () => Host): any {
function runAsChooserFor(auth: RequestAuth) {
  const host = getHost();
  if (host.IDENTITY.kind !== "perspicax" || auth.kind !== "session") return null;
  const principalId = auth.session.principalId?.trim();
  if (!principalId) return null;
  const person = host.principals.byId(principalId);
  return {
    principalId,
    // 2026-10-09: routines.runAsAnyone reaches every person, as an admin does.
    admin: host.orgAdminCaller(auth) || host.callerCan(auth, "routines.runAsAnyone"),
    managedTeamIds: (person?.teams ?? []).filter((team) => team.manager).map((team) => team.id),
    manager: person?.perspicaxRole === "manager"
  };

}
  return runAsChooserFor;
}
