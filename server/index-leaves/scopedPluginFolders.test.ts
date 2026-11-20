// D-20261119-087 (#5105): a bot sees only the plugin skills of the products
// its Perspicax connection serves it. scopedPluginFolders is the one place
// this applies: Claude loads its folders with `--plugin-dir`, every other
// engine gets its skills index, skills_list, workspace_read and native links
// from the same folders, and the person's environment receives them.
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { pluginDirsForTurn } from "../drivers/claude/plugin-agent-tools.ts";
import { removeTempDir } from "../testing/cleanup.ts";
import { claudePluginDirs, pluginTurnInventory, pluginTurnPrompt } from "../turns/plugin-turn.ts";
import { readWorkspaceText } from "../workspace/workspace-files.ts";
import { createPluginFolderCapability } from "./pluginFolderCapability.ts";
import { createScopedPluginFolders } from "./scopedPluginFolders.ts";

const root = mkdtempSync(join(tmpdir(), "sagax-served-skills-"));
afterAll(() => removeTempDir(root));

// The one plugin: platform skills with no product, product skills named
// `<product>-<skill>` with the API ids they need, the product's code beside.
const installed = join(root, "installed", "ops");
const SKILLS: Array<[string, string]> = [
  ["rules", ""],
  ["acme-psa-time", "metadata:\n  product: acme\n  apis: acme_psa_time\n"],
  ["acme-psa-dispatch", "metadata:\n  product: acme\n  apis: acme_psa_service acme_psa_schedule\n"],
  ["acme-rmm-fix", "metadata:\n  product: acme\n  apis: acme_rmm acme_psa_service\n"],
];
mkdirSync(join(installed, ".claude-plugin"), { recursive: true });
writeFileSync(join(installed, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "ops" }));
for (const [name, metadata] of SKILLS) {
  mkdirSync(join(installed, "skills", name), { recursive: true });
  writeFileSync(join(installed, "skills", name, "SKILL.md"), `---\nname: ${name}\ndescription: "The ${name} skill."\n${metadata}---\n# ${name}\n`);
}
mkdirSync(join(installed, "acme", "common"), { recursive: true });
writeFileSync(join(installed, "acme", "common", "reader.py"), "print('ok')\n");

const ACME_PSA = ["acme_psa_service", "acme_psa_schedule", "acme_psa_time"];
const bot = { id: "bot-1" };

function host(identity: "perspicax" | "solo" = "perspicax") {
  const state = {
    /** api_list as Sagax last read it for the bot; undefined: not read yet */
    listed: undefined as undefined | { ids: string[]; groups: Map<string, string[]> },
    record: { id: bot.id, products: {} as Record<string, boolean> },
  };
  const value = {
    IDENTITY: { kind: identity },
    DATA_DIR: join(root, "data"),
    effectiveBotOwner: () => "ada",
    localPrincipalId: () => "ada",
    samePerson: () => true,
    flowAliasFolders: () => new Set<string>(),
    orgFlowPlugins: { dirsFor: () => [] },
    orgCapabilityMounts: () => [],
    installationPlugins: { enabledPlugins: () => [{ name: "ops", dir: installed }], folder: (key: string) => (key === "ops@acme-market" ? { dir: installed } : null) },
    personalPlugins: { enabledPlugins: () => [] },
    botPlugins: { enabledPlugins: () => [] },
    store: { bot: (id: string) => (id === bot.id ? state.record : null) },
    perspicaxMcp: { servedApis: (id: string) => (id === bot.id && state.listed ? { ids: new Set(state.listed.ids), groups: state.listed.groups } : undefined) },
    pluginMarketplaces: { installed: () => [{ key: "ops@acme-market" }] },
  };
  return { value, state };
}

/** What each engine receives of the bot's plugin skills on a turn. */
function received(folders: Array<{ name: string; dir: string }>) {
  const dirs = folders.map((folder) => folder.dir);
  // Claude: `--plugin-dir`, read natively (skills/<name>/SKILL.md)
  const claude = pluginDirsForTurn(claudePluginDirs("claudeAgent", dirs), { offered: null, denied: [] }, join(root, "agent-copies"))
    .flatMap((dir) => readdirSync(join(dir, "skills"))).sort();
  // every other engine: the skills index, skills_list and the native links
  const inventory = pluginTurnInventory(dirs, { pathForDir: (dir) => `plugins/${folders.find((folder) => folder.dir === dir)!.name}` });
  const others = inventory.files.filter((file) => file.kind === "skill").map((file) => file.name).sort();
  const prompt = pluginTurnPrompt({ driverKind: "codex", files: inventory.files });
  return { claude, others, prompt };
}

describe("scopedPluginFolders: a bot's plugin skills follow the products it is served (D-20261119-087)", () => {
  it("gives a bot without acme_psa_* no acme-* skill, on Claude and on every other engine", () => {
    const { value, state } = host();
    state.listed = { ids: ["nimbus_backup"], groups: new Map() };
    const folders = createScopedPluginFolders(() => value)(bot, "ada");
    const got = received(folders);
    expect(got.claude).toEqual(["rules"]);
    expect(got.others).toEqual(["rules"]);
    expect(got.prompt).not.toMatch(/acme-/);
    // workspace_read cannot reach the hidden skill either; the product's code stays
    expect(() => readWorkspaceText(bot.id, "plugins/ops/skills/acme-psa-time/SKILL.md", 0, folders)).toThrow();
    expect(readWorkspaceText(bot.id, "plugins/ops/acme/common/reader.py", 0, folders).text).toBe("print('ok')\n");
    // the folder still names its install, and the installed folder is untouched
    expect(folders[0]!.installed).toBe(installed);
    expect(createPluginFolderCapability(() => value)(bot, "ada", folders[0])).toEqual({ key: "plugin:installation:ops@acme-market", name: "ops" });
    expect(readdirSync(join(installed, "skills")).sort()).toEqual(["acme-psa-dispatch", "acme-psa-time", "acme-rmm-fix", "rules"]);
  });

  it("always passes a platform skill: nothing served, everything served, or nothing known yet", () => {
    const { value, state } = host();
    const scoped = createScopedPluginFolders(() => value);
    for (const listed of [{ ids: [], groups: new Map() }, { ids: [...ACME_PSA, "acme_rmm"], groups: new Map() }, undefined]) {
      state.listed = listed;
      const got = received(scoped(bot, "ada"));
      expect(got.claude).toContain("rules");
      expect(got.others).toContain("rules");
    }
    // served everything: the installed folder itself, every skill
    state.listed = { ids: [...ACME_PSA, "acme_rmm"], groups: new Map() };
    expect(scoped(bot, "ada")[0]!.dir).toBe(installed);
    expect(received(scoped(bot, "ada")).others).toEqual(["acme-psa-dispatch", "acme-psa-time", "acme-rmm-fix", "rules"]);
  });

  it("takes a product's skills away at the next turn, and gives them back the same way", () => {
    const { value, state } = host();
    const scoped = createScopedPluginFolders(() => value);
    state.listed = { ids: [...ACME_PSA, "acme_rmm"], groups: new Map([["acme_psa", ACME_PSA]]) };
    expect(received(scoped(bot, "ada")).claude).toEqual(["acme-psa-dispatch", "acme-psa-time", "acme-rmm-fix", "rules"]);
    // the person turns acme_psa_time off for this bot (Connect Apps, This bot)
    state.record.products = { acme_psa_time: false };
    expect(received(scoped(bot, "ada")).claude).toEqual(["acme-psa-dispatch", "acme-rmm-fix", "rules"]);
    expect(received(scoped(bot, "ada")).others).toEqual(["acme-psa-dispatch", "acme-rmm-fix", "rules"]);
    // Perspicax no longer serves acme_rmm (api_list read again at the turn)
    state.listed = { ids: ACME_PSA, groups: new Map([["acme_psa", ACME_PSA]]) };
    expect(received(scoped(bot, "ada")).others).toEqual(["acme-psa-dispatch", "rules"]);
    // both given back
    state.record.products = { acme_psa_time: true };
    state.listed = { ids: [...ACME_PSA, "acme_rmm"], groups: new Map([["acme_psa", ACME_PSA]]) };
    expect(received(scoped(bot, "ada")).others).toEqual(["acme-psa-dispatch", "acme-psa-time", "acme-rmm-fix", "rules"]);
  });

  it("leaves the folders as installed where no Perspicax connection serves the bot", () => {
    const { value, state } = host("solo");
    state.listed = { ids: [], groups: new Map() };
    const folders = createScopedPluginFolders(() => value)(bot);
    expect(folders[0]!.dir).toBe(installed);
    expect(received(folders).others).toHaveLength(SKILLS.length);
  });
});
