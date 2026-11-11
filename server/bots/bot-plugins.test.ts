import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { BotPluginError, insideRoot, marketplaceAllowed, migrateBotMarketplaces, normalizePolicyEntry, parseGitSource, readMarketplaceManifest, readPluginContents, type GitRunner } from "./bot-plugins.ts";
import { PluginMarketplaces } from "../plugins/plugin-marketplaces.ts";
import { botPluginsWithMarketplaces } from "../testing/plugin-stores.ts";
import { PersonCapabilities, principalDir } from "../people/person-connections.ts";
import { personalPluginStorage } from "../plugins/person-plugins.ts";

const dirs: string[] = [];
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), "sagax-plugins-"));
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

/** A marketplace repository on disk: one local plugin with hooks and MCP. */
function marketplaceRepo(): string {
  const repo = temp();
  write(repo, ".claude-plugin/marketplace.json", JSON.stringify({
    name: "acme-tools",
    metadata: { description: "Acme's plugins" },
    plugins: [
      { name: "reviewer", source: "./plugins/reviewer", description: "Reviews code", version: "1.2.0" },
      { name: "escape", source: "../../etc" },
      { name: "remote", source: { source: "github", repo: "other/plugin-repo" } },
    ],
  }));
  write(repo, "plugins/reviewer/.claude-plugin/plugin.json", JSON.stringify({ name: "reviewer", hooks: "./hooks/hooks.json", mcpServers: { tracker: { command: "node" } } }));
  write(repo, "plugins/reviewer/skills/review/SKILL.md", "---\nname: review\ndescription: Review\n---\nBody");
  write(repo, "plugins/reviewer/commands/review.md", "Review the diff");
  write(repo, "plugins/reviewer/hooks/hooks.json", JSON.stringify({ hooks: {} }));
  write(repo, "plugins/reviewer/.mcp.json", JSON.stringify({ mcpServers: { db: { command: "npx" } } }));
  write(repo, "plugins/reviewer/bin/tool", "#!/bin/sh\necho hi");
  symlinkSync("/etc/passwd", join(repo, "plugins/reviewer/skills/review/link"));
  return repo;
}

function fakeGit(repos: Record<string, string>, calls: Array<{ args: string[]; env: Record<string, string> }>): GitRunner {
  return async (args, options) => {
    calls.push({ args, env: options.env });
    const url = args[args.indexOf("--") + 1]!;
    const into = args[args.indexOf("--") + 2]!;
    const from = repos[url];
    if (!from) throw new BotPluginError("The repository could not be fetched.", "repository_unreadable", 422);
    cpSync(from, into, { recursive: true });
  };
}

describe("parseGitSource", () => {
  it("reads owner/repo and github URLs as the same GitHub source", () => {
    expect(parseGitSource("Acme/Tools")).toMatchObject({ id: "acme/tools", url: "https://github.com/Acme/Tools.git", github: { owner: "Acme", repo: "Tools" } });
    expect(parseGitSource("https://github.com/acme/tools.git").id).toBe("acme/tools");
    expect(parseGitSource("https://gitlab.com/acme/tools.git").id).toBe("https://gitlab.com/acme/tools.git");
  });
  it("refuses http, credentials, local paths and bad refs", () => {
    for (const bad of ["http://github.com/a/b", "https://user:pw@github.com/a/b", "/etc/passwd", "file:///tmp/x", "git@github.com:a/b.git", "https://github.com/a/b?x=1"]) {
      expect(() => parseGitSource(bad), bad).toThrow(BotPluginError);
    }
    expect(() => parseGitSource("a/b", "../main")).toThrow(BotPluginError);
  });
});

describe("marketplace policy", () => {
  it("allows any marketplace by default", () => {
    expect(marketplaceAllowed(undefined, parseGitSource("x/y"))).toBe(true);
    expect(marketplaceAllowed({ mode: "any" }, parseGitSource("https://gitlab.com/x/y"))).toBe(true);
  });
  it("restricts to owner/repo, owner/* and exact URLs", () => {
    const policy = { mode: "list" as const, allow: ["pulsatrixtechnologies/marketplace", "example-org/*", "https://gitlab.com/acme/plugins"] };
    expect(marketplaceAllowed(policy, parseGitSource("PulsatrixTechnologies/marketplace"))).toBe(true);
    expect(marketplaceAllowed(policy, parseGitSource("example-org/anything"))).toBe(true);
    expect(marketplaceAllowed(policy, parseGitSource("https://gitlab.com/acme/plugins.git"))).toBe(false);
    expect(marketplaceAllowed(policy, parseGitSource("https://gitlab.com/acme/plugins"))).toBe(true);
    expect(marketplaceAllowed(policy, parseGitSource("evil/marketplace"))).toBe(false);
    expect(normalizePolicyEntry("Example/*")).toBe("example/*");
  });
});

describe("insideRoot", () => {
  it("keeps paths inside the repository", () => {
    expect(insideRoot("/r", "./plugins/a")).toBe(resolve("/r/plugins/a"));
    expect(insideRoot("/r", "./")).toBe(resolve("/r"));
    expect(() => insideRoot("/r", "../x")).toThrow(BotPluginError);
    expect(() => insideRoot("/r", "/etc")).toThrow(BotPluginError);
  });
});

describe("BotPlugins", () => {
  it("shares install and update behavior with a personal scope whose state and values stay encrypted", async () => {
    const dataDir = temp();
    const repo = marketplaceRepo();
    write(repo, "plugins/reviewer/.claude-plugin/plugin.json", JSON.stringify({ name: "reviewer", userConfig: { region: { type: "string" } } }));
    const vaultKey = { kind: "key" as const, key: Buffer.alloc(32, 7) };
    const capabilities = new PersonCapabilities(dataDir, () => vaultKey);
    capabilities.setGithub("pr_a", { token: "github-fixture", login: "alice", via: "token", connectedAt: 1 });
    const credentialScopes: string[] = [];
    const options = {
      dataDir, git: fakeGit({ "https://github.com/acme/tools.git": repo }, []), gitEnvironment: () => ({}), policy: () => undefined,
      storage: personalPluginStorage(dataDir, capabilities),
      tokens: {
        get: (scope: string) => { credentialScopes.push(scope); return undefined; },
        remove: () => true,
        sourcesFor: (scope: string) => { credentialScopes.push(scope); return new Set<string>(); },
        forgetBot: (scope: string) => { credentialScopes.push(scope); },
      },
    };
    const plugins = botPluginsWithMarketplaces(options);
    await plugins.addMarketplace("pr_a", { source: "acme/tools" }, "pr_a");
    await plugins.install("pr_a", { marketplace: "acme-tools", plugin: "reviewer" }, "pr_a");
    await plugins.setPluginConfig("pr_a", "reviewer@acme-tools", { region: "fixture-region" });
    plugins.setEnabled("pr_a", "reviewer@acme-tools", false);
    await plugins.install("pr_a", { marketplace: "acme-tools", plugin: "reviewer" }, "pr_a");
    expect(plugins.listPlugins("pr_a")[0]).toMatchObject({ enabled: false, config: { values: { region: "fixture-region" } } });
    expect(plugins.listPlugins("pr_b")).toEqual([]);
    expect(plugins.botsUsing("acme-tools")).toEqual(["pr_a"]);
    expect(existsSync(join(plugins.folder("pr_a"), "state.json"))).toBe(false);
    expect(existsSync(join(plugins.folder("pr_a"), "plugins", "config.json"))).toBe(false);
    const disk = readFileSync(join(principalDir(dataDir, "pr_a"), "capabilities.enc"), "utf8");
    expect(disk).not.toContain("fixture-region");
    expect(disk).not.toContain("reviewer@acme-tools");
    const again = botPluginsWithMarketplaces({ ...options, storage: personalPluginStorage(dataDir, new PersonCapabilities(dataDir, () => vaultKey)) });
    expect(again.listPlugins("pr_a")[0]).toMatchObject({ enabled: false, config: { values: { region: "fixture-region" } } });
    plugins.forgetBot("pr_a");
    expect(capabilities.pluginState("pr_a").plugins).toEqual({});
    expect(capabilities.pluginValues("pr_a")).toEqual({});
    expect(capabilities.github("pr_a")?.login).toBe("alice");
    expect(credentialScopes).toContain("person:pr_a");
    expect(credentialScopes).not.toContain("pr_a");
  });

  it("adds a marketplace, installs a plugin without what would run on the host, and lists its folder", async () => {
    const repo = marketplaceRepo();
    const calls: Array<{ args: string[]; env: Record<string, string> }> = [];
    const plugins = botPluginsWithMarketplaces({
      dataDir: temp(), git: fakeGit({ "https://github.com/acme/tools.git": repo }, calls),
      gitEnvironment: (actor): Record<string, string> => (actor ? { GIT_CONFIG_COUNT: "1", ACTOR: actor } : {}), policy: () => undefined,
    });
    const listing = await plugins.addMarketplace("bot-1", { source: "acme/tools" }, "pr_owner");
    expect(listing).toMatchObject({ name: "acme-tools", source: "acme/tools", description: "Acme's plugins" });
    expect(listing.plugins.map((plugin) => plugin.name)).toEqual(["reviewer", "escape", "remote"]);
    // the acting person's GitHub credentials are offered for a GitHub clone
    expect(calls[0]!.env).toMatchObject({ ACTOR: "pr_owner" });
    expect(calls[0]!.args).not.toContain("pr_owner");

    const installed = await plugins.install("bot-1", { marketplace: "acme-tools", plugin: "reviewer" }, "pr_owner");
    expect(installed).toMatchObject({ key: "reviewer@acme-tools", enabled: true, version: "1.2.0" });
    expect(installed.removed).toEqual(expect.arrayContaining(["hooks", ".mcp.json", "plugin.json hooks", "plugin.json mcpServers"]));
    expect(installed.declaredMcpServers.sort()).toEqual(["db", "tracker"]);
    const [dir] = plugins.pluginDirs("bot-1");
    expect(dir).toBeTruthy();
    expect(existsSync(join(dir!, "skills/review/SKILL.md"))).toBe(true);
    expect(existsSync(join(dir!, "commands/review.md"))).toBe(true);
    expect(existsSync(join(dir!, "hooks"))).toBe(false);
    expect(existsSync(join(dir!, ".mcp.json"))).toBe(false);
    expect(existsSync(join(dir!, "bin", "tool"))).toBe(true);
    expect(existsSync(join(dir!, "skills/review/link"))).toBe(false);
    const manifest = JSON.parse(readFileSync(join(dir!, ".claude-plugin/plugin.json"), "utf8"));
    expect(manifest).toEqual({ name: "reviewer" });

    plugins.setEnabled("bot-1", "reviewer@acme-tools", false);
    expect(plugins.pluginDirs("bot-1")).toEqual([]);
    // another bot gets nothing
    expect(plugins.pluginDirs("bot-2")).toEqual([]);
  });

  it("keeps plugin MCP execution specs private, uses the sandbox root and replaces them on update", async () => {
    const repo = marketplaceRepo();
    write(repo, "plugins/reviewer/.mcp.json", JSON.stringify({ mcpServers: {
      local: { command: "node", args: ["${CLAUDE_PLUGIN_ROOT}/bin/tool"], env: { REGION: "fixture-region" } },
      remote: { url: "https://tools.example.com/mcp", headers: { "X-Token": "fixture-header" } },
    } }));
    const plugins = botPluginsWithMarketplaces({ dataDir: temp(), git: fakeGit({ "https://github.com/acme/tools.git": repo }, []), gitEnvironment: () => ({}), policy: () => undefined });
    await plugins.addMarketplace("bot-1", { source: "acme/tools" }, undefined);
    const installed = await plugins.install("bot-1", { marketplace: "acme-tools", plugin: "reviewer" }, undefined);
    const servers = plugins.mcpServers("bot-1");
    expect(servers.find((server) => server.name === "local")?.spec).toEqual({ command: "node", args: ["/workspace/sagax-plugins/reviewer/bin/tool"], env: { REGION: "fixture-region" } });
    expect(servers.find((server) => server.name === "remote")?.spec).toEqual({ type: "http", url: "https://tools.example.com/mcp", headers: { "X-Token": "fixture-header" } });
    for (const listing of [installed, plugins.listPlugins("bot-1"), plugins.stateFor("bot-1")]) {
      expect(JSON.stringify(listing)).not.toContain("fixture-region");
      expect(JSON.stringify(listing)).not.toContain("fixture-header");
    }
    const stateFile = join(plugins.folder("bot-1"), "state.json");
    const stored = JSON.parse(readFileSync(stateFile, "utf8"));
    stored.plugins[installed.key].mcpServers.injected = { command: "node", args: [], env: { SAGAX_HARNESS_URL: "https://other.example.com" } };
    writeFileSync(stateFile, JSON.stringify(stored));
    expect(plugins.mcpServers("bot-1").map((server) => server.name).sort()).toEqual(["local", "remote", "tracker"]);
    plugins.setEnabled("bot-1", installed.key, false);
    expect(plugins.mcpServers("bot-1")).toEqual([]);
    plugins.setEnabled("bot-1", installed.key, true);
    write(repo, "plugins/reviewer/.mcp.json", JSON.stringify({ mcpServers: { remote: { url: "https://new-tools.example.com/mcp" } } }));
    await plugins.updateMarketplace("bot-1", "acme-tools", undefined);
    await plugins.install("bot-1", { marketplace: "acme-tools", plugin: "reviewer" }, undefined);
    expect(plugins.mcpServers("bot-1").some((server) => server.name === "local")).toBe(false);
    expect(plugins.mcpServers("bot-1").find((server) => server.name === "remote")?.spec).toMatchObject({ url: "https://new-tools.example.com/mcp" });
    await plugins.uninstall("bot-1", installed.key);
    expect(plugins.mcpServers("bot-1")).toEqual([]);
  });

  it("refuses a plugin path that leaves its marketplace", async () => {
    const plugins = botPluginsWithMarketplaces({ dataDir: temp(), git: fakeGit({ "https://github.com/acme/tools.git": marketplaceRepo() }, []), gitEnvironment: () => ({}), policy: () => undefined });
    await plugins.addMarketplace("bot-1", { source: "acme/tools" }, undefined);
    await expect(plugins.install("bot-1", { marketplace: "acme-tools", plugin: "escape" }, undefined)).rejects.toMatchObject({ code: "invalid_plugin" });
  });

  it("applies the organization's marketplace list to a shared marketplace, including a plugin's own repository", async () => {
    const repo = marketplaceRepo();
    const plugins = botPluginsWithMarketplaces({
      dataDir: temp(), git: fakeGit({ "https://github.com/acme/tools.git": repo }, []), gitEnvironment: () => ({}),
      policy: () => ({ mode: "list", allow: ["acme/*"] }),
    });
    await expect(plugins.addMarketplace("bot-1", { source: "evil/tools", visibility: "org" }, undefined)).rejects.toMatchObject({ code: "marketplace_not_allowed", status: 403 });
    await plugins.addMarketplace("bot-1", { source: "acme/tools", visibility: "org" }, undefined);
    await expect(plugins.install("bot-1", { marketplace: "acme-tools", plugin: "remote" }, undefined)).rejects.toMatchObject({ code: "marketplace_not_allowed" });
  });

  it("lets a person's private marketplace serve their own bot outside the organization's list (#1098)", async () => {
    const remote = temp();
    write(remote, "commands/go.md", "Go");
    const plugins = botPluginsWithMarketplaces({
      dataDir: temp(),
      git: fakeGit({ "https://github.com/evil/tools.git": marketplaceRepo(), "https://github.com/other/plugin-repo.git": remote }, []),
      gitEnvironment: () => ({}),
      policy: () => ({ mode: "list", allow: ["acme/*"] }),
    });
    await expect(plugins.addMarketplace("bot-1", { source: "evil/tools" }, "pr_alice")).resolves.toMatchObject({ name: "acme-tools" });
    await expect(plugins.install("bot-1", { marketplace: "acme-tools", plugin: "remote" }, "pr_alice")).resolves.toMatchObject({ name: "remote" });
  });

  it("refuses a repository that is not a marketplace and removes a marketplace with its plugins", async () => {
    const notMarket = temp();
    write(notMarket, "README.md", "hi");
    const repo = marketplaceRepo();
    const plugins = botPluginsWithMarketplaces({
      dataDir: temp(), git: fakeGit({ "https://github.com/acme/readme.git": notMarket, "https://github.com/acme/tools.git": repo }, []),
      gitEnvironment: () => ({}), policy: () => undefined,
    });
    await expect(plugins.addMarketplace("bot-1", { source: "acme/readme" }, undefined)).rejects.toMatchObject({ code: "not_a_marketplace" });
    await plugins.addMarketplace("bot-1", { source: "acme/tools" }, undefined);
    await plugins.install("bot-1", { marketplace: "acme-tools", plugin: "reviewer" }, undefined);
    expect(await plugins.removeMarketplace("bot-1", "acme-tools", { mayManage: true })).toEqual({ sharedRemoved: true });
    expect(plugins.listPlugins("bot-1")).toEqual([]);
    expect(await plugins.listMarketplaces("bot-1")).toEqual([]);
    expect(plugins.pluginDirs("bot-1")).toEqual([]);
  });

  it("reads the one marketplace list: a marketplace added for everyone is there for every bot, installs stay per bot", async () => {
    const dataDir = temp();
    const git = fakeGit({ "https://github.com/acme/tools.git": marketplaceRepo() }, []);
    const shared = new PluginMarketplaces({ dataDir, git, gitEnvironment: () => ({}), policy: () => undefined });
    const plugins = botPluginsWithMarketplaces({ dataDir, git, gitEnvironment: () => ({}), policy: () => undefined });
    await shared.add({ source: "acme/tools" }, "pr_admin");
    for (const bot of ["bot-1", "bot-2"]) expect((await plugins.listMarketplaces(bot)).map((market) => market.name)).toEqual(["acme-tools"]);
    await plugins.install("bot-1", { marketplace: "acme-tools", plugin: "reviewer" }, undefined);
    expect((await plugins.listMarketplaces("bot-1"))[0]!.plugins.find((plugin) => plugin.name === "reviewer")).toMatchObject({
      installed: true, contents: { agents: [], commands: ["review"], skills: ["review"] },
    });
    expect((await plugins.listMarketplaces("bot-2"))[0]!.plugins.find((plugin) => plugin.name === "reviewer")?.installed).toBe(false);
    // the remote plugin's folder is read at install, not listed
    expect((await plugins.listMarketplaces("bot-1"))[0]!.plugins.find((plugin) => plugin.name === "remote")?.contents).toBeUndefined();
    expect(plugins.botsUsing("acme-tools")).toEqual(["bot-1"]);
  });

  it("offers an update for one bot when the marketplace has another version or other files, and Install updates in place", async () => {
    const dataDir = temp();
    const repo = marketplaceRepo();
    const plugins = botPluginsWithMarketplaces({ dataDir, git: fakeGit({ "https://github.com/acme/tools.git": repo }, []), gitEnvironment: () => ({}), policy: () => undefined });
    await plugins.addMarketplace("bot-1", { source: "acme/tools" }, "pr_alice");
    await plugins.install("bot-1", { marketplace: "acme-tools", plugin: "reviewer" }, "pr_alice");
    plugins.setEnabled("bot-1", "reviewer@acme-tools", false);
    const reviewer = async (bot: string) => (await plugins.listMarketplaces(bot))[0]!.plugins.find((plugin) => plugin.name === "reviewer")!;
    expect((await reviewer("bot-1")).updateAvailable).toBeUndefined();
    // other files, same version
    write(repo, "plugins/reviewer/commands/explain.md", "Explain the diff");
    await plugins.updateMarketplace("bot-1", "acme-tools", "pr_alice");
    expect(await reviewer("bot-1")).toMatchObject({ installed: true, updateAvailable: true });
    expect((await reviewer("bot-2")).updateAvailable).toBeUndefined();
    await plugins.install("bot-1", { marketplace: "acme-tools", plugin: "reviewer" }, "pr_alice");
    expect((await reviewer("bot-1")).updateAvailable).toBeUndefined();
    expect(plugins.listPlugins("bot-1")[0]).toMatchObject({ enabled: false, version: "1.2.0" });
    expect(existsSync(join(dataDir, "bot-plugins", "bot-1", "plugins", "acme-tools", "reviewer", "commands", "explain.md"))).toBe(true);
    // another declared version
    const manifest = JSON.parse(readFileSync(join(repo, ".claude-plugin/marketplace.json"), "utf8")) as { plugins: Array<Record<string, unknown>> };
    manifest.plugins[0]!.version = "1.3.0";
    write(repo, ".claude-plugin/marketplace.json", JSON.stringify(manifest));
    await plugins.updateMarketplace("bot-1", "acme-tools", "pr_alice");
    expect(await reviewer("bot-1")).toMatchObject({ version: "1.3.0", installedVersion: "1.2.0", updateAvailable: true });
  });

  it("#3612: Install of an installed plugin pulls its marketplace first, so a copy many versions behind comes up to date", async () => {
    const dataDir = temp();
    const repo = marketplaceRepo();
    const plugins = botPluginsWithMarketplaces({ dataDir, git: fakeGit({ "https://github.com/acme/tools.git": repo }, []), gitEnvironment: () => ({}), policy: () => undefined });
    await plugins.addMarketplace("bot-1", { source: "acme/tools" }, "pr_alice");
    await plugins.install("bot-1", { marketplace: "acme-tools", plugin: "reviewer" }, "pr_alice");
    // the marketplace moves on; nobody pressed Update on it
    const manifest = JSON.parse(readFileSync(join(repo, ".claude-plugin/marketplace.json"), "utf8")) as { plugins: Array<Record<string, unknown>> };
    manifest.plugins[0]!.version = "1.8.0";
    write(repo, ".claude-plugin/marketplace.json", JSON.stringify(manifest));
    write(repo, "plugins/reviewer/pages/report.html", "<p>new</p>");
    // the bot's own update (act plugins install, "also updates")
    await plugins.install("bot-1", { marketplace: "acme-tools", plugin: "reviewer" }, "pr_alice");
    expect(plugins.listPlugins("bot-1")[0]).toMatchObject({ version: "1.8.0" });
    expect(readFileSync(join(dataDir, "bot-plugins", "bot-1", "plugins", "acme-tools", "reviewer", "pages", "report.html"), "utf8")).toBe("<p>new</p>");
    // another bot's copy changes only on its own update
    expect(plugins.listPlugins("bot-2")).toEqual([]);
  });

  it("restores a bot package's marketplaces into the one list, without one the organization does not allow", async () => {
    const dataDir = temp();
    const plugins = botPluginsWithMarketplaces({ dataDir, gitEnvironment: () => ({}), policy: () => ({ mode: "list", allow: ["acme/*"] }) });
    const root = plugins.folder("bot-9");
    for (const [market, plugin] of [["acme", "reviewer"], ["evil", "spy"]] as const) {
      write(root, `marketplaces/${market}/.claude-plugin/marketplace.json`, JSON.stringify({ name: market, plugins: [{ name: plugin, source: `./plugins/${plugin}` }] }));
      write(root, `plugins/${market}/${plugin}/commands/go.md`, "Go");
    }
    const record = (source: string) => ({ source, url: `https://github.com/${source}.git`, addedAt: 1, updatedAt: 2 });
    const plugin = (name: string, marketplace: string) => ({ name, marketplace, enabled: true, installedAt: 1, updatedAt: 2, removed: [], declaredMcpServers: [] });
    expect(plugins.restoreState("bot-9", {
      version: 1,
      marketplaces: { acme: record("acme/tools"), evil: record("evil/tools") },
      plugins: { "reviewer@acme": plugin("reviewer", "acme"), "spy@evil": plugin("spy", "evil") },
    })).toEqual({ marketplaces: ["acme"], plugins: ["reviewer@acme"] });
    expect((await plugins.listMarketplaces("bot-9")).map((market) => market.name)).toEqual(["acme"]);
    expect(existsSync(join(root, "marketplaces"))).toBe(false);
    // what a package carries again: the per-bot format, from the one list
    expect(plugins.stateFor("bot-9")).toMatchObject({ version: 1, marketplaces: { acme: { source: "acme/tools" } }, plugins: { "reviewer@acme": { name: "reviewer" } } });
  });

  it("keeps the marketplace for everyone unless the person may remove it and nothing else uses it", async () => {
    const dataDir = temp();
    const plugins = botPluginsWithMarketplaces({ dataDir, git: fakeGit({ "https://github.com/acme/tools.git": marketplaceRepo() }, []), gitEnvironment: () => ({}), policy: () => undefined });
    await plugins.addMarketplace("bot-1", { source: "acme/tools" }, "pr_alice");
    await plugins.install("bot-1", { marketplace: "acme-tools", plugin: "reviewer" }, "pr_alice");
    await plugins.install("bot-2", { marketplace: "acme-tools", plugin: "reviewer" }, "pr_bob");
    // Bob did not add it and does not manage marketplaces: only his bot's plugins go
    expect(await plugins.removeMarketplace("bot-2", "acme-tools", { actor: "pr_bob" })).toEqual({ sharedRemoved: false });
    expect(plugins.listPlugins("bot-2")).toEqual([]);
    expect((await plugins.listMarketplaces("bot-2")).map((market) => market.name)).toEqual(["acme-tools"]);
    // Alice added it: it leaves the list once no bot uses it any more
    const shared = new PluginMarketplaces({ dataDir, gitEnvironment: () => ({}), policy: () => undefined, inUse: (name) => plugins.botsUsing(name) });
    await plugins.install("bot-2", { marketplace: "acme-tools", plugin: "reviewer" }, "pr_bob");
    await expect(shared.remove("acme-tools")).rejects.toMatchObject({ code: "in_use", status: 409 });
    expect((await shared.list())[0]!.bots).toBe(2);
    expect(await plugins.removeMarketplace("bot-1", "acme-tools", { actor: "pr_alice" })).toEqual({ sharedRemoved: false });
    expect(await plugins.removeMarketplace("bot-2", "acme-tools", { actor: "pr_bob" })).toEqual({ sharedRemoved: false });
    expect(await plugins.removeMarketplace("bot-1", "acme-tools", { actor: "pr_alice" })).toEqual({ sharedRemoved: true });
    expect(await shared.list()).toEqual([]);
  });

  it("refuses a per-bot install from a marketplace added by its manifest address", async () => {
    const dataDir = temp();
    const manifest = JSON.stringify({ name: "hosted", plugins: [{ name: "a", source: "./a" }] });
    const plugins = botPluginsWithMarketplaces({ dataDir, gitEnvironment: () => ({}), policy: () => undefined, fetchText: async () => manifest });
    await plugins.addMarketplace("bot-1", { source: "https://example.com/.claude-plugin/marketplace.json" }, undefined);
    await expect(plugins.install("bot-1", { marketplace: "hosted", plugin: "a" }, undefined)).rejects.toMatchObject({ code: "manifest_only", status: 422 });
  });

  it("reads a plugin's agents, commands and skills by name, without following links", () => {
    const root = temp();
    write(root, "agents/planner.md", "x");
    write(root, "agents/notes.txt", "x");
    write(root, "commands/ship.md", "x");
    write(root, "skills/review/SKILL.md", "x");
    mkdirSync(join(root, "skills/empty"), { recursive: true });
    symlinkSync("/etc", join(root, "skills/outside"));
    expect(readPluginContents(root)).toEqual({ agents: ["planner"], commands: ["ship"], skills: ["review"] });
    expect(readPluginContents(join(root, "missing"))).toEqual({ agents: [], commands: [], skills: [] });
  });

  it("reads pluginRoot and remote sources from a manifest", () => {
    const repo = temp();
    write(repo, ".claude-plugin/marketplace.json", JSON.stringify({ name: "m", metadata: { pluginRoot: "./plugins" }, plugins: [{ name: "a", source: "a" }, { name: "b", source: { source: "url", url: "https://gitlab.com/x/b.git" } }, { name: "bad name!", source: "./x" }] }));
    const manifest = readMarketplaceManifest(repo);
    expect(manifest.plugins).toEqual([
      { name: "a", source: { kind: "path", path: "./plugins/a" } },
      { name: "b", source: { kind: "git", git: expect.objectContaining({ id: "https://gitlab.com/x/b.git" }) } },
    ]);
  });

  it("reads a plugin's site and declared icon for its mark, http(s) only, icons https only, no credentials", () => {
    const repo = temp();
    write(repo, ".claude-plugin/marketplace.json", JSON.stringify({ name: "m", plugins: [
      { name: "a", source: "./a", homepage: "https://docs.example.com/a", icon: "https://cdn.example.com/a.png" },
      { name: "b", source: "./b", author: { name: "Example", url: "http://example.org" }, logo: "http://cdn.example.com/b.png" },
      { name: "c", source: "./c", homepage: "javascript:alert(1)", icon: "data:image/png;base64,AAAA" },
      { name: "d", source: "./d", homepage: "https://user:pass@example.com/", icon: `https://example.com/${"x".repeat(600)}.png` },
    ] }));
    const marks = readMarketplaceManifest(repo).plugins.map(({ name, homepage, icon }) => ({ name, homepage, icon }));
    expect(marks).toEqual([
      { name: "a", homepage: "https://docs.example.com/a", icon: "https://cdn.example.com/a.png" },
      { name: "b", homepage: "http://example.org/", icon: undefined },
      { name: "c", homepage: undefined, icon: undefined },
      { name: "d", homepage: undefined, icon: undefined },
    ]);
  });
});

describe("migrateBotMarketplaces", () => {
  /** A bot as an older build stored it: its own marketplaces and installs. */
  function legacyBot(dataDir: string, botId: string, markets: Record<string, { source: string; repo: string }>, plugins: Array<{ name: string; marketplace: string; enabled?: boolean }>) {
    const root = join(dataDir, "bot-plugins", botId);
    const state = {
      version: 1,
      marketplaces: Object.fromEntries(Object.entries(markets).map(([name, market]) => {
        cpSync(market.repo, join(root, "marketplaces", name), { recursive: true });
        return [name, { source: market.source, url: `https://github.com/${market.source}.git`, addedAt: 1, addedBy: "pr_owner", updatedAt: 1 }];
      })),
      plugins: Object.fromEntries(plugins.map((plugin) => {
        write(root, `plugins/${plugin.marketplace}/${plugin.name}/commands/go.md`, "Go");
        return [`${plugin.name}@${plugin.marketplace}`, {
          name: plugin.name, marketplace: plugin.marketplace, enabled: plugin.enabled ?? true, installedAt: 1, installedBy: "pr_owner", updatedAt: 1, removed: ["hooks"], declaredMcpServers: [],
        }];
      })),
    };
    write(root, "state.json", JSON.stringify(state));
    return root;
  }

  it("moves every bot's marketplaces into the one list and keeps every install, once", async () => {
    const dataDir = temp();
    const repo = marketplaceRepo();
    const other = temp();
    write(other, ".claude-plugin/marketplace.json", JSON.stringify({ name: "acme-tools", plugins: [{ name: "reviewer", source: "./r" }] }));
    write(other, "r/commands/x.md", "x");
    const shared = new PluginMarketplaces({ dataDir, gitEnvironment: () => ({}), policy: () => undefined });
    legacyBot(dataDir, "bot-1", { "acme-tools": { source: "acme/tools", repo } }, [{ name: "reviewer", marketplace: "acme-tools" }]);
    legacyBot(dataDir, "bot-2", { "acme-tools": { source: "acme/tools", repo } }, [{ name: "reviewer", marketplace: "acme-tools", enabled: false }]);
    // same name, another repository: stored under another name, its install follows
    const third = legacyBot(dataDir, "bot-3", { "acme-tools": { source: "evil/tools", repo: other } }, [{ name: "reviewer", marketplace: "acme-tools" }]);

    const summary = migrateBotMarketplaces(dataDir, shared);
    expect(summary).toMatchObject({ bots: 3, plugins: 3, failed: [], renamed: ["reviewer@acme-tools -> reviewer@acme-tools-2"] });
    expect((await shared.list()).map((market) => [market.name, market.source])).toEqual([["acme-tools", "acme/tools"], ["acme-tools-2", "evil/tools"]]);
    expect(shared.record("acme-tools")).toMatchObject({ addedBy: "pr_owner" });
    expect(existsSync(join(shared.repoPath("acme-tools-2"), "r/commands/x.md"))).toBe(true);

    const plugins = botPluginsWithMarketplaces({ dataDir, gitEnvironment: () => ({}), policy: () => undefined });
    expect(plugins.listPlugins("bot-1").map((plugin) => [plugin.key, plugin.enabled])).toEqual([["reviewer@acme-tools", true]]);
    expect(plugins.listPlugins("bot-2").map((plugin) => [plugin.key, plugin.enabled])).toEqual([["reviewer@acme-tools", false]]);
    expect(plugins.listPlugins("bot-3").map((plugin) => plugin.key)).toEqual(["reviewer@acme-tools-2"]);
    expect(plugins.pluginDirs("bot-1")).toHaveLength(1);
    expect(plugins.pluginDirs("bot-3")).toEqual([join(third, "plugins/acme-tools-2/reviewer")]);
    expect(existsSync(join(third, "plugins/acme-tools-2/reviewer/commands/go.md"))).toBe(true);
    expect(existsSync(join(third, "marketplaces"))).toBe(false);
    expect(JSON.parse(readFileSync(join(third, "state.json"), "utf8")).version).toBe(2);
    // each bot reads the one list, with its own installs
    expect((await plugins.listMarketplaces("bot-3")).map((market) => [market.name, market.plugins.find((plugin) => plugin.name === "reviewer")?.installed])).toEqual([["acme-tools", false], ["acme-tools-2", true]]);

    // a second start changes nothing
    expect(migrateBotMarketplaces(dataDir, shared)).toMatchObject({ bots: 0, plugins: 0 });
    expect(await shared.list()).toHaveLength(2);
  });

  it("reuses a marketplace the workspace already has from the same source", async () => {
    const dataDir = temp();
    const repo = marketplaceRepo();
    const shared = new PluginMarketplaces({ dataDir, git: fakeGit({ "https://github.com/acme/tools.git": repo }, []), gitEnvironment: () => ({}), policy: () => undefined });
    await shared.add({ source: "acme/tools" }, "pr_admin");
    legacyBot(dataDir, "bot-1", { "acme-tools": { source: "acme/tools", repo } }, [{ name: "reviewer", marketplace: "acme-tools" }]);
    expect(migrateBotMarketplaces(dataDir, shared)).toMatchObject({ bots: 1, renamed: [] });
    expect((await shared.list()).map((market) => market.name)).toEqual(["acme-tools"]);
    expect(shared.record("acme-tools")?.addedBy).toBe("pr_admin");
  });

  it("still counts a bot's installs before it is migrated", () => {
    const dataDir = temp();
    legacyBot(dataDir, "bot-1", { "acme-tools": { source: "acme/tools", repo: marketplaceRepo() } }, [{ name: "reviewer", marketplace: "acme-tools" }]);
    const plugins = botPluginsWithMarketplaces({ dataDir, gitEnvironment: () => ({}), policy: () => undefined });
    expect(plugins.listPlugins("bot-1").map((plugin) => plugin.key)).toEqual(["reviewer@acme-tools"]);
    expect(plugins.pluginDirs("bot-1")).toHaveLength(1);
  });
});

describe("a marketplace's credential from the one list (2026-10-28)", () => {
  const PICKED = "fake-picked-token-1111";
  const PERSON = "fake-person-token-2222";
  async function setup() {
    const { GithubCredentials } = await import("../github/github-credentials.ts");
    const dir = temp();
    const store = new GithubCredentials(dir, () => ({ kind: "key", key: Buffer.alloc(32, 3) }));
    store.change("pr_owner", { op: "add", label: "Acme organization", token: PICKED });
    const [credential] = store.list("pr_owner", { org: false });
    const probes: string[][] = [];
    const plugins = botPluginsWithMarketplaces({
      dataDir: dir,
      git: fakeGit({ "https://github.com/acme/tools.git": marketplaceRepo() }, []),
      gitEnvironment: () => ({}),
      policy: () => undefined,
      credentials: () => [{ token: PERSON, via: "person", login: "owner-login" }],
      probe: async (_repo, list) => {
        probes.push(list.map((entry) => entry.token));
        return { ok: true, credential: list[0] ?? null };
      },
      tokens: {
        get: (scope, source) => store.get(scope, source),
        chosen: (scope, source) => store.chosenSecret(scope, source),
        choose: (scope, source, id) => store.choose(scope, source, id),
        usable: (id, actor) => (store.ownerOf(id) === actor ? { id, label: "", token: store.tokenFor(id)! } : undefined),
        noteUsed: (scope, source, used) => store.noteUsed(scope, source, used),
        describe: (scope, source, viewer) => store.describe(scope, source, viewer ?? ""),
        remove: (scope, source) => store.unpick(scope, source),
        sourcesFor: (scope) => store.sourcesFor(scope),
        forgetBot: (scope) => store.forgetScope(scope),
      },
    });
    return { store, plugins, probes, credential: credential! };
  }

  it("Automatic tries the person's connection and says it read the marketplace", async () => {
    const { plugins, probes } = await setup();
    await plugins.addMarketplace("bot-1", { source: "acme/tools" }, "pr_owner");
    expect(probes[0]).toEqual([PERSON]);
    const [listing] = await plugins.listMarketplaces("bot-1", { principal: "pr_owner" });
    expect(listing!.credential).toMatchObject({ used: { via: "person", login: "owner-login" } });
    expect(listing!.credential?.chosen).toBeUndefined();
  });

  it("a picked credential is tried first, shown by label, and Automatic again drops it", async () => {
    const { plugins, probes, credential } = await setup();
    await plugins.addMarketplace("bot-1", { source: "acme/tools", credential: credential.id }, "pr_owner");
    expect(probes[0]![0]).toBe(PICKED);
    let [listing] = await plugins.listMarketplaces("bot-1", { principal: "pr_owner" });
    expect(listing!.hasToken).toBe(true);
    expect(listing!.credential).toMatchObject({ chosen: { id: credential.id, label: "Acme organization", owner: "mine" }, used: { via: "credential", label: "Acme organization" } });
    expect(JSON.stringify(listing)).not.toContain(PICKED);
    await plugins.updateMarketplace("bot-1", "acme-tools", "pr_owner");
    expect(probes[1]![0]).toBe(PICKED);
    listing = await plugins.chooseMarketplaceCredential("bot-1", "acme-tools", null, "pr_owner");
    expect(listing.credential?.chosen).toBeUndefined();
    await plugins.updateMarketplace("bot-1", "acme-tools", "pr_owner");
    expect(probes[2]).toEqual([PERSON]);
  });

  it("refuses a credential the actor may not use", async () => {
    const { plugins, credential } = await setup();
    await plugins.addMarketplace("bot-1", { source: "acme/tools" }, "pr_owner");
    await expect(plugins.chooseMarketplaceCredential("bot-1", "acme-tools", credential.id, "someone-else")).rejects.toThrow(/No credential/);
  });
});
