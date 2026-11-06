// @ts-nocheck
/** authzViewerFromId (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createAuthzViewerFromId(getHost: () => Host): any {
function authzViewerFromId(viewerId: string | undefined) {
  const host = getHost();
  const { isPrincipalId } = host;
  if (!viewerId) return undefined;
  const person = isPrincipalId(viewerId) ? host.principals.byId(viewerId) : null;
  return {
    principalId: viewerId,
    orgAdmin: person?.local === true || person?.orgRole === "admin",
    teams: host.IDENTITY.kind === "perspicax" ? person?.teams ?? [] : [],
    disabled: (person?.disabledAt !== undefined && person?.disabledAt !== null) || Boolean(person?.consoleDisabled),
    ...(host.personBotsReadOnly(viewerId) ? { botsReadOnly: true } : {})
  };

}
  return authzViewerFromId;
}
