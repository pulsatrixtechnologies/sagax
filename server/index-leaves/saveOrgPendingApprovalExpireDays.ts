// @ts-nocheck
/** saveOrgPendingApprovalExpireDays (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createSaveOrgPendingApprovalExpireDays(getHost: () => Host): any {
function saveOrgPendingApprovalExpireDays(days: number, actor: AdminActor) {
  const host = getHost();
  const { cfg, saveConfig } = host;
  const before = host.cfg.organization?.pendingApprovalExpireDays ?? null;
  saveConfig({ organization: { ...cfg.organization, pendingApprovalExpireDays: days } });
  host.cfg.organization = { ...cfg.organization, pendingApprovalExpireDays: days };
  host.orgAudit({
    category: "org", action: "org.settings", target: { kind: "organization" }, changed: ["pendingApprovalExpireDays"],
    before: { pendingApprovalExpireDays: before }, after: { pendingApprovalExpireDays: days }, actor
  });

}
  return saveOrgPendingApprovalExpireDays;
}
