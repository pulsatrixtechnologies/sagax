import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readMarketplaceManifest } from "./bot-plugins.ts";
import {
  folderDigest,
  isManifestUrl,
  marketplaceServerName,
  marketplaceVisibility,
  marketplaceVisibleTo,
  PluginMarketplaces,
  pluginInstallPlan,
  pluginRevision,
  pluginUpdateAvailable,
  planServerUpdate,
  updatedServerEntry,
} from "./plugin-marketplaces.ts";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "sagax-marketplaces-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function write(root: string, files: Record<string, string | object>) {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), typeof content === "string" ? content : JSON.stringify(content));
  }
}

const SKILL = "---\nname: release-notes\ndescription: Writes release notes.\n---\n\n# Release notes\n";

function marketplaceRepo(root: string) {
  write(root, {
    ".claude-plugin/marketplace.json": {
      name: "devjc", owner: { name: "JC" },
      plugins: [
        { name: "notes", source: "./plugins/notes", description: "Notes server and a skill", version: "1.2.0" },
        { name: "remote-one", source: { source: "github", repo: "acme/remote-plugin" }, description: "Elsewhere" },
        { name: "by-url", source: { source: "git", url: "https://git.example.com/team/plugin.git" } },
        { name: "../escape", source: "./x" },
        { name: "nosource" },
      ],
    },
    "plugins/notes/.claude-plugin/plugin.json": { name: "notes", version: "1.2.0", mcpServers: { search: { type: "http", url: "https://mcp.example.com/search" } } },
    "plugins/notes/.mcp.json": { mcpServers: { notes: { command: "node", args: ["${CLAUDE_PLUGIN_ROOT}/server.js"], env: { NOTES_DIR: "${CLAUDE_PLUGIN_ROOT}/data" } } } },
    "plugins/notes/skills/release-notes/SKILL.md": SKILL,
    "plugins/notes/skills/broken/SKILL.md": "no frontmatter",
    "plugins/notes/agents/helper.md": "agent",
    "plugins/notes/commands/go.md": "command",
  });
}

describe("marketplace manifest", () => {
  it("reads the Claude Code format: path, github and git sources; drops invalid entries", () => {
    const root = join(dir, "repo");
    marketplaceRepo(root);
    const manifest = readMarketplaceManifest(root);
    expect(manifest.name).toBe("devjc");
    expect(manifest.plugins.map((plugin) => [plugin.name, plugin.source.kind])).toEqual([
      ["notes", "path"], ["remote-one", "git"], ["by-url", "git"],
    ]);
    expect(manifest.plugins[0]).toMatchObject({ version: "1.2.0", source: { path: "./plugins/notes" } });
    expect(manifest.plugins[1]!.source).toMatchObject({ git: { id: "acme/remote-plugin" } });
  });

  it("tells a manifest address from a repository", () => {
    expect(isManifestUrl("https://example.com/.claude-plugin/marketplace.json")).toBe(true);
    expect(isManifestUrl("acme/plugins")).toBe(false);
    expect(isManifestUrl("https://github.com/acme/plugins")).toBe(false);
    expect(isManifestUrl("http://example.com/marketplace.json")).toBe(false);
  });
});

describe("install mapping: a plugin becomes MCP servers and skills", () => {
  it("maps .mcp.json and plugin.json servers, the plugin root, and valid skills", () => {
    const root = join(dir, "repo");
    marketplaceRepo(root);
    const pluginRoot = join(root, "plugins", "notes");
    const plan = pluginInstallPlan(pluginRoot);
    expect(plan.servers).toEqual([
      { name: "notes", entry: { command: "node", args: [`${pluginRoot}/server.js`], env: { NOTES_DIR: `${pluginRoot}/data` } } },
      { name: "search", entry: { type: "http", url: "https://mcp.example.com/search" } },
    ]);
    expect(plan.skills.map((skill) => skill.name)).toEqual(["release-notes"]);
    expect(plan.skipped).toEqual([expect.stringContaining("skill broken")]);
  });

  it("names servers safely and puts the plugin in front on a clash", () => {
    expect(marketplaceServerName("Notes Server", "notes", new Set())).toBe("notes-server");
    expect(marketplaceServerName("github", "devtools", new Set(["github"]))).toBe("devtools-github");
    expect(marketplaceServerName("github", "devtools", new Set(["github", "devtools-github"]))).toBe("github-2");
  });
});

describe("the installation's marketplaces", () => {
  const store = (git?: (url: string, into: string) => void, fetchText?: (url: string) => Promise<string>) => new PluginMarketplaces({
    dataDir: join(dir, "data"),
    gitEnvironment: () => ({}),
    policy: () => undefined,
    now: () => 1_000,
    git: async (args) => {
      const into = args.at(-1)!;
      const url = args.at(-2)!;
      if (!git) throw new Error("no git");
      git(url, into);
    },
    ...(fetchText ? { fetchText } : {}),
  });

  it("adds a repository shallowly, lists its plugins and installs one into its own folder", async () => {
    const source = join(dir, "repo");
    marketplaceRepo(source);
    const clones: string[] = [];
    const markets = store((url, into) => {
      clones.push(url);
      cpSync(source, into, { recursive: true });
    });
    const view = await markets.add({ source: "jencryzthers/marketplace", ref: "main" }, undefined);
    expect(clones).toEqual(["https://github.com/jencryzthers/marketplace.git"]);
    expect(view).toMatchObject({ name: "devjc", source: "jencryzthers/marketplace", ref: "main" });
    expect(view.plugins.map((plugin) => plugin.name)).toEqual(["notes", "remote-one", "by-url"]);
    const prepared = await markets.prepare("devjc", "notes", undefined);
    expect(prepared.dir).toBe(join(dir, "data", "marketplaces", "plugins", "devjc", "notes"));
    expect(prepared.plan.servers.map((server) => server.name)).toEqual(["notes", "search"]);
    markets.recordInstall("devjc", "notes", { version: prepared.version, servers: ["notes", "search"], skills: ["release-notes"] });
    expect(markets.list()[0]!.plugins[0]).toMatchObject({ installed: true, servers: ["notes", "search"], skills: ["release-notes"] });
    await expect(markets.remove("devjc")).rejects.toMatchObject({ code: "has_plugins" });
    expect(markets.recordUninstall("devjc", "notes").servers).toEqual(["notes", "search"]);
    await markets.remove("devjc");
    expect(markets.list()).toEqual([]);
  });

  it("adds a marketplace by the address of its manifest and reads plugin files over https", async () => {
    const pages: Record<string, string> = {
      "https://example.com/m/.claude-plugin/marketplace.json": JSON.stringify({ name: "web", plugins: [{ name: "docs", source: "./plugins/docs" }] }),
      "https://example.com/m/plugins/docs/.mcp.json": JSON.stringify({ docs: { type: "sse", url: "https://mcp.example.com/sse" } }),
    };
    const markets = store(undefined, async (url) => {
      if (!(url in pages)) throw new Error("404");
      return pages[url]!;
    });
    const view = await markets.add({ source: "https://example.com/m/.claude-plugin/marketplace.json" }, undefined);
    expect(view).toMatchObject({ name: "web", source: "https://example.com/m/.claude-plugin/marketplace.json" });
    const prepared = await markets.prepare("web", "docs", undefined);
    expect(prepared.plan.servers).toEqual([{ name: "docs", entry: { type: "sse", url: "https://mcp.example.com/sse" } }]);
  });

  it("applies the organization's allowed marketplaces", async () => {
    const markets = new PluginMarketplaces({
      dataDir: join(dir, "data"), gitEnvironment: () => ({}), policy: () => ({ mode: "list", allow: ["acme/*"] }),
      git: async () => { throw new Error("must not clone"); },
    });
    await expect(markets.add({ source: "other/plugins" }, undefined)).rejects.toMatchObject({ code: "marketplace_not_allowed" });
  });
});

describe("updating an installed plugin in place", () => {
  const store = (source: string) => new PluginMarketplaces({
    dataDir: join(dir, "data"),
    gitEnvironment: () => ({}),
    policy: () => undefined,
    now: () => 1_000,
    git: async (args) => { cpSync(source, args.at(-1)!, { recursive: true }); },
  });

  it("offers an update when the version or the plugin's files change", async () => {
    const source = join(dir, "repo");
    marketplaceRepo(source);
    const markets = store(source);
    await markets.add({ source: "acme/marketplace" }, undefined);
    const prepared = await markets.prepare("devjc", "notes", undefined);
    expect(prepared.revision).toMatch(/^sha256:[0-9a-f]{64}$/);
    markets.recordInstall("devjc", "notes", { version: prepared.version, revision: prepared.revision, servers: ["notes", "search"], serverNames: { notes: "notes", search: "search" }, skills: ["release-notes"] });
    expect(markets.list()[0]!.plugins[0]).not.toHaveProperty("updateAvailable");

    write(source, { "plugins/notes/skills/release-notes/SKILL.md": `${SKILL}\nNow with dates.\n` });
    await markets.refresh("devjc", undefined);
    expect(markets.list()[0]!.plugins[0]).toMatchObject({ version: "1.2.0", updateAvailable: true });

    const manifest = JSON.parse(readFileSync(join(source, ".claude-plugin/marketplace.json"), "utf8")) as { plugins: Array<{ version?: string }> };
    manifest.plugins[0]!.version = "1.3.0";
    write(source, { ".claude-plugin/marketplace.json": manifest });
    await markets.refresh("devjc", undefined);
    expect(markets.list()[0]!.plugins[0]).toMatchObject({ version: "1.3.0", installedVersion: "1.2.0", updateAvailable: true });

    const next = await markets.prepare("devjc", "notes", undefined);
    const updated = markets.recordUpdate("devjc", "notes", { version: next.version, revision: next.revision, servers: ["notes"], serverNames: { notes: "notes" }, skills: [] });
    expect(updated).toMatchObject({ version: "1.3.0", servers: ["notes"], skills: [], installedAt: 1_000, updatedAt: 1_000 });
    expect(markets.list()[0]!.plugins[0]).not.toHaveProperty("updateAvailable");
    expect(() => markets.recordUpdate("devjc", "remote-one", { servers: [], serverNames: {}, skills: [] })).toThrow();
  });

  it("compares only what both sides know", () => {
    expect(pluginUpdateAvailable({ version: "1.0.0" }, { version: "1.1.0" })).toBe(true);
    expect(pluginUpdateAvailable({ version: "1.0.0", revision: "a" }, { version: "1.0.0", revision: "b" })).toBe(true);
    expect(pluginUpdateAvailable({ version: "1.0.0", revision: "a" }, { version: "1.0.0", revision: "a" })).toBe(false);
    expect(pluginUpdateAvailable({}, { version: "2.0.0", revision: "b" })).toBe(false);
    expect(pluginUpdateAvailable({ revision: "a" }, {})).toBe(false);
  });

  it("names a plugin kept elsewhere by its repository, and digests files only", () => {
    const root = join(dir, "repo");
    marketplaceRepo(root);
    const [notes, remote] = readMarketplaceManifest(root).plugins;
    expect(pluginRevision(root, remote!)).toBe("git:acme/remote-plugin#:");
    expect(pluginRevision(root, notes!, "https://example.com/marketplace.json")).toBeUndefined();
    const before = folderDigest(join(root, "plugins/notes"));
    mkdirSync(join(root, "plugins/notes/.git"));
    writeFileSync(join(root, "plugins/notes/.git/HEAD"), "ref");
    expect(folderDigest(join(root, "plugins/notes"))).toBe(before);
    write(root, { "plugins/notes/agents/helper.md": "changed" });
    expect(folderDigest(join(root, "plugins/notes"))).not.toBe(before);
  });

  it("keeps each server under the name it was added as, adds new ones and drops the rest", () => {
    const plan = { servers: [{ name: "notes", entry: { command: "node" } }, { name: "search", entry: { url: "https://x.test/mcp" } }], skills: [], skipped: [] };
    expect(planServerUpdate(plan, { name: "notes", servers: ["notes-x", "old"], serverNames: { notes: "notes-x", gone: "old" } })).toEqual({
      keep: [{ name: "notes", stored: "notes-x", entry: { command: "node" } }],
      add: [{ name: "search", entry: { url: "https://x.test/mcp" } }],
      remove: ["old"],
    });
    // installed before the names were kept: the plain, prefixed or numbered name
    expect(planServerUpdate(plan, { name: "notes", servers: ["notes", "notes-search"] })).toMatchObject({
      keep: [{ name: "notes", stored: "notes" }, { name: "search", stored: "notes-search" }], add: [], remove: [],
    });
    expect(planServerUpdate(plan, { name: "notes", servers: ["search-ab12cd"] }).keep).toEqual([]);
  });

  it("keeps the person's values, switch and turned-off tools over the plugin's new entry", () => {
    const remote = updatedServerEntry(
      { type: "http", url: "https://old.test/mcp", headers: { Authorization: "mine" }, enabled: false, disabledTools: ["delete"], source: "devjc" },
      { type: "http", url: "https://new.test/mcp", headers: { "X-Plugin": "1", Authorization: "placeholder" } },
      "devjc",
    );
    expect(remote).toEqual({ type: "http", url: "https://new.test/mcp", headers: { "X-Plugin": "1", Authorization: "mine" }, enabled: false, disabledTools: ["delete"], source: "devjc" });
    const command = updatedServerEntry(
      { command: "node", args: ["a.js"], env: { TOKEN: "mine" }, enabled: true, source: "devjc" },
      { command: "node", args: ["b.js"], env: { MODE: "fast" } },
      "devjc",
    );
    expect(command).toEqual({ command: "node", args: ["b.js"], env: { MODE: "fast", TOKEN: "mine" }, enabled: true, source: "devjc" });
    expect(updatedServerEntry({ type: "http", url: "https://a.test", headers: {}, enabled: true }, { command: "node" }, "devjc")).toMatchObject({ enabled: false });
  });
});

describe("per-marketplace visibility (private to a person vs org-wide)", () => {
  const makeStore = (source: string) => new PluginMarketplaces({
    dataDir: join(dir, "data"),
    gitEnvironment: () => ({}),
    policy: () => undefined,
    now: () => 1_000,
    git: async (args) => { cpSync(source, args.at(-1)!, { recursive: true }); },
  });

  const alice = { principal: "alice" };
  const bob = { principal: "bob" };

  it("fails closed: an unknown or missing visibility reads as private", () => {
    expect(marketplaceVisibility({})).toBe("private");
    expect(marketplaceVisibility({ visibility: "org" })).toBe("org");
    expect(marketplaceVisibility({ visibility: "garbage" as unknown as "org" })).toBe("private");
  });

  it("marketplaceVisibleTo: org is public, private is the owner's only", () => {
    expect(marketplaceVisibleTo({ visibility: "org", addedBy: "alice" }, bob)).toBe(true);
    expect(marketplaceVisibleTo({ visibility: "private", addedBy: "alice" }, alice)).toBe(true);
    expect(marketplaceVisibleTo({ visibility: "private", addedBy: "alice" }, bob)).toBe(false);
    // the host operator / solo owner (seesAll) and an unfiltered call see all
    expect(marketplaceVisibleTo({ visibility: "private", addedBy: "alice" }, { seesAll: true })).toBe(true);
    expect(marketplaceVisibleTo({ visibility: "private", addedBy: "alice" }, undefined)).toBe(true);
    // a private marketplace with no known owner is nobody's but the operator's
    expect(marketplaceVisibleTo({ visibility: "private" }, bob)).toBe(false);
  });

  it("defaults a newly added marketplace to private, owned by the actor", async () => {
    const source = join(dir, "repo");
    marketplaceRepo(source);
    const markets = makeStore(source);
    const view = await markets.add({ source: "alice/marketplace" }, "alice");
    expect(view).toMatchObject({ visibility: "private", mine: true });
    // alice sees it; bob does not; it is not reachable by bob
    expect(markets.list(alice).map((market) => market.name)).toEqual(["devjc"]);
    expect(markets.list(bob)).toEqual([]);
    expect(markets.canAccess("devjc", alice)).toBe(true);
    expect(markets.canAccess("devjc", bob)).toBe(false);
  });

  it("stops bob from reaching alice's private marketplace (install, refresh, remove)", async () => {
    const source = join(dir, "repo");
    marketplaceRepo(source);
    const markets = makeStore(source);
    await markets.add({ source: "alice/marketplace" }, "alice");
    await expect(markets.prepare("devjc", "notes", "bob", bob)).rejects.toMatchObject({ code: "not_found" });
    await expect(markets.refresh("devjc", "bob", { viewer: bob })).rejects.toMatchObject({ code: "not_found" });
    await expect(markets.remove("devjc", bob)).rejects.toMatchObject({ code: "not_found" });
    await expect(markets.setVisibility("devjc", "org", bob)).rejects.toMatchObject({ code: "not_found" });
    // the owner can still prepare
    await expect(markets.prepare("devjc", "notes", "alice", alice)).resolves.toMatchObject({ dir: expect.any(String) });
  });

  it("lets the owner share a marketplace org-wide, then everyone sees it", async () => {
    const source = join(dir, "repo");
    marketplaceRepo(source);
    const markets = makeStore(source);
    await markets.add({ source: "alice/marketplace" }, "alice");
    expect(markets.list(bob)).toEqual([]);
    const shared = await markets.setVisibility("devjc", "org", alice);
    expect(shared).toMatchObject({ visibility: "org" });
    expect(markets.list(bob).map((market) => market.name)).toEqual(["devjc"]);
    expect(markets.canAccess("devjc", bob)).toBe(true);
    // bob sees it but it is not "his" to change the visibility of
    expect(markets.list(bob)[0]).toMatchObject({ mine: false });
  });

  it("honours an explicit org visibility on add", async () => {
    const source = join(dir, "repo");
    marketplaceRepo(source);
    const markets = makeStore(source);
    const view = await markets.add({ source: "alice/marketplace" }, "alice", { visibility: "org" });
    expect(view).toMatchObject({ visibility: "org" });
    expect(markets.list(bob).map((market) => market.name)).toEqual(["devjc"]);
  });

  it("migrates: a marketplace stored before visibility existed becomes private to its owner", async () => {
    const source = join(dir, "repo");
    marketplaceRepo(source);
    const markets = makeStore(source);
    await markets.add({ source: "alice/marketplace" }, "alice");
    // rewrite state.json without the visibility field, as an old install had it
    const statePath = join(dir, "data", "marketplaces", "state.json");
    const state = JSON.parse(readFileSync(statePath, "utf8")) as { marketplaces: Record<string, Record<string, unknown>> };
    delete state.marketplaces.devjc!.visibility;
    writeFileSync(statePath, JSON.stringify(state));
    const fresh = makeStore(source);
    expect(fresh.list(alice)[0]).toMatchObject({ visibility: "private", mine: true });
    expect(fresh.list(bob)).toEqual([]);
  });
});

describe("uninstalling a plugin's skills", () => {
  it("removes a library skill only when it came from that marketplace", async () => {
    const { installLibrarySkill, listLibrarySkills, removeLibrarySkillFrom } = await import("./skill-library.ts");
    const root = join(dir, "library");
    expect("error" in installLibrarySkill({ name: "release-notes", instructions: SKILL, source: "devjc", root })).toBe(false);
    expect(removeLibrarySkillFrom("release-notes", "other", root)).toEqual({ removed: false });
    expect(listLibrarySkills(root).map((skill) => skill.name)).toEqual(["release-notes"]);
    expect(removeLibrarySkillFrom("release-notes", "devjc", root)).toEqual({ removed: true });
    expect(listLibrarySkills(root)).toEqual([]);
  });
});
