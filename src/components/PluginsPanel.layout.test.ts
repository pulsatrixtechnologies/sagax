import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildPluginItems, type PluginItem } from "@/lib/plugins-model";
import { GROK_CLOUD_CONNECTORS } from "../../shared/grok-cloud-connectors";
import { grokConnectorDetail, grokRowAction, openGrokConnectors } from "./PluginsPanel";
import { ConnectAppsView, type ConnectAppsViewProps } from "./plugins/ConnectAppsView";
import { PageHostProvider } from "./page-host";
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
    tab: "discover", onTab: noop, kind: "connectors", kindCounts: { skills: 3, connectors: 2, plugins: 0 }, refreshing: false, onRefresh: noop,
    discover: createElement(DiscoverView, discoverProps), installed: "INSTALLED", pages: "PAGES", sources: "SOURCES", ...overrides,
  }));

  // #4420 review: as a page of the bot page (bg-app ground), a row of the
  // window kept the window's tinted ground (bg-inset), a grey strip wider
  // than the column's text edge. #4453: the head is no longer a sticky strip
  // at all: nothing of it paints the window's tint, in a window or a page.
  it("regression #4420: under a host page no strip of the window's tint", () => {
    const search = createElement("input", { "data-plugins-search": "" });
    const hosted = renderToStaticMarkup(createElement(PageHostProvider, { value: { header: null } }, createElement(ConnectAppsView, {
      tab: "discover", onTab: noop, refreshing: false, onRefresh: noop, search,
      discover: "DISCOVER", installed: "INSTALLED", pages: "PAGES", sources: "SOURCES",
    })));
    expect(hosted).not.toContain("bg-inset");
    expect(page({ search })).not.toContain("bg-inset");
  });

  it("#4453: Connect Apps is three kind tabs with their counts, Yours and Discover, the scope, the one search and Add; Bots, Pages and Sources under \"...\"", () => {
    const html = page({ tab: "installed", search: createElement("input", { "data-plugins-search": "", placeholder: "ONE SEARCH" }), manageActions: createElement("button", { "data-test-add": "" }) });
    expect(html).toMatch(/id="plugins-title"[^>]*>Connect Apps<\/h2>/);
    expect(html).not.toContain("Manage plugins and skills");
    // the kinds, in the reference's order, the chosen one pressed, a count only where there is one
    expect([...html.matchAll(/data-plugins-kind-tab="([a-z]+)"/g)].map((match) => match[1])).toEqual(["skills", "connectors", "plugins"]);
    expect(html).toMatch(/role="tab" aria-selected="true" data-plugins-kind-tab="connectors"/);
    expect(html).toMatch(/data-plugins-kind-tab="skills"[^>]*>Skills<span[^>]*data-plugins-kind-count="3">3</);
    expect(html).not.toContain('data-plugins-kind-count="0"');
    // the search and the one Add on the kinds' row; Yours, Discover, the scope and the refresh under it
    expect(html).toMatch(/data-plugins-kind-row[\s\S]*?data-plugins-search-slot[\s\S]*?ONE SEARCH[\s\S]*?data-test-add/);
    expect(html.match(/data-plugins-search=""/g)).toHaveLength(1);
    expect(html).toMatch(/data-plugins-view-row[\s\S]*?data-plugins-refresh[\s\S]*?data-plugins-view="installed"[^>]*>Yours<[\s\S]*?data-plugins-view="discover"[^>]*>Discover</);
    // #4453 (2026-11-16): no scope control in the header: it is chosen on the item
    expect(html).not.toContain("data-plugins-scope-slot");
    expect(html).not.toContain("SCOPE");
    // one row of controls: underlined tabs (not pills), the search, Add
    expect(html).toMatch(/data-plugins-kinds=""[\s\S]*?after:h-0\.5/);
    for (const tab of html.matchAll(/data-plugins-kind-tab="[a-z]+"[^>]*class="([^"]*)"/g)) expect(tab[1]).not.toMatch(/(^|\s)bg-/);
    expect(html).toMatch(/role="radio" aria-checked="true" data-plugins-view="installed"/);
    expect(html).toContain("INSTALLED");
    // the title row stays out of the list, which alone scrolls
    expect(html.indexOf("data-plugins-title-row")).toBeLessThan(html.indexOf("data-plugins-list"));
    // Bots, Pages and Sources: the "..." of the title bar, never a tab
    expect(html).toContain("data-plugins-more-button");
    expect(html).not.toContain("data-plugins-bot-templates");
    expect(html).not.toContain("data-plugins-connected");
    // Discover: the same head, its list
    const discover = page({});
    expect(discover).toContain("data-plugins-discover");
    expect(discover).toMatch(/role="radio" aria-checked="true" data-plugins-view="discover"/);
    // the filter button of Discover sits on the same row when the panel gives one
    const filtered = page({ search: createElement("input"), filterControl: createElement("button", { "data-test-filter": "" }) });
    expect(filtered).toMatch(/data-plugins-search-slot[\s\S]*?data-test-filter[\s\S]*?data-plugins-view-row/);
    // ...and Yours has none
    expect(page({ tab: "installed", filterControl: createElement("button", { "data-test-filter": "" }) })).not.toContain("data-test-filter");
    // with text, the results take the list's place
    const results = page({ results: "RESULTS" });
    expect(results).toContain("data-plugins-results");
    expect(results).toContain("RESULTS");
    expect(results).not.toContain("data-plugins-discover");
    // Bots: its pane under the back bar to Connect Apps, no scope
    const bots = page({ tab: "bots", bots: "BOTS" });
    expect(bots).toContain("BOTS");
    expect(bots).toMatch(/data-plugins-manage="bots"/);
    expect(bots).toMatch(/data-plugins-home[^>]*>[\s\S]*?Connect Apps/);
    expect(bots).not.toContain("data-apps-back");
    expect(page({ tab: "sources" })).toContain("SOURCES");
    expect(page({ tab: "pages" })).toContain("PAGES");
    // no view past Yours and Discover: no "..."
    expect(page({ tabs: ["installed", "discover"], tab: "installed" })).not.toContain("data-plugins-more-button");
  });

  it("Discover: no search of its own, every category pill and no Browse Bots button, sections in the card grid (#2948)", () => {
    const html = renderToStaticMarkup(createElement(DiscoverView, discoverProps));
    expect(html).not.toContain("placeholder=");
    expect(html).not.toContain("data-plugins-search");
    expect(html).not.toContain("Browse Bots");
    // #4453: the categories are no row of pills: they live in the filter button of the header
    expect(html).not.toContain("data-plugins-chip=");
    expect(html).not.toContain("data-plugins-more-chips");
    expect(html).toContain('data-plugins-section="recommended"');
    expect(html).toContain("Recommended for you");
    // two columns of borderless rows, one when the list is narrow (#4097)
    expect(html).toContain("@container grid grid-cols-2");
    expect(html).not.toContain("auto-fill");
    expect(html).toMatch(/data-plugin-row="featured:linear"[\s\S]*?>Connect</);
    expect(html).not.toContain("data-plugins-browse-bots");
    expect(html).not.toMatch(/Browse bots/i);
  });

  it("Recommended for you is the first section, with each pick's why on the shared row (#4207); no From Sagax (#4453)", () => {
    const rows = buildPluginItems({
      featured: [
        { id: "linear", name: "Linear", description: "Issues", url: "https://mcp.linear.app/mcp", domain: "linear.app", auth: "oauth" },
        { id: "slack", name: "Slack", description: "Channels", url: "https://mcp.slack.com/mcp", domain: "slack.com", auth: "oauth" },
        { id: "stripe", name: "Stripe", description: "Payments", url: "https://mcp.stripe.com", domain: "stripe.com", auth: "oauth" },
      ],
      tailscale: { description: "Private network", connected: false },
    });
    const html = renderToStaticMarkup(createElement(DiscoverView, {
      ...discoverProps, items: rows, owned: ["Stripe"],
    }));
    const sections = [...html.matchAll(/data-plugins-section="([^"]+)"/g)].map((match) => match[1]);
    expect(sections[0]).toBe("recommended");
    expect(sections).not.toContain("from-sagax");
    expect(html.indexOf("data-plugins-chips")).toBeLessThan(html.indexOf('data-plugins-section="recommended"'));
    const after = html.indexOf("data-plugins-section=", html.indexOf('data-plugins-section="recommended"') + 1);
    const shelf = html.slice(html.indexOf('data-plugins-section="recommended"'), after < 0 ? undefined : after);
    // the basics first (chat before tickets), what the person has left out, the private network tool not picked
    expect([...shelf.matchAll(/data-plugin-row="([^"]+)"/g)].map((match) => match[1])).toEqual(["featured:slack", "featured:linear"]);
    expect(shelf).toContain("Reads and posts in your team&#x27;s chat and meetings");
    expect(shelf).toMatch(/title="Channels"/);
    expect(shelf).toMatch(/>Connect</);
    // an account connector counts only once connected: one waiting for a sign-in leaves chat open
    const teams = (status: "connected" | "needs_auth") => [{
      group: { id: "claude" as const, name: "Claude", source: "From Anthropic", manageUrl: "", connectors: [] },
      rows: [{ key: "claude:Microsoft Teams", engine: "claude" as const, provider: "Claude", name: "Microsoft Teams", status, manageUrl: "", category: "communication" as const, capabilities: ["teams" as const] }],
    }];
    const shelfOf = (markup: string) => {
      const start = markup.indexOf('data-plugins-section="recommended"');
      const end = markup.indexOf("data-plugins-section=", start + 1);
      return [...markup.slice(start, end < 0 ? undefined : end).matchAll(/data-plugin-row="([^"]+)"/g)].map((match) => match[1]);
    };
    expect(shelfOf(renderToStaticMarkup(createElement(DiscoverView, { ...discoverProps, items: rows, owned: ["Stripe"], accounts: teams("needs_auth") })))).toContain("featured:slack");
    expect(shelfOf(renderToStaticMarkup(createElement(DiscoverView, { ...discoverProps, items: rows, owned: ["Stripe"], accounts: teams("connected") })))).not.toContain("featured:slack");
    // nothing left to recommend: no section at all
    const none = renderToStaticMarkup(createElement(DiscoverView, { ...discoverProps, items: rows, owned: ["Slack", "Linear", "Stripe"] }));
    expect(none).not.toContain('data-plugins-section="recommended"');
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
    expect(html).toMatch(/data-skill-publish[\s\S]*?Publish/);
    expect(html).toContain("Writes notes");
    for (const field of ["name", "description", "instructions"]) expect(html).toContain(`data-skill-field="${field}"`);
    expect(html).toMatch(/type="submit"[^>]*>Save</);
    // nothing changed yet: Save is off
    expect(html).toMatch(/type="submit"[^>]*disabled=""/);
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
    expect(html).toContain('aria-label="Back to Connect Apps"');
    // Turned on beside the name; Uninstall is the reference app's gray pill under the page,
    // and with no Update, Test or Edit there is no "..." menu
    expect(html).toMatch(/data-plugin-enabled[^>]*>Turned on<button[^>]*aria-label="Turn glitcho off"/);
    expect(html).toMatch(/data-plugin-action="uninstall"[^>]*>Uninstall</);
    expect(html).not.toContain('aria-label="More actions for glitcho"');
    const withEdit = renderToStaticMarkup(createElement(PluginDetailView, { item, subtitle: "", busy: false, onBack: noop, onUninstall: noop, onEdit: noop, details: [] }));
    expect(withEdit).toContain('aria-label="More actions for glitcho"');
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
