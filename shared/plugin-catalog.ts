// The curated Plugins list (iOS parity 15, and the desktop's Plugins tab;
// docs/superpowers/specs/2026-09-30-mcp-sign-in-and-plugin-catalog-design.md
// Part B). Every entry is a real remote MCP server at its provider's own
// official address. `icon` is a key: clients draw a bundled icon for it, or
// the provider's monogram; nothing is hot-linked.
import { z } from "zod";

import catalog from "./plugin-catalog.json" with { type: "json" };

export const PLUGIN_AUTH = ["oauth", "api-key", "none"] as const;

/** A provider that serves each region at its own address (2026-10-21, parity
 * with "Choose your data center"): the person picks one before connecting.
 * `url` above stays the default region's address. */
export const pluginRegionSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,32}$/),
  label: z.string().min(1).max(40),
  url: z.string().url().refine((value) => value.startsWith("https://"), { error: "url must be https" }),
}).strict();
export type PluginRegion = z.infer<typeof pluginRegionSchema>;

export const pluginCatalogEntrySchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/),
  name: z.string().min(1).max(60),
  description: z.string().min(1).max(200),
  url: z.string().url().refine((value) => value.startsWith("https://"), { error: "url must be https" }),
  transport: z.enum(["http", "sse"]),
  auth: z.enum(PLUGIN_AUTH),
  icon: z.string().regex(/^[a-z0-9-]{1,40}$/),
  domain: z.string().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/),
  /** The Connect apps chip it sits under (src/lib/plugins-model.ts). */
  category: z.enum(["passwords", "productivity", "communication", "design", "code", "data", "sales", "finance", "marketing", "research", "support"]).optional(),
  docsUrl: z.string().url().refine((value) => value.startsWith("https://"), { error: "docsUrl must be https" }),
  /** For a server without dynamic client registration. */
  clientId: z.string().min(1).max(512).optional(),
  /** For auth "api-key": the header the key goes in. */
  apiKeyHeader: z.string().regex(/^[A-Za-z0-9-]{1,64}$/).optional(),
  /** Regional addresses, the default (`url`) among them. */
  regions: z.array(pluginRegionSchema).min(2).max(8).optional(),
}).strict();

export type PluginCatalogEntry = z.infer<typeof pluginCatalogEntrySchema>;

export const pluginCatalogSchema = z.object({
  version: z.literal(1),
  plugins: z.array(pluginCatalogEntrySchema).max(200),
}).strict().superRefine((value, ctx) => {
  const ids = new Set<string>();
  const urls = new Set<string>();
  for (const [index, plugin] of value.plugins.entries()) {
    if (ids.has(plugin.id)) ctx.addIssue({ code: "custom", path: ["plugins", index, "id"], message: `duplicate id ${plugin.id}` });
    if (urls.has(plugin.url)) ctx.addIssue({ code: "custom", path: ["plugins", index, "url"], message: `duplicate url ${plugin.url}` });
    if (plugin.auth === "api-key" && !plugin.apiKeyHeader) ctx.addIssue({ code: "custom", path: ["plugins", index], message: "api-key needs apiKeyHeader" });
    if (plugin.regions && !plugin.regions.some((region) => region.url === plugin.url)) ctx.addIssue({ code: "custom", path: ["plugins", index, "regions"], message: "regions must include the default url" });
    if (plugin.regions && new Set(plugin.regions.map((region) => region.id)).size !== plugin.regions.length) ctx.addIssue({ code: "custom", path: ["plugins", index, "regions"], message: "duplicate region id" });
    ids.add(plugin.id);
    urls.add(plugin.url);
  }
});

/** The featured list, validated once. */
export const PLUGIN_CATALOG: readonly PluginCatalogEntry[] = Object.freeze(pluginCatalogSchema.parse(catalog).plugins);
