// @ts-nocheck
/** orgAdminNames (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createOrgAdminNames(getHost: () => Host): any {
function orgAdminNames() {
  const host = getHost();

  // #4451: the same admins whose Primary Bot gets the approval cards
  return host.orgAdminPrincipals()
    .map((id) => host.principals.byId(id))
    .map((person) => (person?.name || person?.login || "").trim())
    .filter(Boolean)
    .slice(0, 5);

}
  return orgAdminNames;
}
