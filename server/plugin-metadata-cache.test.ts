import { chmodSync, mkdirSync, mkdtempSync, renameSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  buildPluginMetaManifest,
  fingerprintFromEntries,
  invalidatePluginMetaCache,
  loadPluginMetaForTurn,
  pluginDirFingerprint,
  pluginMetadataCacheRoot,
  pluginMetaCacheExists,
  readPluginMetaCache,
  rebuildPluginMetaCache,
  scheduleMetaRebuild,
  writePluginMetaCache,
} from "./plugin-metadata-cache.ts";
import { pluginTurnInventory } from "./plugin-turn.ts";

const dirs: string[] = [];
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), "sagax-plugin-meta-"));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    try { chmodSync(dir, 0o700); } catch { /* best effort before rm */ }
    rmSync(dir, { recursive: true, force: true });
  }
});

function write(root: string, path: string, content: string) {
  mkdirSync(join(root, path, ".."), { recursive: true });
  writeFileSync(join(root, path), content);
}

describe("plugin metadata cache", () => {
  it("builds an exhaustive manifest and reuses it on the hot path without rebuilding", () => {
    const plugin = temp();
    for (let i = 0; i < 20; i++) {
      write(plugin, `skills/skill-${i}/SKILL.md`, `---\nname: skill-${i}\ndescription: Verify ${i}\n---\nBody ${i}`);
    }
    write(plugin, "commands/track.md", "Track the parcel");
    write(plugin, "agents/clerk.md", "---\nname: clerk\n---\nRead the label");
    // Directory stamps in the past, so the add below is a different mtime.
    const past = Math.trunc(Date.now() / 1000) - 120;
    for (const dir of ["", "skills", "commands", "agents"]) utimesSync(join(plugin, dir), past, past);
    const cacheRoot = pluginMetadataCacheRoot(temp());
    const first = rebuildPluginMetaCache(cacheRoot, plugin);
    expect(first.files).toHaveLength(22);
    expect(first.stamps["skills/"]).toBe(past * 1000);
    expect(first.dirs.some((dir) => dir.startsWith("skills/"))).toBe(true);
    expect(first.incomplete).toBe(false);
    expect(first.unreadable).toBe(0);
    expect(readPluginMetaCache(cacheRoot, plugin)?.fingerprint).toBe(pluginDirFingerprint(plugin));
    const hot = loadPluginMetaForTurn(cacheRoot, plugin);
    expect(hot.manifest?.builtAt).toBe(first.builtAt);
    expect(hot.cacheError).toBeUndefined();
    // A disk add outside install/update changes its directory's mtime: the
    // cache misses (the turn uses the bounded scan) instead of hiding it.
    write(plugin, "skills/skill-extra/SKILL.md", "---\nname: skill-extra\ndescription: Extra\n---\nMore");
    expect(loadPluginMetaForTurn(cacheRoot, plugin).manifest).toBeNull();
    const rebuilt = rebuildPluginMetaCache(cacheRoot, plugin);
    expect(rebuilt.files).toHaveLength(23);
    expect(rebuilt.builtAt).toBeGreaterThan(first.builtAt);
  });

  it("changes fingerprint when a skill moves path, even if basename and empty dirs remain", () => {
    const plugin = temp();
    write(plugin, "skills/a/b/SKILL.md", "---\nname: moved\ndescription: Move me\n---\nBody");
    const before = buildPluginMetaManifest(plugin);
    expect(before.files[0]?.rel).toBe("skills/a/b/SKILL.md");
    mkdirSync(join(plugin, "skills/b"), { recursive: true });
    renameSync(join(plugin, "skills/a/b/SKILL.md"), join(plugin, "skills/b/SKILL.md"));
    // Leave empty skills/a/b behind; basename DFS without path would collide.
    const after = buildPluginMetaManifest(plugin);
    expect(after.files[0]?.rel).toBe("skills/b/SKILL.md");
    expect(after.fingerprint).not.toBe(before.fingerprint);
    expect(fingerprintFromEntries(before.files, before.dirs)).not.toBe(fingerprintFromEntries(after.files, after.dirs));
  });

  it("invalidates on delete, rename, tamper and mtime change of a cached file", () => {
    const plugin = temp();
    write(plugin, "skills/ship/SKILL.md", "---\nname: ship\ndescription: Ship\n---\nOne");
    write(plugin, "commands/track.md", "Track");
    const cacheRoot = pluginMetadataCacheRoot(temp());
    rebuildPluginMetaCache(cacheRoot, plugin);
    expect(loadPluginMetaForTurn(cacheRoot, plugin).manifest?.files).toHaveLength(2);

    writeFileSync(join(plugin, "skills/ship/SKILL.md"), "---\nname: ship\ndescription: Ship\n---\nTampered");
    expect(readPluginMetaCache(cacheRoot, plugin)).toBeNull();

    rebuildPluginMetaCache(cacheRoot, plugin);
    renameSync(join(plugin, "commands/track.md"), join(plugin, "commands/trace.md"));
    expect(readPluginMetaCache(cacheRoot, plugin)).toBeNull();

    rebuildPluginMetaCache(cacheRoot, plugin);
    rmSync(join(plugin, "skills/ship/SKILL.md"));
    expect(readPluginMetaCache(cacheRoot, plugin)).toBeNull();

    write(plugin, "skills/ship/SKILL.md", "---\nname: ship\ndescription: Ship\n---\nRestored");
    rebuildPluginMetaCache(cacheRoot, plugin);
    const cached = readPluginMetaCache(cacheRoot, plugin)!;
    const path = join(plugin, "skills/ship/SKILL.md");
    const future = Math.trunc(Date.now() / 1000) + 120;
    utimesSync(path, future, future);
    expect(readPluginMetaCache(cacheRoot, plugin)).toBeNull();
    expect(cached.fingerprint).toBe(fingerprintFromEntries(cached.files, cached.dirs, cached.stamps));
  });

  it("lists unreadable oversized references honestly and invalidates on remove", () => {
    const plugin = temp();
    write(plugin, "skills/ok/SKILL.md", "---\nname: ok\ndescription: Fine\n---\nBody");
    write(plugin, "skills/huge/SKILL.md", "x".repeat(256 * 1024 + 1));
    const manifest = buildPluginMetaManifest(plugin);
    expect(manifest.files).toHaveLength(2);
    expect(manifest.files.find((file) => file.name === "huge")).toMatchObject({ unreadable: true });
    expect(manifest.unreadable).toBe(1);
    const cacheRoot = pluginMetadataCacheRoot(temp());
    writePluginMetaCache(cacheRoot, plugin, manifest);
    invalidatePluginMetaCache(cacheRoot, plugin);
    expect(readPluginMetaCache(cacheRoot, plugin)).toBeNull();
    expect(pluginMetaCacheExists(cacheRoot, plugin)).toBe(false);
  });

  it("never rebuilds inside the turn on a miss: bounded live scan now, one queued rebuild after", async () => {
    const plugin = temp();
    write(plugin, "skills/only/SKILL.md", "---\nname: only\ndescription: Only\n---\nBody");
    const cacheRoot = pluginMetadataCacheRoot(temp());
    expect(loadPluginMetaForTurn(cacheRoot, plugin).manifest).toBeNull();
    const miss = pluginTurnInventory([plugin], { pathForDir: () => "plugins/packing", cacheRoot });
    expect(miss.files.some((file) => file.name === "only")).toBe(true);
    // The live scan finished inside its budgets: complete, not "partial".
    expect(miss.truncated).toBe(false);
    // Synchronously, the turn wrote nothing.
    expect(pluginMetaCacheExists(cacheRoot, plugin)).toBe(false);
    await delay(20);
    expect(pluginMetaCacheExists(cacheRoot, plugin)).toBe(true);
    expect(loadPluginMetaForTurn(cacheRoot, plugin).manifest?.files.map((file) => file.name)).toEqual(["only"]);
    rebuildPluginMetaCache(cacheRoot, plugin);
    const hit = pluginTurnInventory([plugin], { pathForDir: () => "plugins/packing", cacheRoot });
    expect(hit.truncated).toBe(false);
    expect(hit.files).toHaveLength(1);
  });

  it("write failures leave an in-memory result and do not throw", () => {
    const plugin = temp();
    write(plugin, "skills/ok/SKILL.md", "---\nname: ok\ndescription: Fine\n---\nBody");
    const blocked = temp();
    writeFileSync(join(blocked, "plugin-metadata"), "not-a-directory");
    const cacheRoot = join(blocked, "plugin-metadata");
    expect(() => rebuildPluginMetaCache(cacheRoot, plugin)).not.toThrow();
    expect(loadPluginMetaForTurn(cacheRoot, plugin).manifest).toBeNull();
  });

  it("heals a cache made stale by an in-place write (plugin configuration) after the turn, once per cooldown", async () => {
    const plugin = temp();
    write(plugin, "skills/ship/SKILL.md", "---\nname: ship\ndescription: Ship to {{region}}\n---\nOne");
    const cacheRoot = pluginMetadataCacheRoot(temp());
    rebuildPluginMetaCache(cacheRoot, plugin);
    writeFileSync(join(plugin, "skills/ship/SKILL.md"), "---\nname: ship\ndescription: Ship to the synthetic region\n---\nOne, configured");
    const future = Math.trunc(Date.now() / 1000) + 60;
    utimesSync(join(plugin, "skills/ship/SKILL.md"), future, future);
    const stale = pluginTurnInventory([plugin], { pathForDir: () => "plugins/packing", cacheRoot });
    expect(stale.files[0]?.description).toBe("Ship to the synthetic region");
    expect(stale.truncated).toBe(false);
    await delay(20);
    const healed = loadPluginMetaForTurn(cacheRoot, plugin).manifest;
    expect(healed?.files[0]?.description).toBe("Ship to the synthetic region");
    // Within the cooldown a second miss does not queue another rebuild.
    expect(scheduleMetaRebuild(cacheRoot, plugin)).toBe(false);
    expect(scheduleMetaRebuild(cacheRoot, plugin, Date.now() + 31_000)).toBe(true);
    await delay(20);
  });

  it("verifies a large cached plugin with stats only, without reparsing its manifest", () => {
    const plugin = temp();
    for (let i = 0; i < 2000; i++) write(plugin, `skills/s-${i}/SKILL.md`, `---\nname: s-${i}\ndescription: Verify\n---\nCheck.`);
    const cacheRoot = pluginMetadataCacheRoot(temp());
    rebuildPluginMetaCache(cacheRoot, plugin);
    const first = loadPluginMetaForTurn(cacheRoot, plugin).manifest;
    expect(first?.files).toHaveLength(2000);
    const started = performance.now();
    for (let i = 0; i < 10; i++) expect(loadPluginMetaForTurn(cacheRoot, plugin).manifest).toBe(first);
    // Same object: memoized parse; ten verifications of 2000 files stay small.
    expect((performance.now() - started) / 10).toBeLessThan(250);
  });

  it("lets skills_list inventory exceed the live scan bound through the cache", () => {
    const plugin = temp();
    for (let i = 0; i < 600; i++) {
      write(plugin, `skills/skill-${i}/SKILL.md`, `---\nname: skill-${i}\ndescription: Verify\n---\nCheck.`);
    }
    write(plugin, "commands/track.md", "Track");
    const cacheRoot = pluginMetadataCacheRoot(temp());
    rebuildPluginMetaCache(cacheRoot, plugin);
    const live = pluginTurnInventory([plugin], { pathForDir: () => "plugins/packing" });
    expect(live.files.length).toBe(512);
    expect(live.truncated).toBe(true);
    const cached = pluginTurnInventory([plugin], { pathForDir: () => "plugins/packing", cacheRoot });
    expect(cached.files.length).toBe(601);
    expect(cached.truncated).toBe(false);
    expect(cached.files.some((file) => file.kind === "command" && file.path.endsWith("commands/track.md"))).toBe(true);
    expect(cached.files.every((file) => file.path.startsWith("plugins/packing/"))).toBe(true);
  });
});
