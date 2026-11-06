// @ts-nocheck
/** saveOrgMemberAutoApproval (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createSaveOrgMemberAutoApproval(getHost: () => Host): any {
function saveOrgMemberAutoApproval(allowed: boolean, actor: AdminActor) {
  const host = getHost();
  const { cfg, memberAutoApprovalAllowed, saveConfig } = host;
  const before = memberAutoApprovalAllowed(host.cfg.organization);
  saveConfig({ organization: { ...cfg.organization, memberAutoApproval: allowed } });
  host.cfg.organization = { ...cfg.organization, memberAutoApproval: allowed };
  host.orgAudit({
    category: "org", action: "org.settings", target: { kind: "organization" }, changed: ["memberAutoApproval"],
    before: { memberAutoApproval: before }, after: { memberAutoApproval: allowed }, actor
  });
  // the first time it is turned off: saved member Auto levels go to Ask once
  host.resetMemberAutoLevelsOnce();

}
  return saveOrgMemberAutoApproval;
}
