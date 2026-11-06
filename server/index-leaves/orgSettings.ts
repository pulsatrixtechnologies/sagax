// @ts-nocheck
/** orgSettings (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createOrgSettings(getHost: () => Host): any {
function orgSettings() {
  const host = getHost();
  const { memberAutoApprovalAllowed } = host;
  return {
    orgKeyConfigured: host.orgKeyConfigured(),
    allowFullAccess: host.orgFullAccessPolicy(),
    memberEnvironmentAutonomy: memberEnvironmentAutonomyAllowed(host.cfg.organization),
    confidentialThreadsByDefault: host.confidentialThreadsByDefault(),
    memberAutoApproval: memberAutoApprovalAllowed(host.cfg.organization),
    allowVaultExport: host.vaultExportAllowed(),
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
