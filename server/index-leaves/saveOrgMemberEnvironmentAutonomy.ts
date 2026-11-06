// @ts-nocheck
/** saveOrgMemberEnvironmentAutonomy (#1388). Pure move from server/index.ts. */
import { memberEnvironmentAutonomyAllowed } from "../people/member-environment.ts";
export type Host = Record<string, any>;

export function createSaveOrgMemberEnvironmentAutonomy(getHost: () => Host): any {
function saveOrgMemberEnvironmentAutonomy(allowed: boolean, actor: AdminActor) {
  const host = getHost();
  const { cfg, saveConfig } = host;
  const before = memberEnvironmentAutonomyAllowed(host.cfg.organization);
  saveConfig({ organization: { ...cfg.organization, memberEnvironmentAutonomy: allowed } });
  host.cfg.organization = { ...cfg.organization, memberEnvironmentAutonomy: allowed };
  host.orgAudit({
    category: "org", action: "org.settings", target: { kind: "organization" }, changed: ["memberEnvironmentAutonomy"],
    before: { memberEnvironmentAutonomy: before }, after: { memberEnvironmentAutonomy: allowed }, actor
  });

}
  return saveOrgMemberEnvironmentAutonomy;
}
