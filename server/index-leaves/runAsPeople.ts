// @ts-nocheck
/** runAsPeople (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createRunAsPeople(getHost: () => Host): any {
function runAsPeople() {
  const host = getHost();

  if (host.IDENTITY.kind !== "perspicax" || !host.perspicaxDirectory) return [];
  return host.orgDirectoryEntries(host.IDENTITY.issuer, host.perspicaxDirectory.people(), (iss, sub) => host.principals.bySubject(iss, sub)).map((entry) => ({
    principalId: entry.principalId,
    name: entry.name,
    ...(entry.avatarUrl ? { avatarUrl: entry.avatarUrl } : {}),
    disabled: entry.disabled || host.principals.byId(entry.principalId)?.disabledAt !== undefined,
    ...(entry.service ? { service: true } : {}),
    teams: host.principals.byId(entry.principalId)?.teams ?? entry.teams ?? []
  }));

}
  return runAsPeople;
}
