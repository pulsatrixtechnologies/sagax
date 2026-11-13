// Complete installation plugins, derived from the existing marketplace
// records. Only sanitized copies reach Claude or a person's environment;
// MCP declarations stay private and mount through the ordinary turn policy.
import { existsSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { writeFileAtomic } from "../atomic.ts";
import { buildStamp } from "../environment.ts";
import { copySanitizedPlugin, copySanitizedPluginAsync, pluginMcpDeclarations, readPluginContents } from "../bots/bot-plugins.ts";
import type { InstalledMarketplacePlugin, PluginMarketplaces } from "./plugin-marketplaces.ts";
import type { McpServerSpec } from "../contracts.ts";
import { SANDBOX_PLUGINS_DIR } from "../sandbox/sandbox-plugins.ts";
import { notePluginFolderChanged } from "../sandbox/sandbox-plugin-digests.ts";
import { invalidatePluginMetaCache, pluginMetaCacheExists, pluginMetadataCacheRoot, rebuildPluginMetaCache, scheduleMetaRebuild } from "./plugin-metadata-cache.ts";

type Copy = { name: string; dir: string; mcpServers: Record<string, McpServerSpec>; declaredMcpServers: string[] };
/** What a copy was made from (installed record and original folder), by
 * which server build, and what the copy declared. */
type CopyStamp = { source: string; build?: string; mcpServers: Record<string, McpServerSpec>; declaredMcpServers: string[] };

export class InstallationPlugins {
  private copies = new Map<string, Copy>();
  private dataDir: string;
  private marketplaces: PluginMarketplaces;
  /** This server's build: what a copy holds is decided by its code
   * (copySanitizedPlugin's sanitizing and paths, the mount folder), so a
   * copy made by another build is made again, after the start. */
  private build: string;
  /** Copies kept at start that a new build or a changed plugin makes
   * again once the server listens (refreshStale). */
  private stale = new Set<string>();
  constructor(dataDir: string, marketplaces: PluginMarketplaces, build: string = buildStamp()) { this.dataDir = dataDir; this.marketplaces = marketplaces; this.build = build; }

  /** Called after explicit install/update, never by a receipt. */
  refresh(plugin: InstalledMarketplacePlugin): void {
    const stamps = this.readStamps();
    try {
      this.copy(plugin, stamps);
    } finally {
      this.writeStamps(stamps);
    }
  }

  /** At start (#3599): an existing copy is used as it is, whatever build
   * made it; a copy made by another build, or from an older record of the
   * plugin, is made again after the server listens (refreshStale), off the
   * start path. Only a plugin with no copy at all is copied here, before
   * the first turn that needs it. Copying every plugin's whole tree again
   * held the server's loop for over a second at every start and roll. */
  restore(): void {
    const stamps = this.readStamps();
    let changed = false;
    const installed = this.marketplaces.installed();
    const cacheRoot = pluginMetadataCacheRoot(this.dataDir);
    for (const plugin of installed) {
      try {
        const dir = this.dirFor(plugin);
        if (existsSync(dir)) {
          const stamp = stamps[plugin.key];
          const original = this.marketplaces.pluginDir(plugin.marketplace, plugin.name);
          // a copy an earlier release made has no stamp: what it declares
          // is read from the original's declarations, without copying
          const kept = stamp ?? pluginMcpDeclarations(original, this.executionRoot(plugin));
          this.copies.set(plugin.key, { name: plugin.name, dir, mcpServers: kept.mcpServers, declaredMcpServers: kept.declaredMcpServers });
          if (!stamp || stamp.build !== this.build || stamp.source !== this.sourceOf(plugin, original)) this.stale.add(plugin.key);
          // a cache lost meanwhile is rebuilt after the start, never on its path
          else if (!pluginMetaCacheExists(cacheRoot, dir)) scheduleMetaRebuild(cacheRoot, dir);
          continue;
        }
        changed = true;
        this.copy(plugin, stamps);
      } catch { /* a missing original is reported as absent */ }
    }
    const keys = new Set(installed.map((plugin) => plugin.key));
    for (const key of Object.keys(stamps)) if (!keys.has(key)) { delete stamps[key]; changed = true; }
    if (changed) this.writeStamps(stamps);
  }

  /** Once the server listens: makes again, one plugin after the other, the
   * copies restore() kept from another build or an older record. The tree
   * is copied asynchronously next to the copy in use, which stays mounted
   * until the new one takes its place in one rename. */
  async refreshStale(): Promise<void> {
    for (const key of this.stale) {
      this.stale.delete(key);
      const plugin = this.marketplaces.installed().find((entry) => entry.key === key);
      const current = this.copies.get(key);
      if (!plugin || !current) continue;
      const dir = this.dirFor(plugin);
      // "~" is outside plugin names: never another plugin's folder
      const staging = `${dir}~next`;
      try {
        const original = this.marketplaces.pluginDir(plugin.marketplace, plugin.name);
        const result = await copySanitizedPluginAsync(original, staging, undefined, this.executionRoot(plugin));
        const old = `${dir}~old`;
        await rm(old, { recursive: true, force: true });
        // installed again, updated or removed meanwhile: that copy stands
        if (this.copies.get(key) !== current) {
          await rm(staging, { recursive: true, force: true });
          continue;
        }
        if (existsSync(dir)) renameSync(dir, old);
        renameSync(staging, dir);
        notePluginFolderChanged(dir);
        this.copies.set(key, { name: plugin.name, dir, mcpServers: result.mcpServers, declaredMcpServers: result.declaredMcpServers });
        const stamps = this.readStamps();
        stamps[key] = { source: this.sourceOf(plugin, original), build: this.build, mcpServers: result.mcpServers, declaredMcpServers: result.declaredMcpServers };
        this.writeStamps(stamps);
        const cacheRoot = pluginMetadataCacheRoot(this.dataDir);
        invalidatePluginMetaCache(cacheRoot, dir);
        if (!scheduleMetaRebuild(cacheRoot, dir)) setTimeout(() => { try { rebuildPluginMetaCache(cacheRoot, dir); } catch { /* turn reports partial on miss */ } }, 0).unref?.();
        await rm(old, { recursive: true, force: true });
      } catch {
        // the copy in use stays; the next start tries again
        await rm(staging, { recursive: true, force: true }).catch(() => undefined);
      }
    }
  }

  private dirFor(plugin: InstalledMarketplacePlugin): string {
    return join(this.dataDir, "capability-plugins", "organization", plugin.marketplace, plugin.name);
  }

  private executionRoot(plugin: InstalledMarketplacePlugin): string {
    return `${SANDBOX_PLUGINS_DIR}/${plugin.name}`;
  }

  private copy(plugin: InstalledMarketplacePlugin, stamps: Record<string, CopyStamp>): void {
    const dir = this.dirFor(plugin);
    delete stamps[plugin.key];
    this.stale.delete(plugin.key);
    const original = this.marketplaces.pluginDir(plugin.marketplace, plugin.name);
    const result = copySanitizedPlugin(original, dir, undefined, this.executionRoot(plugin));
    this.copies.set(plugin.key, { name: plugin.name, dir, mcpServers: result.mcpServers, declaredMcpServers: result.declaredMcpServers });
    stamps[plugin.key] = { source: this.sourceOf(plugin, original), build: this.build, mcpServers: result.mcpServers, declaredMcpServers: result.declaredMcpServers };
    try { rebuildPluginMetaCache(pluginMetadataCacheRoot(this.dataDir), dir); } catch { /* turn reports partial on miss */ }
  }

  /** The mount folder, the installed record and the original folder's own
   * change time: an install or an update each make the copy again. */
  private sourceOf(plugin: InstalledMarketplacePlugin, original: string): string {
    return JSON.stringify([SANDBOX_PLUGINS_DIR, plugin.version ?? null, plugin.revision ?? null, plugin.installedAt, plugin.updatedAt ?? null, statSync(original).mtimeMs]);
  }

  private stampsPath(): string {
    return join(this.dataDir, "capability-plugins", "organization-copies.json");
  }

  private readStamps(): Record<string, CopyStamp> {
    try {
      const value = JSON.parse(readFileSync(this.stampsPath(), "utf8")) as unknown;
      return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, CopyStamp> : {};
    } catch {
      return {};
    }
  }

  private writeStamps(stamps: Record<string, CopyStamp>): void {
    try { writeFileAtomic(this.stampsPath(), `${JSON.stringify(stamps)}\n`, { mode: 0o600 }); } catch { /* the next start copies again */ }
  }

  remove(key: string): void {
    this.stale.delete(key);
    const copy = this.copies.get(key);
    if (copy) {
      invalidatePluginMetaCache(pluginMetadataCacheRoot(this.dataDir), copy.dir);
      rmSync(copy.dir, { recursive: true, force: true });
      notePluginFolderChanged(copy.dir);
    }
    this.copies.delete(key);
    const stamps = this.readStamps();
    if (key in stamps) {
      delete stamps[key];
      this.writeStamps(stamps);
    }
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
