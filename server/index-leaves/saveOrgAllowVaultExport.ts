// @ts-nocheck
/** saveOrgAllowVaultExport (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createSaveOrgAllowVaultExport(getHost: () => Host): any {
function saveOrgAllowVaultExport(allowed: boolean, actor: AdminActor) {
  const host = getHost();
  const { cfg, saveConfig } = host;
  const before = host.vaultExportAllowed();
  saveConfig({ organization: { ...cfg.organization, allowVaultExport: allowed } });
  host.cfg.organization = { ...cfg.organization, allowVaultExport: allowed };
  host.orgAudit({
    category: "org", action: "org.settings", target: { kind: "organization" }, changed: ["allowVaultExport"],
    before: { allowVaultExport: before }, after: { allowVaultExport: allowed }, actor
  });

}
  return saveOrgAllowVaultExport;
}
