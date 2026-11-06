// @ts-nocheck
/** saveOrgAllowFullAccess (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createSaveOrgAllowFullAccess(getHost: () => Host): any {
function saveOrgAllowFullAccess(allowed: boolean, actor: AdminActor) {
  const host = getHost();
  const { cfg, saveConfig } = host;
  const before = host.orgFullAccessPolicy();
  saveConfig({ organization: { ...cfg.organization, allowFullAccess: allowed } });
  host.cfg.organization = { ...cfg.organization, allowFullAccess: allowed };
  host.orgAudit({
    category: "org", action: "org.settings", target: { kind: "organization" }, changed: ["allowFullAccess"],
    before: { allowFullAccess: before }, after: { allowFullAccess: allowed }, actor
  });

}
  return saveOrgAllowFullAccess;
}
