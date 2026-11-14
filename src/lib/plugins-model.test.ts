import { describe, expect, it } from "vitest";

import { GROK_CLOUD_CONNECTORS } from "../../shared/grok-cloud-connectors";
import { appKey, buildPluginItems, isGrokConnector, categoryFromTags, connectedSummary, installedPlugins, mainSections, matchesFilter, matchesType, pluginMark } from "./plugins-model";

const sources = {
  servers: [
    { name: "docs", enabled: true, url: "https://mcp.example.com/mcp", auth: "required" },
    { name: "notes", enabled: false, command: "npx" },
  ],
  featured: [
    { id: "linear", name: "Linear", description: "Issues", url: "https://mcp.linear.app/mcp", domain: "mcp.linear.app", site: "linear.app", category: "code", auth: "oauth" },
    { id: "same", name: "Docs", description: "Already added", url: "https://mcp.example.com/mcp", domain: "example.com", auth: "none" },
  ],
  skills: [{ name: "release-notes", description: "Writes notes", source: "local-import", enabled: true }],
};

describe("the Plugins panel's one list", () => {
  it("reads every source into rows with the right button and status", () => {
    const items = buildPluginItems(sources);
    const byKey = Object.fromEntries(items.map((item) => [item.key, item]));
    expect(byKey["mcp:docs"]).toMatchObject({ installed: true, status: "needs_auth", source: "manual" });
    expect(byKey["mcp:notes"]).toMatchObject({ status: "off" });
    expect(byKey["featured:linear"]).toMatchObject({ action: "connect", category: "code", domain: "linear.app" });
    // #4207: no row carries a recommendation of its own (recommended-picks.ts picks them)
    expect(items.some((item) => "recommended" in item)).toBe(false);
    // a catalog plugin already added shows once, as the server it became
    expect(byKey["featured:same"]).toBeUndefined();
    expect(byKey["skill:release-notes"]).toMatchObject({ source: "local", installed: true });
  });

  it("files a catalog tag under its category, Other without a tag", () => {
    expect(categoryFromTags(["password managers"])).toBe("passwords");
    expect(categoryFromTags(["design & creative tools"])).toBe("design");
    expect(categoryFromTags(["developer tools"])).toBe("code");
    expect(categoryFromTags(["collaboration & communication"])).toBe("communication");
    expect(categoryFromTags(["document & file management"])).toBe("productivity");
    expect(categoryFromTags(["crm"])).toBe("sales");
    expect(categoryFromTags(["accounting"])).toBe("finance");
    expect(categoryFromTags(["analytics"])).toBe("data");
    expect(categoryFromTags(["customer support"])).toBe("support");
    expect(categoryFromTags(["ai", "email marketing"])).toBe("marketing");
    expect(categoryFromTags(["ai"])).toBe("other");
    expect(categoryFromTags([])).toBe("other");
    expect(categoryFromTags(undefined)).toBe("other");
  });

  it("keeps MCP servers and Skills as a type filter, not category chips", () => {
    const items = buildPluginItems(sources);
    // no connected-app rows: the standalone account catalog is gone
    expect(items.filter((item) => matchesType(item, "apps"))).toEqual([]);
    expect(new Set(items.filter((item) => matchesType(item, "mcp")).map((item) => item.kind))).toEqual(new Set(["mcp", "featured"]));
    expect(items.filter((item) => matchesType(item, "skills")).map((item) => item.key)).toEqual(["skill:release-notes"]);
    // a category never lists skills
    expect(items.filter((item) => matchesFilter(item, "other")).some((item) => item.kind === "skill")).toBe(false);
    expect(mainSections(items, "", "all", "mcp")).toHaveLength(1);
  });

  it("shows sections per category, one list for a search across apps and skills", () => {
    const items = buildPluginItems(sources);
    const sections = mainSections(items, "", "all");
    // #4207: Recommended for you is the view's own first section, not one of these
    expect(sections.map((section) => section.id)).toEqual(["code", "mcp", "skills"]);
    // #3047: a row the view already recommends is not repeated
    expect(mainSections(items, "", "all", "any", [], [], ["featured:linear"]).map((section) => section.id)).toEqual(["mcp", "skills"]);
    const keys = sections.flatMap((section) => section.items.map((item) => item.key));
    expect(new Set(keys).size).toBe(keys.length);
    // the Code chip still lists it
    expect(mainSections(items, "", "code")[0]!.items.map((item) => item.key)).toContain("featured:linear");
    const search = mainSections(items, "notes", "all");
    expect(search).toHaveLength(1);
    expect(search[0]!.items.map((item) => item.key).sort()).toEqual(["mcp:notes", "skill:release-notes"]);
  });

  it("counts connected plugins for the header, skills apart", () => {
    const items = buildPluginItems(sources);
    expect(installedPlugins(items).map((item) => item.key)).toEqual(["mcp:docs", "mcp:notes"]);
    const summary = connectedSummary(items);
    // docs needs auth, notes is off: nothing is connected yet
    expect(summary.count).toBe(0);
    expect(summary.icons).toEqual([]);
  });
});

describe("marketplace plugins in the list", () => {
  const withMarket = {
    ...sources,
    servers: [...sources.servers, { name: "devjc-notes", enabled: true, url: "https://notes.example.com/mcp", source: "devjc" }],
    skills: [...sources.skills, { name: "triage", description: "Triage", source: "devjc", enabled: false }],
    marketplaces: [{
      name: "devjc",
      plugins: [
        { name: "notes", description: "Notes for bots", version: "1.0.0", installed: true, servers: ["devjc-notes"], skills: ["triage"] },
        { name: "figma-kit", description: "Design helpers", category: "design", installed: false, servers: [], skills: [] },
      ],
    }],
  };

  it("shows a marketplace's plugins under its own chip, with what they brought folded under them", () => {
    const items = buildPluginItems(withMarket);
    const byKey = Object.fromEntries(items.map((item) => [item.key, item]));
    expect(byKey["plugin:notes@devjc"]).toMatchObject({ kind: "plugin", installed: true, source: "devjc", version: "1.0.0" });
    expect(byKey["plugin:figma-kit@devjc"]).toMatchObject({ action: "add", category: "design" });
    expect(byKey["mcp:devjc-notes"]).toMatchObject({ source: "devjc", parent: "plugin:notes@devjc" });
    expect(byKey["skill:triage"]).toMatchObject({ parent: "plugin:notes@devjc" });
    const sections = mainSections(items, "", "all", "any", ["devjc"]);
    expect(sections.find((section) => section.id === "source:devjc")!.items.map((item) => item.key))
      .toEqual(["plugin:notes@devjc", "plugin:figma-kit@devjc"]);
    // installed once, as the plugin, not again as its server
    expect(installedPlugins(items).map((item) => item.key)).toContain("plugin:notes@devjc");
    expect(installedPlugins(items).map((item) => item.key)).not.toContain("mcp:devjc-notes");
  });
});

describe("Whop, an MCP server connected like an app", () => {
  it("is one app row with Connect until signed in, then shows as connected and folds its server under it", () => {
    const before = buildPluginItems({ ...sources, whop: { description: "Sell on Whop", connected: false } });
    expect(before.find((item) => item.key === "whop:whop")).toMatchObject({ name: "Whop", action: "connect", installed: false });
    const after = buildPluginItems({
      ...sources,
      servers: [...sources.servers, { name: "business", enabled: true, url: "https://mcp.whop.com/mcp", auth: "connected" }],
      whop: { description: "Sell on Whop", server: "business", connected: true },
    });
    expect(after.find((item) => item.key === "whop:whop")).toMatchObject({ installed: true, status: "connected", action: null });
    expect(after.find((item) => item.key === "mcp:business")).toMatchObject({ parent: "whop:whop" });
    expect(installedPlugins(after).map((item) => item.key)).toContain("whop:whop");
    expect(installedPlugins(after).map((item) => item.key)).not.toContain("mcp:business");
  });
});

describe("Tailscale, a bot computer join under Connect apps", () => {
  it("is one featured row: Connect when idle, pending while waiting, connected when on the tailnet", () => {
    const idle = buildPluginItems({
      ...sources,
      tailscale: { description: "Join your bot computer to your private tailnet.", connected: false },
    });
    expect(idle.find((item) => item.key === "tailscale:tailscale")).toMatchObject({
      name: "Tailscale",
      action: "connect",
      installed: false,
      status: "available",
      category: "other",
    });
    expect(matchesType(idle.find((item) => item.key === "tailscale:tailscale")!, "apps")).toBe(true);

    const waiting = buildPluginItems({
      ...sources,
      tailscale: { description: "Join your bot computer to your private tailnet.", connected: false, pending: true },
    });
    expect(waiting.find((item) => item.key === "tailscale:tailscale")).toMatchObject({
      installed: true,
      status: "pending",
      action: null,
    });

    const on = buildPluginItems({
      ...sources,
      tailscale: { description: "Join your bot computer to your private tailnet.", connected: true },
    });
    expect(on.find((item) => item.key === "tailscale:tailscale")).toMatchObject({
      installed: true,
      status: "connected",
      action: null,
    });
  });
});


describe("one row per app across sources", () => {
  const merged = {
    featured: [
      { id: "asana", name: "Asana", description: "Read and update tasks", url: "https://mcp.asana.com/sse", domain: "mcp.asana.com", site: "asana.com", category: "productivity", auth: "oauth" },
      { id: "atlassian", name: "Atlassian", description: "Jira and Confluence", url: "https://mcp.atlassian.com/v1/mcp", domain: "mcp.atlassian.com", site: "atlassian.com", category: "productivity", auth: "oauth" },
    ],
    servers: [{ name: "Notion MCP", enabled: true, url: "https://mcp.notion.com/mcp", auth: "connected" }],
  };

  it("matches names whatever their case, accents and MCP suffix", () => {
    expect(appKey("Asana")).toBe(appKey("asana"));
    expect(appKey("Notion MCP")).toBe("notion");
    expect(appKey("Café (beta)")).toBe("cafe");
  });

  it("draws a catalog server with its provider's site, not its MCP host", () => {
    const atlassian = buildPluginItems(merged).find((item) => item.key === "featured:atlassian")!;
    expect(atlassian.domain).toBe("atlassian.com");
  });

  it("lists the xAI account connectors, including Exchange, X and Microsoft Teams", () => {
    const items = buildPluginItems({ grok: { connectors: GROK_CLOUD_CONNECTORS, description: "Managed on Grok" } });
    const names = items.filter((item) => item.source === "grok").map((item) => item.name);
    expect(names).toEqual(expect.arrayContaining(["Outlook (Exchange)", "X", "Microsoft Teams"]));
    const found = mainSections(items, "exchange", "all");
    expect(found[0]!.items.map((item) => item.key)).toEqual(["grok:outlook"]);
    expect(items.find((item) => item.key === "grok:microsoft-teams")).toMatchObject({ kind: "app", installed: false, status: "available", category: "communication", action: null });
  });

  it("has no xAI rows when no Grok provider is set up", () => {
    expect(buildPluginItems({ grok: null }).some((item) => item.source === "grok")).toBe(false);
  });
});

describe("the list has no standalone connected-app rows", () => {
  it("renders MCP servers, the catalog, skills and Grok connectors, and never a connected-app account row", () => {
    const items = buildPluginItems({
      servers: [{ name: "docs", enabled: true, url: "https://mcp.example.com/mcp", auth: "connected" }],
      featured: [{ id: "linear", name: "Linear", description: "Issues", url: "https://mcp.linear.app/mcp", domain: "linear.app", auth: "oauth" }],
      skills: [{ name: "release-notes", description: "Writes notes", source: "local-import", enabled: true }],
      grok: { connectors: GROK_CLOUD_CONNECTORS, description: "Managed on Grok" },
    });
    // the MCP server, the catalog listing and the skill are all present
    expect(items.find((item) => item.key === "mcp:docs")).toMatchObject({ kind: "mcp", status: "connected" });
    expect(items.find((item) => item.key === "featured:linear")).toMatchObject({ kind: "featured", action: "connect" });
    expect(items.find((item) => item.key === "skill:release-notes")).toMatchObject({ kind: "skill" });
    // every app row is a Grok cloud connector; none is a standalone account
    const apps = items.filter((item) => item.kind === "app");
    expect(apps.length).toBeGreaterThan(0);
    expect(apps.every((item) => item.source === "grok" && isGrokConnector(item))).toBe(true);
  });
});

describe("the connected count", () => {
  it("counts servers, Whop, marketplace plugins and Claude connectors", () => {
    const items = buildPluginItems({
      servers: [
        { name: "docs", enabled: true, url: "https://mcp.example.com/mcp", auth: "connected" },
        { name: "off", enabled: false, command: "npx" },
        { name: "biz", enabled: true, url: "https://mcp.whop.com/mcp", auth: "connected" },
        { name: "kit-notes", enabled: true, url: "https://kit.example.com/mcp", source: "kit" },
      ],
      whop: { description: "Whop", server: "biz", connected: true },
      marketplaces: [{ name: "kit", plugins: [{ name: "notes", installed: true, servers: ["kit-notes"], skills: [] }] }],
    });
    const summary = connectedSummary(items, 3);
    // docs, Whop, the kit plugin (its server folds under it), and 3 Claude connectors
    expect(summary.count).toBe(6);
    expect(connectedSummary(items).count).toBe(3);
  });
});

describe("a marketplace plugin's mark (2026-10-28)", () => {
  it("its declared icon, else its site, else the app it is named for, else none", () => {
    expect(pluginMark({ name: "ops", icon: "https://cdn.example.com/ops.png", homepage: "https://ops.example.com" })).toEqual({ logo: "https://cdn.example.com/ops.png", site: "ops.example.com" });
    expect(pluginMark({ name: "notes", homepage: "https://www.notes.example.com/docs" })).toEqual({ logo: null, site: "notes.example.com" });
    expect(pluginMark({ name: "github" })).toEqual({ logo: null, site: "github.com" });
    expect(pluginMark({ name: "gmail" }).logo).toContain("gmail_2020q4_48dp.png");
    expect(pluginMark({ name: "code-review" })).toEqual({ logo: null, site: null });
    // a repository on a code host is not the plugin's own mark, except for that host's app
    expect(pluginMark({ name: "code-review", homepage: "https://github.com/example/code-review" })).toEqual({ logo: null, site: null });
    expect(pluginMark({ name: "github", homepage: "https://github.com/github/github-mcp-server" })).toEqual({ logo: null, site: "github.com" });
    // an icon that is not https is not loaded
    expect(pluginMark({ name: "x", icon: "http://cdn.example.com/x.png" })).toEqual({ logo: null, site: null });
  });

  it("plugin rows carry it, so Discover and Installed draw it", () => {
    const items = buildPluginItems({ marketplaces: [{ name: "kit", plugins: [
      { name: "notes", installed: true, servers: [], skills: [], homepage: "https://notes.example.com" },
      { name: "plain", installed: false, servers: [], skills: [] },
    ] }] });
    expect(items.find((item) => item.id === "notes@kit")).toMatchObject({ kind: "plugin", domain: "notes.example.com" });
    expect(items.find((item) => item.id === "plain@kit")?.domain).toBeUndefined();
  });
});

describe("the GitHub plugin's server reads the person's GitHub account (2026-10-28)", () => {
  const server = (github?: "connected" | "missing" | "unreadable") => ({
    name: "github-github", enabled: true, url: "https://api.githubcopilot.com/mcp/", auth: "none", source: "claude-plugins-official",
    ...(github ? { github } : {}),
  });

  it("is connected only when the account is, whatever its own sign-in state says", () => {
    const missing = buildPluginItems({ servers: [server("missing")] }).find((item) => item.key === "mcp:github-github");
    expect(missing).toMatchObject({ status: "needs_auth", githubAccount: "missing" });
    const connected = buildPluginItems({ servers: [{ ...server("connected"), auth: "error" }] }).find((item) => item.key === "mcp:github-github");
    expect(connected).toMatchObject({ status: "connected", githubAccount: "connected" });
    // #4155: a saved account this launch cannot read is not connected, and stays told apart from a missing one
    const unreadable = buildPluginItems({ servers: [server("unreadable")] }).find((item) => item.key === "mcp:github-github");
    expect(unreadable).toMatchObject({ status: "needs_auth", githubAccount: "unreadable" });
    // any other server keeps its own state
    expect(buildPluginItems({ servers: [server()] }).find((item) => item.key === "mcp:github-github")).toMatchObject({ status: "connected" });
    expect(buildPluginItems({ servers: [server()] }).find((item) => item.key === "mcp:github-github")?.githubAccount).toBeUndefined();
  });
});
