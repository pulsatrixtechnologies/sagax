import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { BotPluginError, type GitRunner } from "./bot-plugins.ts";
import { botPluginsWithMarketplaces } from "./testing/plugin-stores.ts";
import { claudePluginDirs, pluginTurnFiles, pluginTurnInventory, pluginTurnPrompt } from "./plugin-turn.ts";

const dirs: string[] = [];
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), "sagax-plugin-turn-"));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function write(root: string, path: string, content: string) {
  mkdirSync(join(root, path, ".."), { recursive: true });
  writeFileSync(join(root, path), content);
}

function marketplaceRepo(): string {
  const repo = temp();
  write(repo, ".claude-plugin/marketplace.json", JSON.stringify({
    name: "acme-tools",
    plugins: [{ name: "reviewer", source: "./plugins/reviewer", description: "Reviews code" }],
  }));
  write(repo, "plugins/reviewer/.claude-plugin/plugin.json", JSON.stringify({ name: "reviewer" }));
  write(repo, "plugins/reviewer/skills/review/SKILL.md", "---\nname: review\ndescription: Review\n---\nBody");
  write(repo, "plugins/reviewer/commands/review.md", "Review the diff");
  return repo;
}

function fakeGit(repos: Record<string, string>): GitRunner {
  return async (args) => {
    const url = args[args.indexOf("--") + 1]!;
    const into = args[args.indexOf("--") + 2]!;
    const from = repos[url];
    if (!from) throw new BotPluginError("The repository could not be fetched.", "repository_unreadable", 422);
    cpSync(from, into, { recursive: true });
  };
}

describe("plugin skills and commands on a turn", () => {
  it("gives a non-Claude engine the enabled paths, and Claude the folders", async () => {
    const plugins = botPluginsWithMarketplaces({
      dataDir: temp(), git: fakeGit({ "https://github.com/acme/tools.git": marketplaceRepo() }), gitEnvironment: () => ({}), policy: () => undefined,
    });
    await plugins.addMarketplace("bot-1", { source: "acme/tools" }, undefined);
    await plugins.install("bot-1", { marketplace: "acme-tools", plugin: "reviewer" }, undefined);
    const enabled = plugins.pluginDirs("bot-1");
    const skill = join(enabled[0]!, "skills/review/SKILL.md");
    const command = join(enabled[0]!, "commands/review.md");
    write(enabled[0]!, "skills/review/.env", "TOKEN=secret");
    write(enabled[0]!, "commands/secret.key", "key");
    write(enabled[0]!, "commands/README.md", "not a command");
    symlinkSync("/etc/passwd", join(enabled[0]!, "skills/review/outside"));
    const files = pluginTurnFiles(enabled);
    expect(files.map((file) => file.path).sort()).toEqual([command, skill].sort());
    const grok = pluginTurnPrompt({ driverKind: "grokAgent", files });
    expect(grok).toContain(JSON.stringify(skill));
    expect(grok).toContain(JSON.stringify(command));
    expect(grok).toContain("Sagax");
    expect(grok).not.toContain("Body");
    expect(claudePluginDirs("grokAgent", enabled)).toEqual([]);
    expect(pluginTurnPrompt({ driverKind: "claudeAgent", files })).toBe("");
    expect(claudePluginDirs("claudeAgent", enabled)).toEqual(enabled);
    expect(claudePluginDirs("pi", enabled)).toEqual([]);
    plugins.setEnabled("bot-1", "reviewer@acme-tools", false);
    expect(plugins.pluginDirs("bot-1")).toEqual([]);
    expect(pluginTurnPrompt({ driverKind: "grokAgent", files: pluginTurnFiles(plugins.pluginDirs("bot-1")) })).toBe("");
  });

  it("reads a skill with no frontmatter and skips a commands readme", () => {
    const root = temp();
    write(root, "skills/review-notes/SKILL.md", "Just a note about review");
    write(root, "commands/README.md", "ignore");
    write(root, "commands/look.md", "---\ndescription: Look at the diff\n---\n# Title\n\nDetails");
    symlinkSync("/etc/passwd", join(root, "skills/review-notes/outside"));
    const files = pluginTurnFiles([root]);
    expect(files.map((file) => `${file.kind}:${file.name}:${file.description}`)).toEqual([
      "skill:review-notes:Just a note about review",
      "command:look:Look at the diff",
    ]);
  });

  it("indexes actual files at the exact sandbox mount without publishing host paths", () => {
    const root = temp();
    write(root, "skills/ship/SKILL.md", "---\nname: ship\ndescription: Verify shipping\n---\nInstructions");
    write(root, "commands/track.md", "Track the package");
    const files = pluginTurnFiles([root], () => "/workspace/sagax-plugins/packing");
    expect(files.map((file) => file.path)).toEqual([
      "/workspace/sagax-plugins/packing/skills/ship/SKILL.md",
      "/workspace/sagax-plugins/packing/commands/track.md",
    ]);
    const prompt = pluginTurnPrompt({ driverKind: "pi", files });
    expect(prompt).toContain("/workspace/sagax-plugins/packing/skills/ship/SKILL.md");
    expect(prompt).not.toContain(root);
  });

  it("discovers commands and agents even after more than forty skills", () => {
    const root = temp();
    for (let i = 0; i < 45; i++) write(root, `skills/skill-${i}/SKILL.md`, `---\nname: skill-${i}\ndescription: Verify\n---\nCheck.`);
    write(root, "commands/track.md", "Track the parcel");
    write(root, "agents/clerk.md", "Read the label");
    const files = pluginTurnFiles([root]);
    expect(files).toHaveLength(47);
    expect(files.some((file) => file.kind === "command")).toBe(true);
    expect(files.some((file) => file.kind === "agent")).toBe(true);
  });

  it("bounds the work across all plugins and explicitly marks a partial inventory", () => {
    const roots = [temp(), temp()];
    for (const root of roots) for (let i = 0; i < 300; i++) write(root, `skills/skill-${i}/SKILL.md`, `---\nname: skill-${i}\ndescription: Verify\n---\nCheck.`);
    const inventory = pluginTurnInventory(roots, (dir) => `plugins/${roots.indexOf(dir)}`);
    expect(inventory.files).toHaveLength(512);
    expect(inventory.truncated).toBe(true);
    expect(inventory.files.every((file) => !file.path.includes("\\"))).toBe(true);
  });

  it("bounds bytes read across the selected plugin files", () => {
    const root = temp();
    for (let i = 0; i < 15; i++) write(root, `skills/big-${i}/SKILL.md`, `---\nname: big-${i}\ndescription: Verify\n---\n${"x".repeat(200_000)}`);
    const inventory = pluginTurnInventory([root]);
    expect(inventory.files.length).toBeLessThan(15);
    expect(inventory.truncated).toBe(true);
  });

  it("reports a partial inventory when one reference exceeds the per-file limit", () => {
    const root = temp();
    write(root, "skills/oversized/SKILL.md", "x".repeat(256 * 1024 + 1));
    expect(pluginTurnInventory([root])).toEqual({ files: [], truncated: true });
  });

  it("charges empty roots against the same global work budget", () => {
    const root = temp();
    const inventory = pluginTurnInventory(Array.from({ length: 2000 }, () => root));
    expect(inventory.files).toEqual([]);
    expect(inventory.truncated).toBe(true);
  });
});
