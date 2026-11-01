// Complete installation plugins, derived from the existing marketplace
// records. Only sanitized copies reach Claude or a person's environment;
// MCP declarations stay private and mount through the ordinary turn policy.
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { copySanitizedPlugin, readPluginContents } from "./bot-plugins.ts";
import type { InstalledMarketplacePlugin, PluginMarketplaces } from "./plugin-marketplaces.ts";
import type { McpServerSpec } from "./contracts.ts";
import { SANDBOX_PLUGINS_DIR } from "./sandbox-plugins.ts";
import { invalidatePluginMetaCache, pluginMetadataCacheRoot, rebuildPluginMetaCache } from "./plugin-metadata-cache.ts";

export class InstallationPlugins {
  private copies = new Map<string, { name: string; dir: string; mcpServers: Record<string, McpServerSpec>; declaredMcpServers: string[] }>();
  private dataDir: string;
  private marketplaces: PluginMarketplaces;
  constructor(dataDir: string, marketplaces: PluginMarketplaces) { this.dataDir = dataDir; this.marketplaces = marketplaces; }

  /** Called at startup and after explicit install/update, never by a receipt. */
  refresh(plugin: InstalledMarketplacePlugin): void {
    const dir = join(this.dataDir, "capability-plugins", "organization", plugin.marketplace, plugin.name);
    const result = copySanitizedPlugin(this.marketplaces.pluginDir(plugin.marketplace, plugin.name), dir, undefined, `${SANDBOX_PLUGINS_DIR}/${plugin.name}`);
    this.copies.set(plugin.key, { name: plugin.name, dir, mcpServers: result.mcpServers, declaredMcpServers: result.declaredMcpServers });
    try { rebuildPluginMetaCache(pluginMetadataCacheRoot(this.dataDir), dir); } catch { /* turn reports partial on miss */ }
  }

  restore(): void {
    for (const plugin of this.marketplaces.installed()) {
      try { this.refresh(plugin); } catch { /* a missing original is reported as absent */ }
    }
  }

  remove(key: string): void {
    const copy = this.copies.get(key);
    if (copy) {
      invalidatePluginMetaCache(pluginMetadataCacheRoot(this.dataDir), copy.dir);
      rmSync(copy.dir, { recursive: true, force: true });
    }
    this.copies.delete(key);
  }

  folder(key: string) {
    const copy = this.copies.get(key);
    return copy && existsSync(copy.dir) ? { ...copy, contents: readPluginContents(copy.dir) } : undefined;
  }

  enabledPlugins(): Array<{ name: string; dir: string }> {
    return this.marketplaces.installed().flatMap((plugin) => {
      const copy = this.folder(plugin.key);
      return copy ? [{ name: copy.name, dir: copy.dir }] : [];
    });
  }

  mcpServers() {
    return this.marketplaces.installed().flatMap((plugin) => {
      const copy = this.folder(plugin.key);
      // Servers already mapped into config keep their existing switches,
      // bot selections and OAuth. The complete copy must not bypass them.
      return copy ? Object.entries(copy.mcpServers)
        .filter(([name]) => !Object.hasOwn(plugin.serverNames ?? {}, name) && !plugin.servers.includes(name))
        .map(([name, spec]) => ({ key: plugin.key, plugin: plugin.name, name, spec, dir: copy.dir })) : [];
    });
  }
}
