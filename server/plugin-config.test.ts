// A plugin's configuration values (server/plugin-config.ts) through a bot's
// plugins (server/bot-plugins.ts): declared fields, typed values, secrets
// refused, ${user_config.KEY} written into skills from the kept original,
// again after an update, and gone with the plugin.
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { BotPluginError, type GitRunner } from "./bot-plugins.ts";
import { checkPluginConfig, pluginConfigFields, substituteConfig } from "./plugin-config.ts";
import { botPluginsWithMarketplaces } from "./testing/plugin-stores.ts";

const dirs: string[] = [];
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), "sagax-plugin-config-"));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const write = (root: string, path: string, content: string) => {
  mkdirSync(join(root, path, ".."), { recursive: true });
  writeFileSync(join(root, path), content);
};

const DECLARED = {
  workspace: { type: "string", title: "Workspace", description: "Your team's workspace", required: true },
  pageSize: { type: "number", title: "Page size", default: 20 },
  apiKey: { type: "string", title: "API key", sensitive: true },
  "bad key": { type: "string" },
};

describe("plugin configuration fields", () => {
  it("reads the declared fields, types and defaults, and never a secret's default", () => {
    const fields = pluginConfigFields({ ...DECLARED, apiKey: { ...DECLARED.apiKey, default: "sk-live" } });
    expect(fields.map((field) => field.key)).toEqual(["workspace", "pageSize", "apiKey"]);
    expect(fields.find((field) => field.key === "pageSize")).toMatchObject({ type: "number", default: 20 });
    expect(fields.find((field) => field.key === "apiKey")).toMatchObject({ sensitive: true });
    expect(fields.find((field) => field.key === "apiKey")?.default).toBeUndefined();
    expect(pluginConfigFields(null)).toEqual([]);
  });

  it("keeps typed values, refuses secrets, unknown fields and a missing required one", () => {
    const fields = pluginConfigFields(DECLARED);
    expect(checkPluginConfig(fields, { workspace: " acme ", pageSize: "50" })).toEqual({ ok: true, values: { workspace: "acme", pageSize: 50 } });
    expect(checkPluginConfig(fields, { workspace: "acme", apiKey: "sk" })).toMatchObject({ ok: false, code: "sensitive_field" });
    expect(checkPluginConfig(fields, { workspace: "acme", other: 1 })).toMatchObject({ ok: false, code: "unknown_field" });
    expect(checkPluginConfig(fields, { pageSize: 5 })).toMatchObject({ ok: false, code: "required_field" });
    expect(checkPluginConfig(fields, { workspace: "acme", pageSize: "many" })).toMatchObject({ ok: false, code: "invalid_value" });
  });

  it("replaces known placeholders, falls back to the default, and leaves secrets and unknown ones", () => {
    const fields = pluginConfigFields(DECLARED);
    expect(substituteConfig("W=${user_config.workspace} P=${user_config.pageSize} K=${user_config.apiKey} X=${user_config.nope}", fields, { workspace: "acme" }))
      .toBe("W=acme P=20 K=${user_config.apiKey} X=${user_config.nope}");
  });
});

describe("a bot's plugin configuration", () => {
  function setup() {
    const repo = temp();
    write(repo, ".claude-plugin/marketplace.json", JSON.stringify({ name: "acme-tools", plugins: [{ name: "tracker", source: "./plugins/tracker", version: "1.0.0" }] }));
    write(repo, "plugins/tracker/.claude-plugin/plugin.json", JSON.stringify({ name: "tracker", userConfig: DECLARED }));
    write(repo, "plugins/tracker/skills/triage/SKILL.md", "---\nname: triage\ndescription: Triage\n---\nOpen ${user_config.workspace}, ${user_config.pageSize} at a time.\n");
    write(repo, "plugins/tracker/commands/plain.md", "No placeholder here.\n");
    const git: GitRunner = async (args) => { cpSync(repo, args[args.indexOf("--") + 2]!, { recursive: true }); };
    const dataDir = temp();
    return { repo, dataDir, plugins: botPluginsWithMarketplaces({ dataDir, git, gitEnvironment: () => ({}), policy: () => undefined }) };
  }

  it("lists the fields, saves values into the skill, keeps them across an update, and forgets them with the plugin", async () => {
    const { repo, dataDir, plugins } = setup();
    await plugins.addMarketplace("bot-1", { source: "acme/tools" }, undefined);
    const installed = await plugins.install("bot-1", { marketplace: "acme-tools", plugin: "tracker" }, undefined);
    const [dir] = plugins.pluginDirs("bot-1");
    const skill = () => readFileSync(join(dir!, "skills/triage/SKILL.md"), "utf8");
    // the default goes in at install; the required field waits
    expect(skill()).toContain("Open ${user_config.workspace}, 20 at a time.");
    expect(plugins.listPlugins("bot-1")[0]?.config?.fields.map((field) => field.key)).toEqual(["workspace", "pageSize", "apiKey"]);

    const saved = await plugins.setPluginConfig("bot-1", installed.key, { workspace: "acme", pageSize: 5 });
    expect(saved.config?.values).toEqual({ workspace: "acme", pageSize: 5 });
    expect(skill()).toContain("Open acme, 5 at a time.");
    // a new value starts again from the original text
    await plugins.setPluginConfig("bot-1", installed.key, { workspace: "globex" });
    expect(skill()).toContain("Open globex, 20 at a time.");
    expect(readFileSync(join(dir!, "commands/plain.md"), "utf8")).toBe("No placeholder here.\n");
    const file = join(dataDir, "bot-plugins", "bot-1", "plugins", "config.json");
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readFileSync(file, "utf8")).not.toContain("sk");

    await expect(plugins.setPluginConfig("bot-1", installed.key, { workspace: "acme", apiKey: "sk-live" })).rejects.toBeInstanceOf(BotPluginError);

    // an update copies the plugin again: the values go back in
    write(repo, "plugins/tracker/skills/triage/SKILL.md", "---\nname: triage\ndescription: Triage\n---\nv2 ${user_config.workspace}\n");
    await plugins.updateMarketplace("bot-1", "acme-tools", undefined);
    await plugins.install("bot-1", { marketplace: "acme-tools", plugin: "tracker" }, undefined);
    expect(skill()).toContain("v2 globex");

    await plugins.uninstall("bot-1", installed.key);
    expect(readFileSync(file, "utf8")).not.toContain("globex");
  });
});
