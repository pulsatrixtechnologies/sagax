import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildPluginItems, type PluginItem } from "@/lib/plugins-model";
import { GROK_CLOUD_CONNECTORS } from "../../shared/grok-cloud-connectors";
import { grokConnectorDetail, grokRowAction, openGrokConnectors } from "./PluginsPanel";
import { ConnectAppsView, type ConnectAppsViewProps } from "./plugins/ConnectAppsView";
import { DiscoverView, type DiscoverViewProps } from "./plugins/DiscoverView";
import { discoverItems } from "@/lib/installed-model";
import { PluginDetailView } from "./plugins/PluginDetailView";
import { SkillPage } from "./plugins/SkillPage";

const items = buildPluginItems({
  servers: [{ name: "glitcho", enabled: true, url: "https://qc1.example.net/mcp", auth: "connected" }],
  featured: [{ id: "linear", name: "Linear", description: "Issues", url: "https://mcp.linear.app/mcp", domain: "linear.app", auth: "oauth" }],
  skills: [{ name: "release-notes", description: "Writes notes", source: "local-import", enabled: true }],
});
const noop = () => {};
vi.mock("@/state/store", () => ({ api: vi.fn(() => new Promise(() => {})), useStore: () => ({ state: {}, dispatch: vi.fn() }) }));

beforeEach(() => vi.stubGlobal("window", { addEventListener: noop, removeEventListener: noop }));
afterEach(() => vi.unstubAllGlobals());

describe("Plugins panel views", () => {
  const discoverProps: DiscoverViewProps = {
    items, filter: "all", onFilter: noop, type: "any", onType: noop,
    sourceLabel: (source: string) => source, onOpenItem: noop,
    renderAction: (item: PluginItem) => item.action ? createElement("button", { type: "button" }, item.action === "connect" ? "Connect" : "Add") : null,
  };
  const page = (overrides: Partial<ConnectAppsViewProps> = {}) => renderToStaticMarkup(createElement(ConnectAppsView, {
    tab: "discover", onTab: noop, counts: { installed: 2 }, refreshing: false, onRefresh: noop,
    discover: createElement(DiscoverView, discoverProps), installed: "INSTALLED", pages: "PAGES", sources: "SOURCES", ...overrides,
  }));

  it("one page: Plugins, then the three tabs (Installed, Discover, Sources; #2104) with Installed first, the count on Installed", () => {
    const html = page();
    expect(html).toMatch(/id="plugins-title"[^>]*>Plugins<\/h2>/);
    expect(html).not.toContain("data-plugins-connected");
    // no breadcrumb and no "Manage plugins and skills" page
    expect(html).not.toContain("data-breadcrumb");
    expect(html).not.toContain("Manage plugins and skills");
    expect(html).toMatch(/aria-label="Installed, 2 connected"[^>]*data-plugins-tab="installed"/);
    const tabs = [...html.matchAll(/role="tab"[^>]*data-plugins-tab="([a-z]+)"[^>]*><span data-plugins-tab-label="[^"]*">([^<]+)</g)].map((match) => [match[1], match[2]]);
    expect(tabs).toEqual([["installed", "Installed"], ["discover", "Discover"], ["sources", "Sources"]]);
    expect(html).toMatch(/aria-selected="true"[^>]*data-plugins-tab="discover"/);
    // one search (2026-10-29): under the title, above the tabs; none in Discover
    const searched = page({ search: createElement("input", { "data-plugins-search": "", placeholder: "ONE SEARCH" }) });
    expect(searched).toMatch(/id="plugins-title"[\s\S]*?data-plugins-search-slot[\s\S]*?ONE SEARCH[\s\S]*?role="tablist"/);
    // and on the scope's line, on its right (2026-10-29)
    const both = page({ scope: createElement("div", null, "SCOPE"), search: createElement("input", { "data-plugins-search": "" }) });
    expect(both).toMatch(/data-plugins-scope-row[^>]*>[\s\S]*?data-plugins-scope-slot[\s\S]*?SCOPE[\s\S]*?data-plugins-search-slot[\s\S]*?<input/);
    expect(searched.match(/data-plugins-search=""/g)).toHaveLength(1);
    // with text, the results take the tab's place
    const results = page({ results: "RESULTS" });
    expect(results).toContain("data-plugins-results");
    expect(results).toContain("RESULTS");
    expect(results).not.toContain("data-plugins-discover");
    // Bots: a pane of its own, with its own title and no tab row (#2104)
    const bots = page({ tab: "bots", bots: "BOTS", onBack: noop });
    expect(bots).toContain("BOTS");
    expect(bots).toMatch(/id="plugins-title"[^>]*>Bots<\/h2>/);
    expect(bots).toMatch(/data-plugins-manage="bots"/);
    expect(bots).not.toContain('role="tablist"');
    expect(bots).toContain("data-apps-back");
    expect(bots).not.toMatch(/data-plugins-list=""[^>]*data-plugins-manage="bots"/);
    expect(html).not.toContain("INSTALLED");
    expect(page({ tab: "sources" })).toContain("SOURCES");
    // a tab left out is not drawn; a tab not offered falls back to Installed
    const noSources = page({ tabs: ["installed", "discover"], tab: "sources" });
    expect(noSources).not.toContain('data-plugins-tab="sources"');
    expect(noSources).toMatch(/aria-selected="true"[^>]*data-plugins-tab="installed"/);
  });

  it("Discover: no search of its own, every category pill and no Browse Bots button, sections of two-column rows", () => {
    const html = renderToStaticMarkup(createElement(DiscoverView, discoverProps));
    expect(html).not.toContain("placeholder=");
    expect(html).not.toContain("data-plugins-search");
    expect(html).not.toContain("Browse Bots");
    const chips = [...html.matchAll(/data-plugins-chip="([^"]+)"/g)].map((match) => match[1]);
    expect(chips[0]).toBe("all");
    expect(html).not.toContain("data-plugins-more");
    expect(html).toContain('data-plugins-section="recommended"');
    expect(html).toContain("Recommended for you");
    expect(html).toContain("md:grid-cols-2");
    expect(html).toMatch(/data-plugin-row="featured:linear"[\s\S]*?>Connect</);
    expect(html).not.toContain("data-plugins-browse-bots");
    expect(html).not.toMatch(/Browse bots/i);
  });

  it("Discover leaves out what is installed and the engines' connectors, keeps an app a conversation needs until it connects", () => {
    const rows = buildPluginItems({
      servers: [{ name: "glitcho", enabled: true, url: "https://qc1.example.net/mcp", auth: "connected" }],
      featured: [
        { id: "linear", name: "Linear", description: "Issues", url: "https://mcp.linear.app/mcp", domain: "linear.app", auth: "oauth" },
      ],
      grok: { connectors: GROK_CLOUD_CONNECTORS, description: "Not verifiable: Grok catalog" },
    });
    const keys = discoverItems(rows).map((item) => item.key);
    expect(keys).toContain("featured:linear");
    expect(keys).not.toContain("mcp:glitcho");
    expect(keys.some((key) => key.startsWith("grok:"))).toBe(false);
  });

  it("skill page: header, Delete Skill in red, the description, then Name, Description, Instructions and Save", () => {
    const skill = { name: "release-notes", description: "Writes notes", source: "local-import", enabled: true, tags: [], version: null, importedAt: "2026-10-08T00:00:00Z", warnings: [], assignedBots: [] };
    const html = renderToStaticMarkup(createElement(SkillPage, { skill, onBack: noop, onSaved: noop, onDeleted: noop }));
    expect(html).toContain("Private skill");
    expect(html).toMatch(/data-skill-delete[^>]*class="[^"]*text-danger[^"]*"[\s\S]*?Delete Skill/);
    expect(html).not.toContain("Publish");
    expect(html).toContain("Writes notes");
    for (const field of ["name", "description", "instructions"]) expect(html).toContain(`data-skill-field="${field}"`);
    expect(html).toMatch(/type="submit"[^>]*>Save</);
    const readOnly = renderToStaticMarkup(createElement(SkillPage, { skill, readOnlyReason: "The plugin kit brought this skill: uninstall the plugin to remove it.", onBack: noop, onSaved: noop, onDeleted: noop }));
    expect(readOnly).not.toContain("Delete Skill");
    expect(readOnly).not.toContain('type="submit"');
  });

  it("detail page: the switch and one \"...\" menu by the name, accounts, collapsible tools, details", () => {
    const item = items.find((entry) => entry.key === "mcp:glitcho")!;
    const html = renderToStaticMarkup(createElement(PluginDetailView, {
      item, subtitle: "https://qc1.example.net/mcp", busy: false, onBack: noop, onUninstall: noop,
      enabled: { value: true, onToggle: noop, label: "Turn glitcho off" },
      accounts: [{ id: "oauth", label: "qc1.example.net", status: "connected" }],
      tools: { list: [{ name: "search", enabled: true }, { name: "delete", enabled: false }], loading: false, onToggle: noop },
      details: [{ label: "Source", value: "Added manually" }, { label: "Transport", value: "HTTP" }],
    }));
    expect(html).toContain('aria-label="Back"');
    // Turned on beside the name; Update, Test, Edit and Uninstall wait in the menu
    expect(html).toMatch(/data-plugin-enabled[^>]*>Turned on<button[^>]*aria-label="Turn glitcho off"/);
    expect(html).toContain('aria-label="More actions for glitcho"');
    expect(html).not.toContain("Uninstall");
    expect(html).toContain("Accounts");
    expect(html).toMatch(/qc1\.example\.net[\s\S]*?Connected/);
    expect(html).toContain("1 of 2 enabled");
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("Added manually");
    expect(html).toContain("HTTP");
  });

  it("xAI connectors are a catalog managed on Grok: no connect action or status, a Grok link, a separate row", () => {
    const withGrok = buildPluginItems({
      grok: { connectors: GROK_CLOUD_CONNECTORS, description: "Not verifiable: Grok catalog" },
    });
    const html = renderToStaticMarkup(createElement(DiscoverView, {
      items: withGrok, filter: "all", onFilter: noop, type: "any", onType: noop,
      sourceLabel: (source) => source, onOpenItem: noop,
      renderAction: (item) => grokRowAction(item) ?? (item.action ? createElement("button", { type: "button" }, "Connect") : null),
    }));
    const row = (key: string) => {
      const start = html.indexOf(`data-plugin-row="${key}"`);
      expect(start).toBeGreaterThan(-1);
      const next = html.indexOf("data-plugin-row=", start + 1);
      return html.slice(start, next === -1 ? undefined : next);
    };
    const grokGmail = row("grok:gmail");
    expect(grokGmail).toContain("data-grok-manage");
    expect(grokGmail).toContain("Manage on Grok");
    expect(grokGmail).not.toContain("data-plugin-status");
    expect(grokGmail).not.toContain(">Connect<");

    const detail = renderToStaticMarkup(createElement(PluginDetailView, {
      ...grokConnectorDetail(withGrok.find((item) => item.key === "grok:gmail")!), onBack: noop,
    }));
    expect(detail).toContain("Not verifiable: Grok catalog");
    expect(detail).toContain("Grok (xAI)");
    expect(detail).toContain("data-grok-manage");
    expect(detail).not.toContain("No account needed");
    expect(detail).not.toContain('data-plugin-status="connected"');
  });

  it("Manage on Grok opens grok.com/connectors: the desktop bridge, the window's link path when the bridge refuses, an error to show when neither opens", async () => {
    const desktop = vi.fn(async () => true);
    const open = vi.fn();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubGlobal("window", { addEventListener: noop, removeEventListener: noop, ogb: { openExternal: desktop }, open });
    expect(await openGrokConnectors()).toBeNull();
    expect(desktop).toHaveBeenCalledWith("https://grok.com/connectors");
    expect(open).not.toHaveBeenCalled();
    vi.stubGlobal("window", { addEventListener: noop, removeEventListener: noop, ogb: { openExternal: vi.fn(async () => { throw new Error("not this window"); }) }, open });
    expect(await openGrokConnectors()).toBeNull();
    expect(open).toHaveBeenCalledWith("https://grok.com/connectors", "_blank", "noopener,noreferrer");
    vi.stubGlobal("window", { addEventListener: noop, removeEventListener: noop, open: vi.fn(() => { throw new Error("blocked"); }) });
    expect(await openGrokConnectors()).toBe("This link cannot be opened from here.");
    warn.mockRestore();
  });
});
