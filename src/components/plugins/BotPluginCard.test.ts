// Capabilities in a bot's scope: the scope toggle, the "For <bot>" card on a
// plugin's detail page, the marketplace rows' remove rule, and the bot
// panel's Library without its old Plugins tab (rerouted to Capabilities).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";
import type { BotPluginsView } from "@/lib/my-connections";
import { botPluginState } from "@/lib/plugin-scope";
import { openBotPlugins } from "../bot-settings/LibraryTab";
import { BotPluginCard } from "./BotPluginCard";
import { MarketplacesSection } from "./MarketplacesSection";
import { ScopeToggle } from "./ScopeToggle";

afterEach(() => setLocale("en"));

const view: BotPluginsView = {
  marketplaces: [{
    name: "acme-tools", source: "acme/tools", addedAt: 1, updatedAt: 1,
    plugins: [
      { name: "reviewer", description: "Reviews code", installed: true, external: false, contents: { agents: ["critic"], commands: ["review"], skills: [] } },
      { name: "linter", installed: false, external: false, contents: { agents: [], commands: [], skills: [] } },
    ],
  }],
  plugins: [{ key: "reviewer@acme-tools", name: "reviewer", marketplace: "acme-tools", enabled: true, removed: ["hooks"], declaredMcpServers: ["db"] }],
  policy: { mode: "any" },
  engine: { loadsPlugins: true },
  canChange: true,
};

function card(next: BotPluginsView, id = "reviewer@acme-tools"): string {
  const plugin = botPluginState(next, id);
  if (!plugin) throw new Error(`no ${id}`);
  return renderToStaticMarkup(createElement(BotPluginCard, { botName: "Maya", view: next, plugin, busy: null, onInstall: () => {}, onToggle: () => {}, onUninstall: () => {} }));
}

describe("scope toggle", () => {
  it("offers This bot, Me and Organization with the current scope checked", () => {
    const html = renderToStaticMarkup(createElement(ScopeToggle, { scope: "bot", botName: "Maya", onScope: () => {} }));
    expect(html).toContain('data-plugins-scope="bot"');
    expect(html).toContain("Organization");
    expect(html).toContain("Me");
    expect(html).toContain("This bot");
    expect(html).toMatch(/aria-checked="true" data-plugins-scope-option="bot"/);
  });

  it("speaks French", () => {
    setLocale("fr");
    const html = renderToStaticMarkup(createElement(ScopeToggle, { scope: "workspace", botName: "Maya", onScope: () => {} }));
    expect(html).toContain("Organisation");
    expect(html).toContain("Moi");
    expect(html).toContain("Ce bot");
  });
});

describe("For <bot> on a plugin's page", () => {
  it("lists the agents and commands installed on the bot and lets its owner switch, update or remove it", () => {
    const html = card(view);
    expect(html).toContain('data-bot-plugin-installed="yes"');
    expect(html).toContain("critic");
    expect(html).toContain("review");
    expect(html).toContain("Left out: hooks");
    expect(html).toContain("Declared MCP servers: db");
    expect(html).toContain("data-bot-plugin-uninstall");
    expect(html).toContain("Remove from Maya");
  });

  it("offers the install on the bot for a plugin it does not have", () => {
    const html = card(view, "linter@acme-tools");
    expect(html).toContain('data-bot-plugin-installed="no"');
    expect(html).toContain("Install for Maya");
    expect(html).toContain("This plugin brings no agent, command or skill.");
    expect(html).not.toContain("data-bot-plugin-uninstall");
  });

  it("is read-only for a person who only uses the bot", () => {
    const html = card({ ...view, canChange: false, engine: { loadsPlugins: false } });
    expect(html).toContain("Only the bot&#x27;s owner, or someone who manages it");
    expect(html).toContain("This engine does not load plugins itself.");
    expect(html).toContain("skills_list and workspace_read");
    expect(html).toContain("Organization Flow stays Claude-only.");
    expect(html).not.toContain("data-bot-plugin-install=\"");
    expect(html).not.toContain("data-bot-plugin-uninstall");
  });
});

describe("one marketplace list, two scopes", () => {
  const market = { name: "acme-tools", source: "acme/tools", plugins: [{ name: "reviewer", installed: false }], bots: 2 };
  const props = { busy: null, error: null, onAdd: async () => true, onRefresh: () => {}, onRemove: () => {} };

  it("keeps a marketplace bots use on the workspace route, and says why", () => {
    const html = renderToStaticMarkup(createElement(MarketplacesSection, { ...props, marketplaces: [market] }));
    expect(html).toMatch(/disabled=""[^>]*data-marketplace-remove="acme-tools"/);
    expect(html).toContain("Bots still use it (2)");
  });

  it("lets the bot route remove it from that bot, plugins and all", () => {
    const html = renderToStaticMarkup(createElement(MarketplacesSection, { ...props, marketplaces: [{ ...market, plugins: [{ name: "reviewer", installed: true }] }], removeKeepsInstalls: true }));
    expect(html).not.toMatch(/disabled=""[^>]*data-marketplace-remove="acme-tools"/);
  });

  it("has no token field any more: each marketplace picks a credential of the list, or Automatic, and says which one read it", () => {
    const credentials = { onChoose: async () => true };
    expect(renderToStaticMarkup(createElement(MarketplacesSection, { ...props, marketplaces: [market] }))).not.toContain("data-marketplace-credential=");
    const html = renderToStaticMarkup(createElement(MarketplacesSection, {
      ...props, credentials,
      marketplaces: [{ ...market, hasToken: true, credential: { chosen: { id: "gt_0000000000000001", label: "Other organization", owner: "mine" as const }, used: { via: "credential" as const, label: "Other organization", at: 1 } } }],
    }));
    expect(html).toContain("data-marketplace-credential=\"acme-tools\"");
    expect(html).toContain("Automatic");
    expect(html).toMatch(/value="gt_0000000000000001"[^>]*selected|selected=""[^>]*value="gt_0000000000000001"/);
    expect(html).toContain("Read with Other organization");
    expect(html).not.toContain("type=\"password\"");
    const person = renderToStaticMarkup(createElement(MarketplacesSection, { ...props, credentials, marketplaces: [{ ...market, credential: { used: { via: "person" as const, login: "someone", at: 1 } } }] }));
    expect(person).toContain("Read with your GitHub account (@someone)");
  });

  it("points at the pick where the git host refused, and offers one for an add", () => {
    const credentials = { scope: "workspace" as const, onChoose: async () => true };
    const html = renderToStaticMarkup(createElement(MarketplacesSection, { ...props, marketplaces: [market], credentials, needsToken: "acme-tools" }));
    expect(html).toContain("data-marketplace-token=\"acme-tools\"");
    expect(html).toContain("for everyone");
  });
});

describe("bot panel > Library", () => {
  it("opens Capabilities on that bot's scope", () => {
    const dispatch = vi.fn();
    openBotPlugins(dispatch, "maya");
    expect(dispatch).toHaveBeenCalledWith({ type: "togglePlugins", open: true, botId: "maya" });
  });
});
