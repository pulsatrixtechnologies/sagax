// Capabilities lot 4: the organization's capabilities, read and written
// from the Organization scope of Plugins (server/routes/org-capabilities.ts).
// Perspicax owns them on a linked server; this server's routes carry the
// signed-in admin's word there. A person's own switch for an offered one
// stays in their Me state (`/api/me/org-capabilities`).
import type { Capability as Declaration, CapabilityInput, CapabilityMarketplace, MarketplaceInput, MarketplaceMode } from "../../shared/org-capability-form";
import { api } from "@/state/store";

export const ORG_CAPABILITIES_ROUTE = "/api/org/capabilities";
export const ME_ORG_CAPABILITIES_ROUTE = "/api/me/org-capabilities";

/** What this server did of a declaration (installed once here). */
export type InstallState = "installed" | "pending" | "failed" | "declared" | "off" | "flow";

/** One declaration as a member sees it: public fields, whether it is on
 * for them, whether they may switch it (offered, on in Perspicax). */
export interface MemberOrgCapability {
  id: string;
  mount: string;
  form: "plugin" | "skill" | "mcp";
  name: string;
  description: string;
  mode: "offered" | "imposed";
  enabled: boolean;
  state: InstallState;
  transport?: "stdio" | "http";
  version?: string;
  on: boolean;
  canToggle: boolean;
}

export interface OrgInventory {
  owner: "perspicax" | "local";
  capabilities?: Declaration[];
  marketplaces?: CapabilityMarketplace[];
  marketplace_policy?: { mode: MarketplaceMode } | null;
  installed?: Record<string, { state: InstallState; error?: string }>;
  migrated?: boolean;
}

export function loadMine(): Promise<{ owner: "perspicax" | "local"; items: MemberOrgCapability[] }> {
  return api(ME_ORG_CAPABILITIES_ROUTE);
}

export function setMine(id: string, enabled: boolean): Promise<{ item: MemberOrgCapability }> {
  return api(`${ME_ORG_CAPABILITIES_ROUTE}/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify({ enabled }) });
}

export function loadInventory(): Promise<OrgInventory> {
  return api(ORG_CAPABILITIES_ROUTE);
}

/** Create (no id) or replace a declaration. An edit that leaves the
 * configuration out keeps the one Perspicax sealed. */
export function saveDeclaration(input: CapabilityInput, id?: string): Promise<{ value: Declaration; changed: boolean }> {
  return api(id ? `${ORG_CAPABILITIES_ROUTE}/${encodeURIComponent(id)}` : ORG_CAPABILITIES_ROUTE, { method: id ? "PUT" : "POST", body: JSON.stringify(input) });
}

export function removeDeclaration(id: string): Promise<unknown> {
  return api(`${ORG_CAPABILITIES_ROUTE}/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function saveMarketplace(input: MarketplaceInput, id?: string): Promise<{ value: CapabilityMarketplace; changed: boolean }> {
  return api(id ? `${ORG_CAPABILITIES_ROUTE}/marketplaces/${encodeURIComponent(id)}` : `${ORG_CAPABILITIES_ROUTE}/marketplaces`, { method: id ? "PUT" : "POST", body: JSON.stringify(input) });
}

export function removeMarketplace(id: string): Promise<unknown> {
  return api(`${ORG_CAPABILITIES_ROUTE}/marketplaces/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function setMarketplacePolicy(mode: MarketplaceMode): Promise<{ value: { mode: MarketplaceMode }; changed: boolean }> {
  return api(`${ORG_CAPABILITIES_ROUTE}/marketplace-policy`, { method: "PUT", body: JSON.stringify({ mode }) });
}

/** The one-time import of this server's historical marketplace rule into
 * Perspicax (idempotent; the server records it after the policy is set). */
export function migrateMarketplaces(): Promise<{ ok: true; done: true; imported: number }> {
  return api(`${ORG_CAPABILITIES_ROUTE}/migrate`, { method: "POST", body: "{}" });
}
