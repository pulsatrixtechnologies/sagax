import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InstallationPlugins } from "./installation-plugins.ts";
import { PluginMarketplaces } from "./plugin-marketplaces.ts";
import { selectPluginScopes, pluginSpecOnComputer } from "../capabilities/capability-plugin-mounts.ts";
import { pluginTurnFiles, pluginTurnPrompt } from "../turns/plugin-turn.ts";
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
describe("complete organization plugin copies", () => {
  it("restores all content, keeps declared MCP private and wins the same personal/bot name", async () => {
    const root = mkdtempSync(join(tmpdir(), "sagax-org-plugin-")); roots.push(root);
    const marketplaces = new PluginMarketplaces({ dataDir: root, policy: () => undefined, gitEnvironment: () => ({}) });
    const raw = marketplaces.pluginDir("catalog", "packing");
    for (const folder of [".claude-plugin", "skills/check", "commands", "agents", "bin"]) mkdirSync(join(raw, folder), { recursive: true });
    writeFileSync(join(raw, ".claude-plugin/plugin.json"), JSON.stringify({ name: "packing", hooks: { Stop: [] } }));
    writeFileSync(join(raw, "skills/check/SKILL.md"), "---\nname: check\ndescription: Check a package\n---\nCheck it.\n");
    writeFileSync(join(raw, "commands/ship.md"), "Ship the package.");
    writeFileSync(join(raw, "agents/clerk.md"), "Check the label.");
    writeFileSync(join(raw, "bin/server.js"), "process.stdin.resume();");
    writeFileSync(join(raw, ".mcp.json"), JSON.stringify({ parcel: { command: "node", args: ["${CLAUDE_PLUGIN_ROOT}/bin/server.js"], env: {} } }));
    const record = await marketplaces.recordInstall("catalog", "packing", { servers: [], skills: [] });
    const plugins = new InstallationPlugins(root, marketplaces); plugins.restore();
    const copy = plugins.folder(record.key)!;
    expect(copy.contents).toEqual({ skills: ["check"], commands: ["ship"], agents: ["clerk"] });
    expect(existsSync(join(copy.dir, ".mcp.json"))).toBe(false);
    expect(existsSync(join(copy.dir, "bin/server.js"))).toBe(true);
    const folders = selectPluginScopes({ organization: plugins.enabledPlugins(), person: [{ name: "packing", dir: "/person" }], bot: [{ name: "packing", dir: "/bot" }] });
    expect(folders).toEqual([{ name: "packing", dir: copy.dir, scope: "organization" }]);
    const server = plugins.mcpServers()[0]!;
    expect(server.name).toBe("parcel");
    expect(pluginSpecOnComputer(server.spec, copy)).toMatchObject({ command: "node", args: [join(copy.dir, "bin/server.js")] });
    for (const driverKind of ["codex", "pi", "opencodeGo"]) {
      const prompt = pluginTurnPrompt({ driverKind, files: pluginTurnFiles([copy.dir]) });
      expect(prompt).toContain("check"); expect(prompt).toContain("ship"); expect(prompt).toContain("clerk");
    }
    await marketplaces.recordUpdate("catalog", "packing", { servers: ["parcel-renamed"], serverNames: { parcel: "parcel-renamed" }, skills: [] });
    expect(plugins.mcpServers()).toEqual([]); // configuration owns selection and sign-in now
    plugins.remove(record.key); await marketplaces.recordUninstall("catalog", "packing");
    expect(plugins.enabledPlugins()).toEqual([]); expect(plugins.mcpServers()).toEqual([]);
  });

  // #3599: a start copied every installed plugin's whole tree again and
  // held the loop for over a second; a start now uses the copy it finds.
  it("keeps the existing copy at start, whatever the build, and makes it again after the start", async () => {
    const root = mkdtempSync(join(tmpdir(), "sagax-org-plugin-")); roots.push(root);
    const marketplaces = new PluginMarketplaces({ dataDir: root, policy: () => undefined, gitEnvironment: () => ({}) });
    const raw = marketplaces.pluginDir("catalog", "library");
    mkdirSync(join(raw, ".claude-plugin"), { recursive: true });
    writeFileSync(join(raw, ".claude-plugin/plugin.json"), JSON.stringify({ name: "library" }));
    writeFileSync(join(raw, ".mcp.json"), JSON.stringify({ shelf: { command: "node", args: ["${CLAUDE_PLUGIN_ROOT}/bin/shelf.js"], env: {} } }));
    // a plugin library of a realistic size: 2,000 skill files
    for (let skill = 0; skill < 400; skill++) {
      const folder = join(raw, "skills", `skill-${skill}`);
      mkdirSync(join(folder, "references"), { recursive: true });
      writeFileSync(join(folder, "SKILL.md"), `---\nname: skill-${skill}\ndescription: Skill ${skill}\n---\n${"Step.\n".repeat(200)}`);
      for (let page = 0; page < 4; page++) writeFileSync(join(folder, "references", `page-${page}.md`), "Reference.\n".repeat(300));
    }
    const record = await marketplaces.recordInstall("catalog", "library", { servers: [], skills: [] });
    const first = new InstallationPlugins(root, marketplaces, "build-1"); first.restore();
    const copy = first.folder(record.key)!;
    const servers = first.mcpServers();
    expect(servers.map((server) => server.name)).toEqual(["shelf"]);
    writeFileSync(join(copy.dir, "kept.txt"), "the copy of the last start");

    const restarted = new InstallationPlugins(root, marketplaces, "build-1"); restarted.restore();
    expect(existsSync(join(copy.dir, "kept.txt"))).toBe(true);
    expect(restarted.folder(record.key)?.contents.skills).toContain("skill-0");
    expect(restarted.mcpServers()).toEqual(servers);

    // #3599: a new server build (every roll) keeps the copy in use at
    // start, so the synchronous path copies nothing; the copy is made
    // again once the server listens (refreshStale)
    const rolled = new InstallationPlugins(root, marketplaces, "build-2"); rolled.restore();
    expect(existsSync(join(copy.dir, "kept.txt"))).toBe(true);
    expect(rolled.folder(record.key)?.dir).toBe(copy.dir);
    expect(rolled.mcpServers()).toEqual(servers);
    // the redo gives the loop back while it copies 2,000 files
    let turns = 0; let copying = true;
    const tick = () => { if (!copying) return; turns++; setImmediate(tick); };
    setImmediate(tick);
    await rolled.refreshStale(); copying = false;
    expect(turns).toBeGreaterThan(10);
    expect(existsSync(join(copy.dir, "kept.txt"))).toBe(false);
    expect(existsSync(`${copy.dir}~next`) || existsSync(`${copy.dir}~old`)).toBe(false);
    expect(rolled.folder(record.key)?.contents.skills).toContain("skill-0");
    expect(rolled.mcpServers()).toEqual(servers);
    writeFileSync(join(copy.dir, "kept.txt"), "the copy of the new build");
    const rolledAgain = new InstallationPlugins(root, marketplaces, "build-2"); rolledAgain.restore(); await rolledAgain.refreshStale();
    expect(existsSync(join(copy.dir, "kept.txt"))).toBe(true);

    // a copy an earlier release made has no stamp: kept at start, its
    // declarations read from the original, made again after the start
    rmSync(join(root, "capability-plugins", "organization-copies.json"));
    const upgraded = new InstallationPlugins(root, marketplaces, "build-2"); upgraded.restore();
    expect(existsSync(join(copy.dir, "kept.txt"))).toBe(true);
    expect(upgraded.mcpServers()).toEqual(servers);
    await upgraded.refreshStale();
    expect(existsSync(join(copy.dir, "kept.txt"))).toBe(false);
    writeFileSync(join(copy.dir, "kept.txt"), "the copy of the upgrade");

    // an update recorded while the server was stopped: the same, after the start
    await marketplaces.recordUpdate("catalog", "library", { servers: [], serverNames: {}, skills: [] });
    const updated = new InstallationPlugins(root, marketplaces, "build-2"); updated.restore();
    expect(existsSync(join(copy.dir, "kept.txt"))).toBe(true);
    await updated.refreshStale();
    expect(existsSync(join(copy.dir, "kept.txt"))).toBe(false);
    expect(updated.mcpServers().map((server) => server.name)).toEqual(["shelf"]);

    // an install or update made while a redo copies wins over the redo
    const racing = new InstallationPlugins(root, marketplaces, "build-3"); racing.restore();
    const redo = racing.refreshStale();
    racing.refresh(marketplaces.installed().find((plugin) => plugin.key === record.key)!);
    writeFileSync(join(copy.dir, "kept.txt"), "the explicit refresh");
    await redo;
    expect(readFileSync(join(copy.dir, "kept.txt"), "utf8")).toBe("the explicit refresh");
    expect(existsSync(`${copy.dir}~next`)).toBe(false);

    racing.remove(record.key); await marketplaces.recordUninstall("catalog", "library");
    expect(JSON.parse(readFileSync(join(root, "capability-plugins", "organization-copies.json"), "utf8"))).toEqual({});
  }, 60_000);
});
