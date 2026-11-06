// @ts-nocheck
/** orgSettings (#1388). Pure move from server/index.ts. */
import { memberAutoApprovalAllowed } from "../approvals/member-auto-approval.ts";
import { pendingApprovalExpireDays } from "../approvals/pending-approval-expiry.ts";
import { interimWindowUntil } from "../interim-attach-routes.ts";
import { memberEnvironmentAutonomyAllowed } from "../people/member-environment.ts";
export type Host = Record<string, any>;

export function createOrgSettings(getHost: () => Host): any {
function orgSettings(): OrgSettings {
  const host = getHost();
  return {
    orgKeyConfigured: host.orgKeyConfigured(),
    allowFullAccess: host.orgFullAccessPolicy(),
    memberEnvironmentAutonomy: memberEnvironmentAutonomyAllowed(host.cfg.organization),
    confidentialThreadsByDefault: host.confidentialThreadsByDefault(),
    memberAutoApproval: memberAutoApprovalAllowed(host.cfg.organization),
    allowVaultExport: host.vaultExportAllowed(),
    allowGrokBridge: host.grokBridgeAllowed(),
    pluginMarketplaces: host.pluginMarketplacePolicy() ?? { mode: "any" },
    // lot 4: Perspicax owns the rule (Sources > Organization writes there)
    pluginMarketplacesOwner: host.orgCapabilitiesOwner(),
    ...(host.IDENTITY.kind === "perspicax" ? { flowPlugins: host.orgFlowPlugins.status() } : {}),
    github: { clientId: host.githubClientId() ?? null, fromEnvironment: !host.cfg.organization?.githubClientId && Boolean(process.env.SAGAX_GITHUB_CLIENT_ID?.trim()) },
    ...(host.IDENTITY.kind === "perspicax"
      ? { interimAttach: { until: interimWindowUntil(host.cfg.organization?.interimAttach, Date.now()), people: host.principals.listInterim().length } }
      : {}),
    pendingApprovalExpireDays: pendingApprovalExpireDays({
      orgDays: host.cfg.organization?.pendingApprovalExpireDays ?? null,
    }),
  };
}
  return orgSettings;
}
