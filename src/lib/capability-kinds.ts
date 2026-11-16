// Connect Apps' three kinds (#4453): Skills, Connectors, Plugins. Every row
// the window shows lands in exactly one kind, read from a field the server
// already sends (a resolved capability's `form`, a catalog row's `kind`).
// Pure functions only, shared by the window and its tests.
import type { CapabilityForm } from "../../shared/capabilities";
import type { PluginKind } from "./plugins-model";

export type ConnectAppsKind = "skills" | "connectors" | "plugins";

/** The tabs, in the reference's order. */
export const CONNECT_APPS_KINDS: readonly ConnectAppsKind[] = ["skills", "connectors", "plugins"];

const FORM_KIND: Record<CapabilityForm, ConnectAppsKind> = {
  plugin: "plugins",
  flow: "plugins",
  skill: "skills",
  mcp: "connectors",
  connector: "connectors",
  product: "connectors",
  // a gateway role rides on the gateway's connection (#4453 lot 4 makes it
  // a section of that connection's page)
  role: "connectors",
};

const ITEM_KIND: Record<PluginKind, ConnectAppsKind> = {
  plugin: "plugins",
  skill: "skills",
  app: "connectors",
  featured: "connectors",
  mcp: "connectors",
};

/** The kind of a row: a resolved capability by its form, a catalog or
 * installed row by its kind. */
export function kindOf(row: { form: CapabilityForm } | { kind: PluginKind }): ConnectAppsKind {
  return "form" in row ? FORM_KIND[row.form] : ITEM_KIND[row.kind];
}

/** The rows of one kind, in their order. */
export function ofKind<T>(rows: readonly T[], kind: ConnectAppsKind, kindOfRow: (row: T) => ConnectAppsKind): T[] {
  return rows.filter((row) => kindOfRow(row) === kind);
}

/** How many rows of each kind. */
export function kindCounts<T>(rows: readonly T[], kindOfRow: (row: T) => ConnectAppsKind): Record<ConnectAppsKind, number> {
  const counts: Record<ConnectAppsKind, number> = { skills: 0, connectors: 0, plugins: 0 };
  for (const row of rows) counts[kindOfRow(row)] += 1;
  return counts;
}

/** A link's or a remembered value's kind; anything else is not one. */
export function normalizeKind(value: string | null | undefined): ConnectAppsKind | null {
  return value === "skills" || value === "connectors" || value === "plugins" ? value : null;
}

/** The organization's declaration forms a kind lists (plugin, skill, mcp). */
export function declarationForms(kind: ConnectAppsKind): ReadonlyArray<"plugin" | "skill" | "mcp"> {
  return kind === "skills" ? ["skill"] : kind === "plugins" ? ["plugin"] : ["mcp"];
}

/** Rows past this count in the "From your organization" group fold behind
 * "Show all N" (the gateway's products can be many). */
export const ORGANIZATION_PREVIEW = 6;

/** The kind of an installed entry (installed-model): the row that stands for
 * it, its primary (a plugin with its server stays one Plugins row). */
export function entryKind(entry: { primary: { kind: PluginKind } }): ConnectAppsKind {
  return ITEM_KIND[entry.primary.kind];
}

/** A resolved row the organization's gateway or the organization itself
 * puts on the bot: the group "From your organization" of Connectors. */
export function fromOrganization(item: { scope: string; source: { kind: string } }): boolean {
  return item.source.kind === "perspicax" || item.scope === "organization";
}

/** Where an item is on, for the label at a row's right (#4453, decided
 * 2026-11-16): the person's bots it reaches. `total` is how many of their
 * bots could have it; none (0 of 0) reads as "No bot". */
export type WhereLabel = { kind: "all" } | { kind: "none" } | { kind: "some"; count: number };
export function whereLabel(on: number, total: number): WhereLabel {
  if (on <= 0 || total <= 0) return { kind: "none" };
  return on >= total ? { kind: "all" } : { kind: "some", count: on };
}

/** One vendor row of the organization section: every product of a vendor
 * under one name. A product with no vendor is a vendor of one. */
export interface ProductVendor<P> {
  key: string;
  name: string;
  products: P[];
}

/** Groups products by the vendor the console names (`group`), in the order
 * the first product of each vendor appears. A product with no vendor stands
 * alone, so nothing is guessed from a name. */
export function groupByVendor<P extends { id: string; name: string; group?: { id: string; name: string } }>(products: readonly P[]): Array<ProductVendor<P>> {
  const vendors: Array<ProductVendor<P>> = [];
  const byKey = new Map<string, ProductVendor<P>>();
  for (const product of products) {
    const key = product.group ? `vendor:${product.group.id}` : `product:${product.id}`;
    let vendor = byKey.get(key);
    if (!vendor) {
      vendor = { key, name: product.group?.name ?? product.name, products: [] };
      byKey.set(key, vendor);
      vendors.push(vendor);
    }
    vendor.products.push(product);
  }
  return vendors;
}
