// @ts-nocheck
/** orgAdminNames (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createOrgAdminNames(getHost: () => Host): any {
function orgAdminNames() {
  const host = getHost();

  if (host.IDENTITY.kind !== "perspicax") return [];
  return host.principals.list()
    .filter((person) => person.orgRole === "admin" && person.subject && person.disabledAt === undefined)
    .map((person) => (person.name || person.login || "").trim())
    .filter(Boolean)
    .slice(0, 5);

}
  return orgAdminNames;
}
