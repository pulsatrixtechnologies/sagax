// #2759: the Cursor catalog is offered and a Cursor plugin converts to the
// Claude Code layout Sagax installs (skills, rules, agents, MCP, variables),
// with what did not convert listed for its page.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { OFFICIAL_CATALOGS, officialCatalogFor } from "../../shared/skill-catalogs.ts";
import { hasCursorMarketplace, ruleToSkill, synthesizeCursorCatalog } from "./cursor-catalog.ts";
import { readMarketplaceManifest, readPluginContents } from "./plugin-sources.ts";
import { readPluginMcpServers } from "./plugin-mcp.ts";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function write(root: string, path: string, text: string) {
  mkdirSync(join(root, path, ".."), { recursive: true });
  writeFileSync(join(root, path), text);
}

/** A small cursor/plugins: a kit (skills, rules, agents, hooks) and an MCP integration. */
function sampleRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "cursor-cat-"));
  dirs.push(root);
  write(root, ".cursor-plugin/marketplace.json", JSON.stringify({
    name: "cursor-plugins",
    plugins: [
      { name: "team-kit", source: "team-kit", description: "Team workflows" },
      { name: "issues", source: "third_party/issues", description: "Issue tracker MCP" },
      { name: "escape", source: "../outside" },
    ],
  }));
  // a Claude manifest the repository also ships: the Cursor one wins
  write(root, ".claude-plugin/marketplace.json", JSON.stringify({ name: "other", plugins: [{ name: "x", source: "./x" }] }));
  write(root, "team-kit/.cursor-plugin/plugin.json", JSON.stringify({
    name: "team-kit", version: "1.2.0", license: "MIT", logo: "assets/logo.svg", category: "developer-tools",
    skills: "./skills/", rules: "./rules/", agents: "./agents/", hooks: "./hooks/hooks.json",
  }));
  write(root, "team-kit/skills/ship-it/SKILL.md", "---\nname: ship-it\ndescription: Ship a branch\n---\n\n# Ship\n");
  write(root, "team-kit/rules/no-inline-imports.mdc", "---\ndescription: Keep imports at top of file\nalwaysApply: true\n---\n\n# No inline imports\n\nAlways place imports at the top.\n");
  write(root, "team-kit/rules/react-hooks.mdc", "---\ndescription: React hook rules\nglobs: src/**/*.tsx\n---\n\nCall hooks at the top level.\n");
  write(root, "team-kit/agents/ci-watcher.md", "---\nname: ci-watcher\ndescription: Watch CI\nmodel: fast\nis_background: true\n---\n\n# CI watcher\n");
  write(root, "team-kit/hooks/hooks.json", JSON.stringify({ version: 1, hooks: { stop: [{ command: "bash x.sh" }] } }));
  write(root, "third_party/issues/.cursor-plugin/plugin.json", JSON.stringify({
    name: "issues", displayName: "Issues", version: "0.1.0", homepage: "https://issues.example.com", category: "integrations",
    mcpServers: "./mcp.json",
    variables: { type: "object", properties: { ISSUES_API_TOKEN: { type: "string", title: "API token" }, ISSUES_REGION: { type: "string", title: "Region", default: "us" } }, required: ["ISSUES_API_TOKEN"] },
  }));
  write(root, "third_party/issues/mcp.json", JSON.stringify({
    mcpServers: { issues: { type: "http", url: "https://mcp.issues.example.com/mcp", headers: { Authorization: "Bearer ${ISSUES_API_TOKEN}" } } },
  }));
  return root;
}

describe("Cursor plugin catalog (#2759)", () => {
  it("is listed among the official catalogs, by its GitHub source", () => {
    const cursor = OFFICIAL_CATALOGS.find((catalog) => catalog.id === "cursor-plugins");
    expect(cursor).toMatchObject({ source: "cursor/plugins", format: "cursor" });
    expect(cursor?.skillDirs).toBeUndefined();
    expect(officialCatalogFor("https://github.com/cursor/plugins.git")?.id).toBe("cursor-plugins");
  });

  it("converts a Cursor marketplace into one Sagax can install", () => {
    const root = sampleRepo();
    expect(hasCursorMarketplace(root)).toBe(true);
    expect(synthesizeCursorCatalog(root, { name: "cursor-plugins", rawBase: "https://raw.githubusercontent.com/cursor/plugins/HEAD" })).toBe(2);

    const manifest = readMarketplaceManifest(root);
    expect(manifest.name).toBe("cursor-plugins");
    expect(manifest.plugins.map((plugin) => plugin.name)).toEqual(["team-kit", "issues"]);
    const [kit, issues] = manifest.plugins;
    expect(kit).toMatchObject({
      version: "1.2.0", category: "developer-tools", convertedFrom: "cursor",
      icon: "https://raw.githubusercontent.com/cursor/plugins/HEAD/team-kit/assets/logo.svg",
      source: { kind: "path", path: "./sagax-cursor/team-kit" },
    });
    expect(kit.notConverted).toEqual(expect.arrayContaining(["rules_scope", "agent_settings:is_background, model", "hooks"]));
    expect(issues).toMatchObject({ homepage: "https://issues.example.com/", notConverted: ["mcp_values:ISSUES_API_TOKEN"] });

    // skills, rules (as skills) and agents land where the installer reads them
    const kitDir = join(root, "sagax-cursor", "team-kit");
    expect(readPluginContents(kitDir)).toEqual({
      agents: ["ci-watcher"], commands: [],
      skills: ["rule-no-inline-imports", "rule-react-hooks", "ship-it"],
    });
    const rule = readFileSync(join(kitDir, "skills", "rule-react-hooks", "SKILL.md"), "utf8");
    expect(rule).toContain("name: rule-react-hooks");
    expect(rule).toContain("src/**/*.tsx");
    expect(rule).toContain("Call hooks at the top level.");
    const agent = readFileSync(join(kitDir, "agents", "ci-watcher.md"), "utf8");
    expect(agent).toContain("name: ci-watcher");
    expect(agent).not.toContain("model: fast");
    expect(existsSync(join(kitDir, "hooks"))).toBe(false);

    // MCP servers and variables
    const issuesDir = join(root, "sagax-cursor", "issues");
    const mcp = readPluginMcpServers(issuesDir, issuesDir);
    expect(mcp.servers.map((server) => server.name)).toEqual(["issues"]);
    expect(mcp.skipped).toEqual([]);
    const plugin = JSON.parse(readFileSync(join(issuesDir, ".claude-plugin", "plugin.json"), "utf8"));
    expect(plugin.userConfig.ISSUES_API_TOKEN).toMatchObject({ type: "string", sensitive: true, required: true });
    expect(plugin.userConfig.ISSUES_REGION).toMatchObject({ default: "us" });
    expect(plugin.userConfig.ISSUES_REGION.sensitive).toBeUndefined();
  });

  it("reads an always-on rule as a skill that says so", () => {
    const root = sampleRepo();
    const skill = ruleToSkill(join(root, "team-kit", "rules", "no-inline-imports.mdc"), "team-kit");
    expect(skill).toMatchObject({ name: "rule-no-inline-imports", scoped: false });
    expect(skill?.text).toContain("Apply it always");
  });
});
