// @ts-nocheck
/** principalPermissions (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createPrincipalPermissions(getHost: () => Host): any {
function principalPermissions(principalId: string | undefined | null, options: { sessionAdmin?: boolean } = {}) {
  const host = getHost();
  const { isPrincipalId } = host;

  const person = principalId && isPrincipalId(principalId) ? host.principals.byId(principalId) : undefined;
  const admin = Boolean(person && (person.local === true || person.orgRole === "admin"));
  if (admin && options.sessionAdmin !== false) return host.effectivePermissions({ admin: true, fromDirectory: null });
  if (host.IDENTITY.kind !== "perspicax" || !person || admin) return host.effectivePermissions({ admin: false, fromDirectory: null });
  const sub = person.subject?.iss === host.IDENTITY.issuer ? person.subject.sub : undefined;
  return host.effectivePermissions({
    admin: false,
    fromDirectory: sub ? host.perspicaxDirectory?.permissionsOf(sub) ?? null : null,
    botsUseOnly: host.personSheetBotsUseOnly(person.id)
  });

}
  return principalPermissions;
}
