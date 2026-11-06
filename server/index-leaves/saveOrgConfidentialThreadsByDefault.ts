// @ts-nocheck
/** saveOrgConfidentialThreadsByDefault (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createSaveOrgConfidentialThreadsByDefault(getHost: () => Host): any {
function saveOrgConfidentialThreadsByDefault(on: boolean, actor: AdminActor) {
  const host = getHost();
  const { cfg, configStatus, saveConfig } = host;
  const before = host.confidentialThreadsByDefault();
  saveConfig({ organization: { ...cfg.organization, confidentialThreadsByDefault: on } });
  host.cfg.organization = { ...cfg.organization, confidentialThreadsByDefault: on };
  host.orgAudit({
    category: "org", action: "org.settings", target: { kind: "organization" }, changed: ["confidentialThreadsByDefault"],
    before: { confidentialThreadsByDefault: before }, after: { confidentialThreadsByDefault: on }, actor
  });
  // Every open New thread menu follows at once (config frame).
  host.broadcast({ kind: "config", ...configStatus() });

}
  return saveOrgConfidentialThreadsByDefault;
}
