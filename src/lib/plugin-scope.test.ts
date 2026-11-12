import { describe, expect, it } from "vitest";

import type { BotPluginsView } from "./my-connections";
import { botPluginState, botScopeMarketplaces, initialPluginScope, marketplaceRoute, pluginScopeBot, marketplaceCredentialControls } from "./plugin-scope";

const view: BotPluginsView = {
  marketplaces: [{
    name: "acme-tools", source: "acme/tools", addedAt: 1, updatedAt: 1,
    plugins: [
      { name: "reviewer", description: "Reviews code", installed: true, external: false, contents: { agents: ["critic"], commands: ["review"], skills: ["style"] } },
      { name: "linter", installed: false, external: true },
    ],
  }],
  plugins: [{ key: "reviewer@acme-tools", name: "reviewer", marketplace: "acme-tools", enabled: true, removed: ["hooks"], declaredMcpServers: [] }],
  policy: { mode: "any" },
  engine: { loadsPlugins: true },
  canChange: true,
};

describe("plugin scope", () => {
  const bots = [{ id: "maya" }, { id: "rex" }];

  it("is about the bot a bot panel sent the person with, else the open conversation", () => {
    expect(pluginScopeBot({ pluginsBotId: "rex", selectedId: "maya", bots })?.id).toBe("rex");
    expect(pluginScopeBot({ pluginsBotId: null, selectedId: "maya", bots })?.id).toBe("maya");
    expect(pluginScopeBot({ pluginsBotId: null, selectedId: "group-1", bots })).toBeNull();
  });

  it("opens on the bot's scope only when a bot panel asked for it", () => {
    expect(initialPluginScope("rex", { id: "rex" })).toBe("bot");
    expect(initialPluginScope(null, { id: "maya" })).toBe("me");
    expect(initialPluginScope("rex", null)).toBe("me");
    // #3910: sent to add a server, where servers are added (the panel shows Me to a non-manager)
    expect(initialPluginScope("rex", { id: "rex" }, "mcp")).toBe("workspace");
    expect(initialPluginScope("rex", { id: "rex" }, "apps")).toBe("bot");
  });

  it("reads the one marketplace list with installed meaning on this bot, linking nothing of the workspace", () => {
    const [market] = botScopeMarketplaces(view);
    expect(market.name).toBe("acme-tools");
    expect(market.plugins.map((plugin) => [plugin.name, plugin.installed])).toEqual([["reviewer", true], ["linter", false]]);
    expect(market.plugins.every((plugin) => plugin.servers.length === 0 && plugin.skills.length === 0)).toBe(true);
  });

  it("carries this bot's token flag and its own update offer", () => {
    const next: BotPluginsView = {
      ...view,
      marketplaces: [{ ...view.marketplaces[0]!, hasToken: true, plugins: [
        { name: "reviewer", version: "1.3.0", installedVersion: "1.2.0", updateAvailable: true, installed: true, external: false },
        { name: "linter", installed: false, external: true, updateAvailable: true },
      ] }],
    };
    const [market] = botScopeMarketplaces(next);
    expect(market.hasToken).toBe(true);
    expect(market.plugins[0]).toMatchObject({ installedVersion: "1.2.0", updateAvailable: true });
    // an update is only ever about an install
    expect(market.plugins[1]!.updateAvailable).toBeUndefined();
    expect(botScopeMarketplaces(view)[0]!.hasToken).toBeUndefined();
  });


  it("uses only the person's endpoint for Me, even for a workspace manager", () => {
    expect(marketplaceRoute({ workspaceManager: true, scope: "me", botView: view, personalView: view })).toBe("me");
    expect(marketplaceRoute({ workspaceManager: true, scope: "me", botView: view, personalView: null })).toBeNull();
  });

  it("finds a plugin row's state on the bot", () => {
    const reviewer = botPluginState(view, "reviewer@acme-tools");
    expect(reviewer).toMatchObject({ plugin: "reviewer", marketplace: "acme-tools", contents: { agents: ["critic"] } });
    expect(reviewer?.installed?.enabled).toBe(true);
    expect(botPluginState(view, "linter@acme-tools")).toMatchObject({ external: true, installed: null });
    expect(botPluginState(view, "ghost@acme-tools")).toBeNull();
    expect(botPluginState(null, "reviewer@acme-tools")).toBeNull();
  });

  it("routes marketplace changes: the workspace for its managers, the bot for its owner", () => {
    expect(marketplaceRoute({ workspaceManager: true, scope: "workspace", botView: view })).toBe("workspace");
    expect(marketplaceRoute({ workspaceManager: true, scope: "bot", botView: view })).toBe("bot");
    expect(marketplaceRoute({ workspaceManager: false, scope: "workspace", botView: view })).toBe("bot");
    expect(marketplaceRoute({ workspaceManager: false, scope: "bot", botView: { ...view, canChange: false } })).toBeNull();
    expect(marketplaceRoute({ workspaceManager: true, scope: "bot", botView: { ...view, canChange: false } })).toBe("workspace");
  });
});

describe("a marketplace's credential (Sources > GitHub, 2026-10-28)", () => {
  it("everyone's: picks one of the list, then fetches the marketplace again and keeps the listing the server sends", async () => {
    const calls: string[] = [];
    const lists: unknown[][] = [];
    const controls = marketplaceCredentialControls<{ name: string }>({
      route: "workspace",
      api: async (path, init) => {
        calls.push(`${init.method} ${path} ${init.body ?? ""}`);
        return { marketplaces: [{ name: "acme-private" }] };
      },
      run: async (busy, work) => { calls.push(`busy ${busy}`); await work(); return true; },
      loaded: (list) => { lists.push(list); },
    });
    expect(controls.scope).toBe("workspace");
    expect(await controls.onChoose("acme private", "gt_0000000000000001")).toBe(true);
    expect(await controls.onChoose("acme private", null)).toBe(true);
    expect(calls).toEqual([
      "busy refresh:acme private",
      "PUT /api/marketplaces/acme%20private/credential {\"credential\":\"gt_0000000000000001\"}",
      "POST /api/marketplaces/acme%20private/refresh {}",
      "busy refresh:acme private",
      "PUT /api/marketplaces/acme%20private/credential {\"credential\":null}",
      "POST /api/marketplaces/acme%20private/refresh {}",
    ]);
    expect(lists).toHaveLength(2);
  });

  it("a bot's: its own route, then Update on that bot", async () => {
    const calls: string[] = [];
    const views: unknown[] = [];
    const controls = marketplaceCredentialControls<{ name: string }>({
      route: "bot", botId: "bot-a",
      api: async (path, init) => { calls.push(`${init.method} ${path}`); return { marketplaces: [] }; },
      run: async (_busy, work) => { await work(); return true; },
      botLoaded: (view) => { views.push(view); },
    });
    expect(controls.scope).toBe("bot");
    await controls.onChoose("team", "gt_0000000000000002");
    expect(calls).toEqual(["PUT /api/bots/bot-a/plugins/marketplaces/team/credential", "POST /api/bots/bot-a/plugins/marketplaces/team/update"]);
    expect(views).toHaveLength(1);
  });
});
