// @ts-nocheck
/** saveOrgPluginMarketplaces (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createSaveOrgPluginMarketplaces(getHost: () => Host): any {
function saveOrgPluginMarketplaces(raw: unknown, actor: AdminActor) {
  const host = getHost();
  const { cfg, marketplacePolicySchema, saveConfig } = host;
  // lot 4: one owner. On a server whose Perspicax owns the rule, this local
  // copy is never a second store: write it in Perspicax (or through
  // Sources > Organization, which writes there).
  if (host.orgCapabilitiesOwner() === "perspicax") throw new host.OrgSettingOwnedElsewhere();
  const parsed = marketplacePolicySchema.safeParse(raw);
  if (!parsed.success) throw new Error("Send { mode: \"any\" } or { mode: \"list\", allow: [\"owner/repo\", \"owner/*\", \"https://...\"] }.");
  const next: MarketplacePolicy = parsed.data.mode === "any" ? { mode: "any" } : { mode: "list", allow: [...new Set(parsed.data.allow.map(normalizePolicyEntry))] };
  const before = host.historicalPluginMarketplacePolicy() ?? { mode: "any" };
  saveConfig({ organization: { ...cfg.organization, pluginMarketplaces: next } });
  host.cfg.organization = { ...cfg.organization, pluginMarketplaces: next };
  host.orgAudit({
    category: "org", action: "org.settings", target: { kind: "organization" }, changed: ["pluginMarketplaces"],
    before: { pluginMarketplaces: before }, after: { pluginMarketplaces: next }, actor
  });

}
  return saveOrgPluginMarketplaces;
}
