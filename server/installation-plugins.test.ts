import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InstallationPlugins } from "./installation-plugins.ts";
import { PluginMarketplaces } from "./plugin-marketplaces.ts";
import { selectPluginScopes, pluginSpecOnComputer } from "./capability-plugin-mounts.ts";
import { pluginTurnFiles, pluginTurnPrompt } from "./turns/plugin-turn.ts";
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
describe("complete organization plugin copies", () => {
  it("restores all content, keeps declared MCP private and wins the same personal/bot name", () => {
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
    const record = marketplaces.recordInstall("catalog", "packing", { servers: [], skills: [] });
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
    marketplaces.recordUpdate("catalog", "packing", { servers: ["parcel-renamed"], serverNames: { parcel: "parcel-renamed" }, skills: [] });
    expect(plugins.mcpServers()).toEqual([]); // configuration owns selection and sign-in now
    plugins.remove(record.key); marketplaces.recordUninstall("catalog", "packing");
    expect(plugins.enabledPlugins()).toEqual([]); expect(plugins.mcpServers()).toEqual([]);
  });
});
