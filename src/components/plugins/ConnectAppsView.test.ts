// @vitest-environment happy-dom
// Plugins (#2104, 2026-11-06: the reference app's Connect Apps, look for look). The
// home is the catalogue (title, "N connected" opening Manage, the round
// search, From Sagax, categories); Manage ("Manage plugins and skills")
// lists what is installed, one line per installed thing with a "..." menu,
// every empty section hidden. Bots, Pages and Sources open alone under a
// "< Plugins" back row; every GitHub setting stays in Sources (the
// organization's part for an admin only, as before).
import { act, createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLocale, t } from "@/lib/i18n";
import { capabilityFixture } from "@/lib/capabilities.fixture";
import { buildPluginItems } from "@/lib/plugins-model";
import { installedEntries, privateSkills } from "@/lib/installed-model";
import { GROK_CLOUD_CONNECTORS } from "../../../shared/grok-cloud-connectors";
import { bringsLabel, InstalledView, type InstalledViewProps } from "./InstalledView";
import { ConnectAppsSearchField } from "./ConnectAppsSearch";
import { ConnectAppsView, DiscoverFilter, SortControl, sortRows, normalizeConnectAppsTab, isProvidersLink, CONNECT_APPS_TABS, SCOPELESS_TABS, connectAppsTabLabel } from "./ConnectAppsView";
import { accountConnectorRows, connectedAccountRows, connectorGroups, noticeAction, type HarnessConnectorGroup, type RegistryGrokAccount } from "./HarnessConnectorGroups";
import type { HarnessAnswer } from "../PluginsPanel.tsx-parts/types";
import { DiscoverView } from "./DiscoverView";
import { AccountsView } from "./AccountsView";
import { SourcesView } from "./SourcesView";
import { botServersAfter, botUsesServers } from "./BotsForView";

vi.mock("@/state/store", () => ({ api: vi.fn(() => new Promise(() => {})), useStore: () => ({ state: {}, dispatch: vi.fn() }) }));

const servers = [
  { name: "twilio-docs", enabled: true, url: "https://mcp.twilio.com/docs", source: "twilio" },
  { name: "github", enabled: true, url: "https://api.githubcopilot.com/mcp/" },
  { name: "github-github", enabled: true, url: "https://api.githubcopilot.com/mcp/", source: "claude-plugins-official" },
];
const items = buildPluginItems({
  servers,
  skills: [{ name: "weekly-summary", description: "Mine", source: "local-import", enabled: true }],
  marketplaces: [{ name: "claude-plugins-official", plugins: [{ name: "github", installed: true, servers: ["github-github"], skills: [], updateAvailable: true }] }],
});
const noop = () => {};

function props(overrides: Partial<InstalledViewProps> = {}): InstalledViewProps {
  return {
    entries: installedEntries(items), skills: privateSkills(items),
    sourceLabel: (source) => source, onOpenEntry: noop, onOpenSkill: noop, entryActions: () => ({ remove: noop }),
    onDiscover: noop, ...overrides,
  };
}
const ManageView = InstalledView;

beforeEach(() => setLocale("en"));
afterEach(() => setLocale("en"));

describe("Plugins tabs", () => {
  const shell = (tab: "installed" | "discover" | "bots" | "pages" | "sources") => renderToStaticMarkup(createElement(ConnectAppsView, {
    tab, onTab: noop, refreshing: false, onRefresh: noop,
    installed: createElement(InstalledView, props()), discover: "D", bots: "B", pages: "G", sources: "S",
  }));

  it("#4453: one head on Yours and Discover: the title, \"...\", the kinds (underlined tabs), the search, Add, then the view; no scope", () => {
    for (const tab of ["installed", "discover"] as const) {
      const html = renderToStaticMarkup(createElement(ConnectAppsView, {
        tab, onTab: noop, refreshing: false, onRefresh: noop, kind: "skills",
        search: createElement("input", { "data-plugins-search": "" }),
        manageActions: createElement("button", { "data-test-add": "" }), installed: "I", discover: "D",
      }));
      expect(html).toMatch(/id="plugins-title"[^>]*>Connect Apps</);
      // the title is never cut (French at phone width, #4153)
      const title = html.match(/<h2 [^>]*id="plugins-title"[^>]*>/)?.[0] ?? "";
      expect(title).not.toMatch(/\btruncate\b|\bline-clamp|\bwhitespace-nowrap\b/);
      // the title line keeps the title and "..."; ONE row under it: the kinds (no counts), a separator,
      // Yours | Discover, then the search, Add (the owner's layout, 2026-11-16)
      expect(html).toMatch(/id="plugins-title"[\s\S]*?data-plugins-more-button[\s\S]*?role="tablist"[\s\S]*?data-plugins-separator[\s\S]*?data-plugins-views[\s\S]*?data-plugins-search-slot[\s\S]*?data-test-add/);
      expect(html).not.toContain("data-plugins-view-row");
      expect(html).not.toContain("data-plugins-kind-count");
      expect(html).not.toMatch(/aria-label="Refresh/);
      expect(html).not.toContain("data-plugins-scope-slot");
      expect(html).toContain(tab === "installed" ? ">I<" : ">D<");
      expect(html).not.toContain("Manage plugins and skills");
    }
  });

  it("Bots, Pages and Sources: the back row, the title row and its pills sit outside the scrolling list (#2948)", () => {
    for (const tab of ["pages", "sources"] as const) {
      const host = document.createElement("div");
      document.body.append(host);
      const root = createRoot(host);
      flushSync(() => root.render(createElement(ConnectAppsView, {
        tab, onTab: noop, refreshing: false, onRefresh: noop,
        installed: "I", pages: "G", sources: "S",
      })));
      const bar = host.querySelector("[data-plugins-manage-bar]");
      const titleRow = host.querySelector("[data-plugins-title-row]");
      const list = host.querySelector("[data-plugins-list]");
      expect(titleRow?.querySelector("#plugins-title")).toBeTruthy();
      expect(titleRow?.querySelector("[data-plugins-scope-slot]")).toBeNull();
      // bar, then the title row, then the list: siblings, the list alone scrolls
      expect(bar?.nextElementSibling).toBe(titleRow);
      expect(titleRow?.className).toContain("shrink-0");
      expect(list?.contains(titleRow!)).toBe(false);
      expect(list?.querySelector("#plugins-title")).toBeNull();
      expect(list?.className).toContain("overflow-y-auto");
      // no hairline at rest (it shows once the list moves)
      expect(titleRow?.hasAttribute("data-plugins-stuck")).toBe(false);
      root.unmount();
      host.remove();
    }
    // Yours too: its head stays out of the list
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    flushSync(() => root.render(createElement(ConnectAppsView, { tab: "installed", onTab: noop, refreshing: false, onRefresh: noop, installed: "I" })));
    const titleRow = host.querySelector("[data-plugins-title-row]");
    expect(titleRow?.className).toContain("shrink-0");
    expect(host.querySelector("[data-plugins-list]")?.contains(titleRow!)).toBe(false);
    root.unmount();
    host.remove();
  });

  it("Installed, the private skills and This Mac are the reference's two columns of borderless rows, nothing dropped (#4097)", () => {
    const html = renderToStaticMarkup(createElement(InstalledView, props()));
    const lists = [...html.matchAll(/<ul class="([^"]+)"/g)].map((match) => match[1]!);
    expect(lists.length).toBeGreaterThanOrEqual(2);
    for (const list of lists) {
      // two columns, one when the list itself is under 560px (a container query)
      expect(list).toContain("@container");
      expect(list).toContain("grid-cols-2");
      expect(list).toContain("*:@max-[560px]:col-span-full");
      // borderless rows: 16px corners, 12px sides, a wash on hover, no card border
      expect(list).toContain("*:rounded-2xl");
      expect(list).toContain("*:px-3");
      expect(list).not.toContain("border");
      expect(list).not.toContain("auto-fill");
    }
    // each card keeps its name, what it brings and its "..." menu
    expect(html).toContain("data-installed-brings");
    expect(html).toContain("data-plugin-skill");
  });

  it("Bots and Pages open alone under \"< Plugins\"; the home keeps the one search (#2104)", () => {
    for (const tab of ["bots", "pages"] as const) {
      const html = renderToStaticMarkup(createElement(ConnectAppsView, {
        tab, onTab: noop, refreshing: false, onRefresh: noop,
        search: createElement("input", { "data-plugins-search": "" }), bots: "BOTS", pages: "PAGES",
      }));
      expect(html).toContain("data-plugins-home");
      expect(html).toMatch(new RegExp(`data-plugins-main="${tab}"`));
      expect(html).toContain(tab === "bots" ? "BOTS" : "PAGES");
      // the install scope has no say on these views
      expect(html).not.toContain("data-test-scope");
    }
    const home = shell("discover");
    expect(home).toContain("D");
  });

  it("Installed lists the engine accounts in a section of its own, after the entries and the skills, without a Providers title", () => {
    const html = renderToStaticMarkup(createElement(InstalledView, props({ providers: createElement("div", { "data-test-provider": "" }, "PROVIDER ROWS") })));
    expect(html).toMatch(/data-plugins-installed[\s\S]*?data-plugins-skills[\s\S]*?data-plugins-providers[\s\S]*?PROVIDER ROWS/);
    expect(html).not.toContain(">Providers<");
    expect(renderToStaticMarkup(createElement(InstalledView, props()))).not.toContain("data-plugins-providers");
  });

  it("one + Add menu holds every way to add by hand (#2104)", () => {
    const picked: string[] = [];
    const add = ["server", "paste", "skill"].map((id) => ({ id, label: id.toUpperCase(), onPick: () => picked.push(id) }));
    const html = renderToStaticMarkup(createElement(InstalledView, props({ add })));
    expect(html.match(/ data-plugins-add="true"/g)).toHaveLength(1);
    expect(html).not.toContain("data-plugins-add-action");
    expect(html).not.toContain("data-plugins-add-server");
    expect(html).not.toContain("data-plugins-new-skill");
    expect(renderToStaticMarkup(createElement(InstalledView, props({ add: [] })))).not.toContain("data-plugins-add");
  });

  it("Installed: GitHub once, named for people, saying what it brings, then the private skills", () => {
    const html = renderToStaticMarkup(createElement(ManageView, props()));
    const names = [...html.matchAll(/data-installed-entry="[^"]+"[\s\S]*?block truncate text-\[13px\] font-medium leading-\[18px\] text-ink[^"]*"[^>]*>([^<]+)</g)].map((match) => match[1]);
    expect(names).toEqual(["GitHub", "Twilio Docs"]);
    expect(html).not.toContain(">github-github<");
    expect(html).toMatch(/GitHub<\/span>(?:<span[^>]*data-row-category[^>]*>[^<]*<\/span>)?<\/span><span[^>]*data-installed-brings[^>]*>Added by you · Plugin · claude-plugins-official · 1 connector</);
    expect(html).toMatch(/data-plugins-installed[\s\S]*data-plugins-skills[\s\S]*Private skills[\s\S]*weekly-summary/);
  });

  it("a bot scope shows the server list once, including personal servers, skills and account connectors", () => {
    const html = renderToStaticMarkup(createElement(InstalledView, props({ resolved: capabilityFixture(), botName: "Scout" })));
    expect(html.match(/data-capability="/g)).toHaveLength(8);
    expect(html).toContain("My Notes");
    expect(html).toContain("Microsoft 365");
    expect(html).toContain("vcio-writing");
    expect(html).not.toContain("data-installed-entry=");
    expect(html).not.toContain("data-plugins-skills");
    expect(html).not.toContain("data-capabilities-received=");
    expect(html).toContain('aria-label="Open GitHub"');
    expect(html).toContain('aria-label="More for GitHub"');
  });

  it("hides every empty section: no private skills, no list, no tools", () => {
    const html = renderToStaticMarkup(createElement(ManageView, props({ skills: [] })));
    expect(html).not.toContain("data-plugins-skills");
    expect(html).not.toContain("Private skills");
    expect(html).not.toContain("data-plugins-installed-tools");
    const empty = renderToStaticMarkup(createElement(ManageView, props({ entries: [], skills: [] })));
    expect(empty).not.toContain("data-plugins-installed=");
    expect(empty).not.toMatch(/data-plugins-installed(?!-)/);
    expect(empty).toContain("Nothing installed yet.");
    expect(empty).toContain("data-plugins-go-discover");
  });

  it("says nothing about an administrator to a member", () => {
    for (const tab of ["installed", "discover", "bots", "pages", "sources"] as const) {
      expect(shell(tab)).not.toMatch(/administrator|admin/i);
    }
  });

  it("brings: app + connectors, plugin · skills", () => {
    expect(bringsLabel({ app: true, plugin: null, connectors: 2, skills: 0 })).toBe("app + 2 connectors");
    expect(bringsLabel({ app: false, plugin: "example-tools", connectors: 0, skills: 3 })).toBe("Plugin · example-tools · 3 skills");
    // #4097: the kind and the source in full, never a cut parenthesis
    expect(bringsLabel({ app: false, plugin: "example-tools", connectors: 0, skills: 3 })).not.toContain("(");
    expect(bringsLabel({ app: false, plugin: null, connectors: 1, skills: 0 })).toBe("1 connector");
    setLocale("fr");
    expect(bringsLabel({ app: true, plugin: null, connectors: 2, skills: 0 })).toBe("app + 2 connecteurs");
  });
});

describe("the \"...\" menu of an entry", () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    flushSync(() => root.unmount());
    host.remove();
  });
  const click = (element: Element | null) => flushSync(() => (element as HTMLElement).click());

  it("offers Update, For which bots and Remove, and runs the chosen one", () => {
    const update = vi.fn();
    const bots = vi.fn();
    const remove = vi.fn();
    flushSync(() => root.render(createElement(ManageView, props({
      entryActions: (entry) => (entry.name === "GitHub" ? { update, bots, remove } : { bots }),
    }))));
    const github = host.querySelector('[data-installed-entry="plugin:github@claude-plugins-official"]')!;
    expect(github.querySelector("[data-entry-update-dot]")).not.toBeNull();
    expect(host.querySelector('[role="menu"]')).toBeNull();
    click(github.querySelector("[data-entry-menu]"));
    const actions = [...host.querySelectorAll("[data-entry-action]")].map((node) => [node.getAttribute("data-entry-action"), node.textContent]);
    expect(actions).toEqual([["update", "Update"], ["bots", "For which bots"], ["remove", "Uninstall"]]);
    click(host.querySelector('[data-entry-action="bots"]'));
    expect(bots).toHaveBeenCalledTimes(1);
    expect(host.querySelector('[role="menu"]')).toBeNull();
    // the other entry offers only what it can do
    click(host.querySelector('[data-installed-entry="mcp:twilio-docs"] [data-entry-menu]'));
    expect([...host.querySelectorAll("[data-entry-action]")].map((node) => node.getAttribute("data-entry-action"))).toEqual(["bots"]);
  });

  it("French labels", () => {
    setLocale("fr");
    flushSync(() => root.render(createElement(ManageView, props({ entryActions: () => ({ update: noop, bots: noop, remove: noop }) }))));
    click(host.querySelector("[data-entry-menu]"));
    expect([...host.querySelectorAll("[data-entry-action]")].map((node) => node.textContent)).toEqual(["Mettre à jour", "Pour quels bots", "Désinstaller"]);
    flushSync(() => root.render(createElement(ConnectAppsView, { tab: "installed", onTab: noop, refreshing: false, onRefresh: noop })));
    expect(host.querySelector("#plugins-title")?.textContent).toBe("Connecter des apps");
    expect([...host.querySelectorAll("[data-plugins-kind-tab]")].map((node) => node.textContent)).toEqual(["Skills", "Connecteurs", "Plugins"]);
    expect([...host.querySelectorAll("[data-plugins-view]")].map((node) => node.textContent)).toEqual(["Les tiens", "Découvrir"]);
    click(host.querySelector("[data-plugins-more-button]"));
    expect([...host.querySelectorAll("[data-plugins-view-link]")].map((node) => node.textContent)).toEqual(["Modèles de bots", "Pages publiées", "Sources"]);
  });
});

describe("The engine accounts' connectors as plugin rows (#2306)", () => {
  const claude = {
    available: true,
    connectors: [
      { name: "Gmail", status: "connected" as const },
      { name: "Google Drive", status: "connected" as const },
      { name: "Google Calendar", status: "connected" as const },
      { name: "Canva", status: "needs_auth" as const },
    ],
  };
  const sections = (groups: HarnessConnectorGroup[]) => groups.map((group) => ({ group, rows: accountConnectorRows(group, items) }));
  const discover = (groups: HarnessConnectorGroup[], overrides: { filter?: "all" | "productivity" | "communication" | "design" } = {}) => renderToStaticMarkup(createElement(DiscoverView, {
    items: [], filter: overrides.filter ?? "all", onFilter: noop, type: "any", onType: noop, sourceLabel: (source: string) => source,
    onOpenItem: noop, renderAction: () => null, accounts: sections(groups), onAccountsSetUp: noop,
  }));

  it("Discover: a \"From <provider>\" section per engine, From Claude and From xAI, with real logos and Manage on in the header", () => {
    const html = discover(connectorGroups({ claude }, { grokConfigured: true }));
    expect(html).toMatch(/data-plugins-section="from-claude"[\s\S]*>From Claude<[\s\S]*Manage on Claude[\s\S]*data-plugins-section="from-grok"[\s\S]*>From xAI<[\s\S]*Manage on Grok/);
    expect(html).not.toContain("Connectors of your");
    for (const name of ["Gmail", "Google Drive", "Google Calendar", "Canva"]) expect(html).toContain(`data-plugin-row="account:claude:${name}"`);
    expect(html).toContain('data-harness-connector="grok:Outlook (Exchange)"');
    expect(html).toContain("gstatic.com/images/branding/product/2x/gmail_2020q4_48dp.png");
    expect(html).toContain("gstatic.com/images/branding/product/2x/drive_2020q4_48dp.png");
    expect(html.match(/data-harness-manage="/g)).toHaveLength(2);
    // the sub-line says where it comes from; a Grok row keeps "Not verifiable" there
    expect(html).toMatch(/data-harness-connector="claude:Gmail"[\s\S]*?Connector · Claude account/);
    expect(html).toMatch(/data-harness-connector="grok:X"[\s\S]*?data-harness-status="managed"[^>]*>Connector · Grok account · Not verifiable: Grok catalog</);
    expect(html).toMatch(/data-harness-connector="grok:Outlook \(Exchange\)"[\s\S]*?data-connector-capabilities[^>]*>Email · Calendar</);
    expect(html).toContain("data-harness-grok-note");
    // the right side: Installed when connected, Sign in as a button when not
    expect(html).toMatch(/data-harness-connector="claude:Gmail"[\s\S]*?Installed/);
    expect(html).toMatch(/data-harness-connector="claude:Canva"[\s\S]*?<button[^>]*data-harness-signin="claude:Canva"[^>]*>Sign in</);
  });

  it("Discover: the category filter applies to the account rows too", () => {
    const groups = connectorGroups({ claude });
    const all = discover(groups);
    expect(all).toContain('data-plugin-row="account:claude:Gmail"');
    const communication = discover(groups, { filter: "communication" });
    expect(communication).toContain('data-plugin-row="account:claude:Gmail"');
    expect(communication).not.toContain('data-plugin-row="account:claude:Google Drive"');
    expect(discover(groups, { filter: "productivity" })).toContain('data-plugin-row="account:claude:Google Drive"');
  });

  it("a ChatGPT group shows only once the server lists that account's connectors", () => {
    expect(connectorGroups({ claude, codex: { available: false } }).map((group) => group.id)).toEqual(["claude", "grok"]);
    const groups = connectorGroups({ claude, codex: { available: true, connectors: [{ name: "Notion", status: "connected" }] } });
    expect(groups.map((group) => [group.id, group.name])).toEqual([["claude", "Claude"], ["grok", "Grok"], ["codex", "ChatGPT"]]);
    expect(discover(groups)).toMatch(/data-plugins-section="from-codex"[\s\S]*>From ChatGPT<[\s\S]*data-plugin-row="account:codex:Notion"/);
  });

  it("the Connectors count takes the connected account rows", () => {
    const groups = connectorGroups({ claude }, { grokConfigured: true });
    expect(connectedAccountRows(groups)).toBe(3);
  });

  it("Manage: connected connectors are rows of the Installed list, with their state and a \"...\" menu; no separate account section", () => {
    const groups = connectorGroups({ claude });
    const html = renderToStaticMarkup(createElement(InstalledView, props({ entries: [], accounts: { sections: sections(groups), onSetUp: noop } })));
    expect(html).not.toContain("Connectors of your");
    expect(html).toMatch(/data-plugins-installed[\s\S]*data-installed-entry="account:claude:Gmail"[\s\S]*Connector · Claude account[\s\S]*Connected/);
    expect(html).toContain('aria-label="More for Gmail"');
    // not connected: its way to connect stays in the row
    expect(html).toMatch(/data-installed-entry="account:claude:Canva"[\s\S]*?data-harness-signin="claude:Canva"[^>]*>Sign in</);
    // the section with no account: its notice and how to connect, in the list
    expect(html).toMatch(/data-harness-notice="no_account"[\s\S]*?data-harness-setup="grok"/);
  });

  it("Manage: the \"...\" menu of an account row offers Manage on <provider> and Reconnect", () => {
    const opened = vi.spyOn(window, "open").mockImplementation(() => null);
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    try {
      const groups = connectorGroups({ claude });
      flushSync(() => root.render(createElement(InstalledView, props({ accounts: { sections: sections(groups) } }))));
      const more = host.querySelector<HTMLButtonElement>('[aria-label="More for Gmail"]')!;
      flushSync(() => more.click());
      const labels = [...document.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent?.trim());
      expect(labels).toEqual(["Manage on Claude", "Reconnect"]);
    } finally {
      flushSync(() => root.unmount());
      host.remove();
      opened.mockRestore();
    }
  });

  it("Claude and Grok never vanish: a section with no connector says why and how to connect (2026-10-28)", () => {
    const notice = (answer: HarnessAnswer | null, options: Parameters<typeof connectorGroups>[1] = {}) => connectorGroups(answer, options).map((group) => [group.id, group.notice ? (group.notice.kind === "unavailable" ? group.notice.reason : group.notice.kind) : group.connectors.length]);
    expect(notice(null, { loading: true })).toEqual([["claude", "loading"], ["grok", "no_account"]]);
    expect(notice(null, { loading: false })).toEqual([["claude", "unknown"], ["grok", "no_account"]]);
    for (const reason of ["not_signed_in", "key", "no_engine", "not_operator", "managed_policy", "unknown"] as const) {
      expect(notice({ claude: { available: false, reason, connectors: [] } }, { grokConfigured: true })[0]).toEqual(["claude", reason]);
    }
    expect(notice({ claude: { available: true, connectors: [] } })[0]).toEqual(["claude", "empty"]);
    expect(notice({ claude })).toEqual([["claude", 4], ["grok", "no_account"]]);
    expect(noticeAction({ kind: "unavailable", reason: "not_signed_in" })).toBe("setup");
    expect(noticeAction({ kind: "unavailable", reason: "key" })).toBe("setup");
    expect(noticeAction({ kind: "unavailable", reason: "unknown" })).toBe("retry");
    expect(noticeAction({ kind: "no_account" })).toBe("setup");
    expect(noticeAction({ kind: "loading" })).toBeNull();
  });

  it("a Grok account and a Claude sign-in the server could not read: both sections, the reason and the way to connect", () => {
    const groups = connectorGroups({ claude: { available: false, reason: "not_signed_in", connectors: [] } }, { grokConfigured: true });
    const html = discover(groups);
    expect(html).toMatch(/data-harness-group="claude"[\s\S]*?From Claude[\s\S]*?Manage on Claude[\s\S]*?data-harness-notice="not_signed_in"[\s\S]*?not signed in to Claude[\s\S]*?data-harness-setup="claude"[^>]*>Connect Claude</);
    expect(html).toMatch(/data-harness-group="grok"[\s\S]*?data-harness-connector="grok:/);
  });

  it("an account notice spans the whole grid row and never repeats the section head's Manage link (#3040)", () => {
    const groups = connectorGroups({ claude: { available: true, connectors: [] } });
    const html = discover(groups);
    // its own row, so the text is not squeezed a word per line by the action
    expect(html).toMatch(/class="[^"]*col-span-full[^"]*"[^>]*data-harness-notice="empty"/);
    expect(html).toMatch(/class="[^"]*col-span-full[^"]*"[^>]*data-harness-notice="no_account"/);
    // the section head already links to the provider's page: once, not twice
    expect(html.match(/Manage on Claude/g)).toHaveLength(1);
    expect(html).not.toContain('data-harness-add="claude"');
    // the Installed list keeps the notice's own way to manage, on a full row
    const installed = renderToStaticMarkup(createElement(InstalledView, props({ entries: [], accounts: { sections: sections(groups), onSetUp: noop } })));
    expect(installed).toMatch(/<li class="col-span-full"><div[^>]*data-harness-notice="empty"/);
    expect(installed).toContain('data-harness-add="claude"');
  });

  describe("#3358: the pages read the connector registry", () => {
    const account = (over: Partial<RegistryGrokAccount> = {}): RegistryGrokAccount => ({ label: "Grok", slot: "primary", auth: "subscription", connectors: [], at: 5, ...over });
    const fromServer = (answer: HarnessAnswer, grokConfigured = true) => connectorGroups(answer, { grokConfigured });

    it("Grok rows carry their real state from the person's own sign-ins, not the xAI catalog", () => {
      const groups = fromServer({ claude, grok: { accounts: [
        account({ connectors: [{ id: "outlook", name: "Outlook (Exchange)", status: "connected" }, { id: "microsoft-teams", name: "Microsoft Teams", status: "needs_auth" }] }),
        account({ label: "Grok (personal account)", slot: "second", kind: "personal", connectors: [{ id: "microsoft-teams", name: "Microsoft Teams", status: "connected" }, { id: "gmail", name: "Gmail", status: "failed" }] }),
      ] } });
      const grok = groups.find((group) => group.id === "grok")!;
      // each connector once, its best state across the two sign-ins; nothing from the catalog
      expect(grok.connectors).toEqual([
        { id: "outlook", name: "Outlook (Exchange)", status: "connected" },
        { id: "microsoft-teams", name: "Microsoft Teams", status: "connected" },
        { id: "gmail", name: "Gmail", status: "failed" },
      ]);
      const html = discover(groups);
      expect(html).not.toContain('data-harness-connector="grok:X"');
      expect(html).not.toContain("Not verifiable");
      expect(html).toMatch(/data-harness-connector="grok:Outlook \(Exchange\)"[\s\S]*?data-harness-status="connected"[^>]*>Connector · Grok account</);
      expect(html).toMatch(/data-harness-connector="grok:Outlook \(Exchange\)"[\s\S]*?Installed/);
      expect(html).toMatch(/data-harness-connector="grok:Gmail"[\s\S]*?<button[^>]*data-harness-signin="grok:Gmail"[^>]*data-harness-status="failed"[^>]*>Reconnect</);
      // the connected Grok rows count in "N connected"
      expect(connectedAccountRows(groups)).toBe(3 + 2);
    });

    it("a Grok section with no connector says why: none added, not read yet, a key, signed out, no sign-in", () => {
      const reason = (accounts: RegistryGrokAccount[]) => {
        const grok = fromServer({ claude, grok: { accounts } }).find((group) => group.id === "grok")!;
        return grok.notice?.kind === "unavailable" ? grok.notice.reason : grok.notice?.kind;
      };
      expect(reason([account()])).toBe("empty");
      expect(reason([account({ auth: "unknown", at: 0 })])).toBe("unknown");
      expect(reason([account({ auth: "key" })])).toBe("key");
      expect(reason([account({ auth: "none" })])).toBe("not_signed_in");
      // an organization server that lists no Grok sign-in of the person: not signed in, even with a Grok engine set up
      expect(reason([])).toBe("not_signed_in");
    });

    it("a server that lists no Grok sign-in (older, solo) keeps the xAI catalog when Grok is set up", () => {
      const grok = fromServer({ claude }).find((group) => group.id === "grok")!;
      expect(grok.connectors.map((connector) => connector.name)).toEqual(GROK_CLOUD_CONNECTORS.map((connector) => connector.name));
      expect(fromServer({ claude }, false).find((group) => group.id === "grok")!.notice).toEqual({ kind: "no_account" });
    });

    it("#4408: the groups follow the answer's one providers list, the list Providers > Advanced reads; the older fields only for an older server", () => {
      const answer: HarnessAnswer = {
        claude, codex: { available: false }, grok: { accounts: [account({ connectors: [{ id: "outlook", name: "Outlook (Exchange)", status: "connected" }] })] },
        providers: [
          { provider: "claude-ai", vendor: "anthropic", manageUrl: "https://claude.ai/customize/connectors", available: false, reason: "not_signed_in", connectors: [] },
          { provider: "chatgpt-apps", vendor: "openai", manageUrl: "https://chatgpt.com/#settings/Connectors", available: true, connectors: [{ name: "Notion", status: "needs_auth" }] },
          { provider: "grok-com", vendor: "xai", manageUrl: "https://grok.com/connectors", available: true, connectors: [{ id: "gmail", name: "Gmail", status: "failed" }] },
        ],
      };
      const groups = fromServer(answer);
      expect(groups.map((group) => [group.id, group.notice?.kind === "unavailable" ? group.notice.reason : group.connectors.map((connector) => `${connector.name}:${connector.status}`).join()])).toEqual([
        ["claude", "not_signed_in"], ["grok", "Gmail:failed"], ["codex", "Notion:needs_auth"],
      ]);
      expect(groups.find((group) => group.id === "codex")!.manageUrl).toBe("https://chatgpt.com/#settings/Connectors");
    });

    it("the ChatGPT group shows for a ChatGPT sign-in the registry lists, with its apps or that it has none yet", () => {
      const listed = fromServer({ claude, codex: { available: true, connectors: [{ name: "Notion", status: "connected" }] } });
      expect(discover(listed)).toMatch(/data-plugins-section="from-codex"[\s\S]*>From ChatGPT<[\s\S]*data-plugin-row="account:codex:Notion"/);
      const none = fromServer({ claude, codex: { available: true, connectors: [] } }).find((group) => group.id === "codex");
      expect(none?.notice).toEqual({ kind: "empty" });
      expect(fromServer({ claude, codex: { available: false } }).map((group) => group.id)).toEqual(["claude", "grok"]);
    });
  });
});

describe("For which bots", () => {
  it("switches an entry's servers on one bot, keeping the bot's other choices", () => {
    const enabled = ["github", "github-github", "twilio-docs"];
    // a bot on every server: off for GitHub leaves the rest
    expect(botUsesServers(null, enabled, ["github", "github-github"])).toBe(true);
    expect(botServersAfter(null, enabled, ["github", "github-github"], false)).toEqual(["twilio-docs"]);
    expect(botUsesServers(["twilio-docs"], enabled, ["github", "github-github"])).toBe(false);
    expect(botServersAfter(["twilio-docs"], enabled, ["github", "github-github"], true)).toEqual(["twilio-docs", "github", "github-github"]);
    expect(botUsesServers(["github"], enabled, ["github", "github-github"])).toBe(false);
  });
});

describe("Engine accounts and Sources: one list, GitHub nowhere in the accounts", () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    flushSync(() => root.unmount());
    host.remove();
  });

  it("Claude Code only; the engine accounts and the person's own servers are rows of Installed now (#2306, 2026-11-06)", () => {
    flushSync(() => root.render(createElement(AccountsView, { claudeCode: createElement("div", { "data-claude": "" }) })));
    expect(host.querySelector("[data-accounts-service-pill]")).toBeNull();
    expect(host.querySelector("[data-harness-group]")).toBeNull();
    expect(host.querySelector("[data-plugins-personal]")).toBeNull();
    expect(host.querySelector("[data-claude]")).not.toBeNull();
  });

  it("Sources: the marketplaces, then the organization's part marked for admins; no GitHub section", () => {
    const html = renderToStaticMarkup(createElement(SourcesView, { marketplaces: "MARKETS", organization: "ORG" }));
    expect(html).toMatch(/data-plugins-sources[\s\S]*MARKETS[\s\S]*data-plugins-sources-admin[\s\S]*Organization sources and access[\s\S]*Admins only[\s\S]*ORG/);
    expect(html).not.toContain("GitHub");
    expect(html).not.toContain("data-accounts-github");
    const member = renderToStaticMarkup(createElement(SourcesView, { marketplaces: "MARKETS" }));
    expect(member).not.toContain("data-plugins-sources-admin");
    expect(member).not.toMatch(/admin/i);
  });

  it("Sources: one GitHub connection row first, a link to the GitHub plugin's page, never the section itself", () => {
    const opened = vi.fn();
    flushSync(() => root.render(createElement(SourcesView, { onOpenGithub: opened, githubSummary: "Connected as @octo", marketplaces: "MARKETS" })));
    const row = host.querySelector("[data-plugins-sources-github]")!;
    expect(row.textContent).toContain("GitHub connection");
    expect(row.textContent).toContain("Connected as @octo");
    expect(host.textContent!.indexOf("GitHub connection")).toBeLessThan(host.textContent!.indexOf("MARKETS"));
    expect(host.querySelector("[data-accounts-github]")).toBeNull();
    const open = host.querySelector<HTMLElement>("[data-plugins-sources-github-open]")!;
    expect(open.textContent).toBe("Open the GitHub plugin");
    flushSync(() => open.click());
    expect(opened).toHaveBeenCalledTimes(1);
  });

  it("no GitHub (2026-10-29), and nothing at all without Claude Code", () => {
    flushSync(() => root.render(createElement(AccountsView, { claudeCode: createElement("div", { "data-claude": "" }) })));
    expect(host.querySelector("[data-plugins-github-card]")).toBeNull();
    expect(host.querySelector("[data-plugins-github]")).toBeNull();
    expect(host.textContent).not.toContain("GitHub");
    flushSync(() => root.render(createElement(AccountsView, {})));
    expect(host.querySelector("[data-plugins-accounts]")).toBeNull();
  });

});

describe("Connect Apps (once Capabilities, then Plugins), the engine accounts (once Providers) and Pages: names and old links", () => {
  it("the window is Connect Apps, in both languages; Pages keeps its name (#4153)", () => {
    expect(CONNECT_APPS_TABS).toEqual(["installed", "discover", "bots", "pages", "sources"]);
    expect(SCOPELESS_TABS).toEqual(["bots", "pages"]);
    expect(t("connectApps.title")).toBe("Connect Apps");
    expect(t("connectApps.search.short")).toBe("Search");
    expect(connectAppsTabLabel("pages")).toBe("Pages");
    setLocale("fr");
    try {
      expect(t("connectApps.title")).toBe("Connecter des apps");
      expect(t("connectApps.search.short")).toBe("Rechercher");
      expect(connectAppsTabLabel("pages")).toBe("Pages");
    } finally {
      setLocale("en");
    }
  });

  it("every entry and sentence that names the window says Connect Apps, from one key (#4153)", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const src = join(__dirname, "..", "..");
    const read = (path: string) => readFileSync(join(src, path), "utf8");
    // the foot's round button and its tooltip, the retro shell's menu and the command palette read the title key
    for (const file of ["components/SidebarFoot.tsx", "components/retro98/RetroChrome.tsx", "lib/palette-commands.ts"]) {
      expect(read(file), file).toContain(`t("connectApps.title")`);
    }
    // no second key for the same name
    for (const lang of ["en", "fr"]) {
      const catalog = JSON.parse(read(`locales/${lang}.json`)) as Record<string, string>;
      for (const key of ["sidebar.nav.apps", "sidebar.nav.connectedApps", "palette.cmd.connectApps"]) expect(catalog[key], `${lang} ${key}`).toBeUndefined();
      // a sentence that sends the person to the window names it; the phone's own keys (#4103) are the only exception
      const phone = new Set(["chat.connectApps.pill", "botAccess.manageInConnectApps"]);
      const stale = Object.entries(catalog).filter(([key, value]) => !phone.has(key) && /(\bin|\bdans|\bOpen|\bOuvrir|\brouvre|\breopen)\s*Plugins\b|\bPlugins\s*(>|:|shows|indique)|Plugins pill|pilule Plugins|bot’s Plugins|Plugins du bot/.test(value));
      expect(stale, lang).toEqual([]);
    }
  });

  it("the old Providers and My accounts links lead to Installed, on its accounts section; Bots and Pages are tabs; the rest stay", () => {
    expect(normalizeConnectAppsTab("accounts")).toBe("installed");
    expect(normalizeConnectAppsTab("providers")).toBe("installed");
    expect(isProvidersLink("providers")).toBe(true);
    expect(isProvidersLink("accounts")).toBe(true);
    expect(isProvidersLink("installed")).toBe(false);
    for (const tab of CONNECT_APPS_TABS) expect(normalizeConnectAppsTab(tab)).toBe(tab);
    expect(normalizeConnectAppsTab("nope")).toBeNull();
    expect(normalizeConnectAppsTab(null)).toBeNull();
  });

  it("the accounts section no longer draws the pages", () => {
    const html = renderToStaticMarkup(createElement(AccountsView, {}));
    expect(html).not.toContain("data-plugins-pages");
  });
});

describe("#4453: Yours and Discover of one kind", () => {
  const capabilityKeys = (html: string) => [...html.matchAll(/<li data-capability="[^"]+"[^>]*>/g)].length;

  // regression (#4453): the flat "Capabilities · N on" list mixed products,
  // connectors, plugins and skills; each now shows in its one tab, once
  it("a bot's rows: each in one kind only, none dropped, none twice", () => {
    const resolved = capabilityFixture();
    const all = capabilityKeys(renderToStaticMarkup(createElement(InstalledView, props({ resolved, botName: "Scout" }))));
    const perKind = (["skills", "connectors", "plugins"] as const).map((kind) => renderToStaticMarkup(createElement(InstalledView, props({ resolved, botName: "Scout", kind }))));
    expect(perKind.map(capabilityKeys).reduce((sum, count) => sum + count, 0)).toBe(all);
    for (const [index, html] of perKind.entries()) {
      const forms = [...html.matchAll(/<li data-capability="([^"]+)"/g)].map((match) => match[1]);
      const wanted = [["skill"], ["mcp", "connector", "product", "role"], ["plugin", "flow"]][index]!;
      expect(forms.every((form) => wanted.includes(form!)), forms.join()).toBe(true);
    }
    // the organization console's rows sit apart at the top; the rest is "Added by you", never "Capabilities"
    expect(perKind[1]).toContain("data-plugins-console-section");
    expect(perKind[1]).not.toMatch(/>Capabilities</);
  });

  it("a row the person may not switch shows a locked switch with the reason: set by the organization, the engine account", () => {
    const html = renderToStaticMarkup(createElement(InstalledView, props({ resolved: capabilityFixture(), botName: "Scout", kind: "connectors" })));
    expect(html).toMatch(/data-capability-scope="account"[\s\S]*?data-row-switch="locked"/);
    // another person's bot: every switch locked, with that reason
    const other = renderToStaticMarkup(createElement(InstalledView, props({ resolved: capabilityFixture(), botName: "Scout", kind: "connectors", readOnlyReason: "READ ONLY" })));
    expect(other).toContain('title="READ ONLY"');
  });

  it("Me: entries split by kind, private skills on Skills, account rows on Connectors with their pill and a locked switch", () => {
    const groups = connectorGroups({ claude: { available: true, connectors: [{ name: "Gmail", status: "connected" as const }] } });
    const accounts = { sections: groups.map((group) => ({ group, rows: accountConnectorRows(group, items) })) };
    const view = (kind: "skills" | "connectors" | "plugins") => renderToStaticMarkup(createElement(InstalledView, props({ kind, accounts })));
    const names = (html: string) => [...html.matchAll(/data-installed-entry="([^"]+)"/g)].map((match) => match[1]);
    expect(names(view("plugins"))).toEqual(["plugin:github@claude-plugins-official"]);
    expect(names(view("connectors"))).toEqual(["mcp:twilio-docs", "account:claude:Gmail"]);
    expect(names(view("skills"))).toEqual([]);
    expect(view("skills")).toContain("weekly-summary");
    expect(view("connectors")).not.toContain("weekly-summary");
    expect(view("connectors")).toMatch(/data-installed-entry="account:claude:Gmail"[\s\S]*?data-row-state="ok"[\s\S]*?data-row-switch="locked"/);
    // the group's count at its right
    expect(view("connectors")).toMatch(/>Yours<[\s\S]*?data-section-count="2"/);
    // none of their own of a kind: the first block says so, with a way to Discover
    const empty = renderToStaticMarkup(createElement(InstalledView, props({ kind: "skills", skills: [] })));
    expect(empty).toContain("Add your first skill");
    expect(empty).toContain("data-first-banner=\"skills\"");
    expect(empty).toContain("data-plugins-go-discover");
  });

  it("the organization's products fold past six rows behind Show all N", () => {
    const products = Array.from({ length: 9 }, (_, index) => ({ key: `p${index}`, node: createElement("div", { "data-test-product": index }) }));
    const html = renderToStaticMarkup(createElement(InstalledView, props({ kind: "connectors", products })));
    expect(html).toMatch(/data-plugins-organization-group[\s\S]*?From your organization/);
    expect(html.match(/data-test-product=/g)).toHaveLength(6);
    expect(html).toMatch(/data-plugins-organization-all[^>]*>Show all 9</);
    expect(renderToStaticMarkup(createElement(InstalledView, props({ kind: "skills", products })))).not.toContain("data-test-product");
  });

  it("Discover lists the chosen kind only; the engine accounts and the custom connector belong to Connectors", () => {
    const catalog = buildPluginItems({
      featured: [{ id: "linear", name: "Linear", description: "Issues", url: "https://mcp.linear.app/mcp", domain: "linear.app", auth: "oauth" }],
      marketplaces: [{ name: "kit", plugins: [{ name: "notes-kit", installed: false, servers: [], skills: ["notes"] }] }],
    });
    const groups = connectorGroups({ claude: { available: true, connectors: [{ name: "Gmail", status: "connected" as const }] } });
    const discover = (kind: "skills" | "connectors" | "plugins") => renderToStaticMarkup(createElement(DiscoverView, {
      kind, items: catalog, filter: "all", onFilter: noop, type: "any", onType: noop, sourceLabel: (source: string) => source,
      onOpenItem: noop, renderAction: () => null, accounts: groups.map((group) => ({ group, rows: accountConnectorRows(group, catalog) })), onAddCustom: noop, extraSources: ["kit"],
    }));
    const rows = (html: string) => [...html.matchAll(/data-plugin-row="([^"]+)"/g)].map((match) => match[1]);
    expect(rows(discover("plugins"))).toEqual(["plugin:notes-kit@kit"]);
    expect(rows(discover("connectors"))).toContain("featured:linear");
    expect(rows(discover("connectors"))).not.toContain("plugin:notes-kit@kit");
    expect(discover("connectors")).toContain("data-plugins-add-custom");
    expect(discover("connectors")).toContain('data-harness-group="claude"');
    expect(discover("plugins")).not.toContain("data-plugins-add-custom");
    expect(discover("plugins")).not.toContain("data-harness-group");
  });
});

describe("#4453 (2026-11-16): the organization console's own section, apart, at the top of each kind", () => {
  const consoleRow = { key: "vendor:harbor", node: createElement("div", { "data-test-vendor": "" }, "VENDOR") };
  const own = { key: "mine", node: createElement("div", { "data-test-own": "" }, "OWN") };

  it("is titled \"<Console> · <Organization>\", lists the console's rows first and \"Added by you\" below", () => {
    const html = renderToStaticMarkup(createElement(InstalledView, props({
      kind: "connectors", consoleTitle: "Perspicax · Example Org", products: [consoleRow], personal: [own], entries: [], skills: [],
    })));
    expect(html).toContain("data-plugins-console-section");
    expect(html).toMatch(/Perspicax · Example Org[\s\S]*?data-test-vendor[\s\S]*?Added by you[\s\S]*?data-test-own/);
    // never a second copy of the organization's rows under the person's
    expect(html.match(/data-test-vendor/g)).toHaveLength(1);
  });

  it("is in each of the three kinds when the console offers something of that kind", () => {
    for (const kind of ["skills", "connectors", "plugins"] as const) {
      const html = renderToStaticMarkup(createElement(InstalledView, props({
        kind, consoleTitle: "Perspicax · Example Org", consoleHasExtras: true, consoleExtras: createElement("div", { "data-test-extras": "" }, "EXTRAS"),
      })));
      expect(html, kind).toMatch(/data-plugins-console-section[\s\S]*?Perspicax · Example Org[\s\S]*?data-test-extras/);
    }
  });

  it("is absent when the console has nothing of that kind: no empty title, and the person's own rows are \"Yours\"", () => {
    const html = renderToStaticMarkup(createElement(InstalledView, props({ kind: "connectors", consoleTitle: "Perspicax · Example Org", personal: [own] })));
    expect(html).not.toContain("data-plugins-console-section");
    expect(html).not.toContain("Perspicax");
    expect(html).not.toMatch(/<h3[^>]*>Added by you</);
    expect(html).toMatch(/>Yours</);
  });

  it("folds past six rows behind Show all N", () => {
    const rows = Array.from({ length: 9 }, (_, index) => ({ key: `vendor:${index}`, node: createElement("div", { "data-test-vendor": "" }, `V${index}`) }));
    const html = renderToStaticMarkup(createElement(InstalledView, props({ kind: "connectors", consoleTitle: "Console", products: rows })));
    expect(html.match(/data-test-vendor/g)).toHaveLength(6);
    expect(html).toContain("Show all 9");
  });

  it("at a bot, the organization's resolved rows sit in the section and the bot's own rows below it", () => {
    const html = renderToStaticMarkup(createElement(InstalledView, props({ resolved: capabilityFixture(), botName: "Scout", kind: "connectors", consoleTitle: "Perspicax · Example Org" })));
    const section = html.slice(html.indexOf("data-plugins-console-section"));
    // the gateway's roles are the console's: in its section, before the person's own account rows
    expect(section).toMatch(/Perspicax · Example Org[\s\S]*?data-capability="role"/);
    expect(html.indexOf("data-plugins-console-section")).toBeLessThan(html.indexOf('data-capability-scope="account"'));
  });
});

describe("#4453 (2026-11-16): the title line never wraps; the search gives way", () => {
  let observed: ((entries: Array<{ contentRect: { width: number } }>) => void) | null = null;
  beforeEach(() => {
    observed = null;
    vi.stubGlobal("ResizeObserver", class { constructor(callback: typeof observed) { observed = callback; } observe() {} disconnect() {} });
  });
  afterEach(() => vi.unstubAllGlobals());

  const mount = async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(createElement(ConnectAppsView, {
        tab: "installed", onTab: noop, refreshing: false, onRefresh: noop, kind: "skills",
        search: createElement("input", { "data-plugins-search": "" }), manageActions: createElement("button", { "data-test-add": "" }), installed: "I",
      }));
    });
    return { host, root };
  };
  const width = async (value: number) => { await act(async () => { observed?.([{ contentRect: { width: value } }]); }); };

  it("is a field on a wide line and an icon button that opens it on a narrow one, in one row", async () => {
    const { host, root } = await mount();
    await width(900);
    expect(host.querySelector("[data-plugins-kind-row] [data-plugins-search-slot] [data-plugins-search]")).not.toBeNull();
    expect(host.querySelector("[data-plugins-search-toggle]")).toBeNull();
    // the row wraps only when its controls cannot fit at all; the search gives way long before
    await width(500);
    expect(host.querySelector("[data-plugins-search]")).toBeNull();
    const toggle = host.querySelector<HTMLButtonElement>("[data-plugins-search-toggle]")!;
    expect(toggle).not.toBeNull();
    // Add stays on the row, and "..." on the title line
    expect(host.querySelector("[data-plugins-kind-row] [data-test-add]")).not.toBeNull();
    expect(host.querySelector("[data-plugins-head] [data-plugins-more-button]")).not.toBeNull();
    await act(async () => { toggle.click(); });
    expect(host.querySelector("[data-plugins-search-expanded] [data-plugins-search]")).not.toBeNull();
    await act(async () => { host.querySelector<HTMLButtonElement>("[data-plugins-search-close]")!.click(); });
    expect(host.querySelector("[data-plugins-search]")).toBeNull();
    // back to a wide line: the field again, one search in the page
    await width(900);
    expect(host.querySelectorAll("[data-plugins-search]")).toHaveLength(1);
    await act(async () => root.unmount());
    host.remove();
  });

  it("Refresh is the first line of the \"...\" menu and runs the refresh", async () => {
    const onRefresh = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => { root.render(createElement(ConnectAppsView, { tab: "installed", onTab: noop, refreshing: false, onRefresh, installed: "I" })); });
    await act(async () => { host.querySelector<HTMLButtonElement>("[data-plugins-more-button]")!.click(); });
    const first = host.querySelector('[role="menu"] [role="menuitem"]')!;
    expect(first.textContent).toBe("Refresh");
    await act(async () => { (first as HTMLButtonElement).click(); });
    expect(onRefresh).toHaveBeenCalledTimes(1);
    await act(async () => root.unmount());
    host.remove();
  });
});

describe("#4453 (2026-11-16, the owner's references): Discover's cards, banner and sections; Yours' rows", () => {
  const catalog = buildPluginItems({
    featured: [
      { id: "linear", name: "Linear", description: "Issues and projects for the team", url: "https://mcp.linear.app/mcp", domain: "linear.app", auth: "none" },
      { id: "slack", name: "Slack", description: "Channels", url: "https://mcp.slack.com/mcp", domain: "slack.com", auth: "oauth" },
      { id: "stripe", name: "Stripe", description: "Payments", url: "https://mcp.stripe.com", domain: "stripe.com", auth: "oauth" },
    ],
  });
  const discover = (over: Record<string, unknown> = {}) => renderToStaticMarkup(createElement(DiscoverView, {
    kind: "connectors", items: catalog, filter: "all", onFilter: noop, type: "any", onType: noop, sourceLabel: (source: string) => source === "catalog" ? "Sagax catalog" : source,
    onOpenItem: noop, renderAction: (item: { name: string }, variant?: string) => createElement("button", { "data-test-action": variant ?? "card" }, item.name), ...over,
  }));

  it("draws cards in two columns: icon tile, name with the reviewed mark, two lines, where it comes from, the action at the top right", () => {
    const grid = discover({ items: buildPluginItems({ featured: Array.from({ length: 4 }, (_, index) => ({ id: `app${index}`, name: `App ${index}`, description: "d", url: `https://mcp${index}.example.net/mcp`, domain: `app${index}.example.net`, auth: index === 0 ? "none" : "oauth", category: "productivity" })) }) });
    expect(grid).toContain("@container grid grid-cols-2");
    const card = grid.slice(grid.indexOf('data-discover-card=""'));
    expect(card).toContain("data-card-verified");
    expect(card).toMatch(/data-card-meta[\s\S]*?Sagax catalog/);
    expect(card).toMatch(/data-card-action[\s\S]*?data-test-action="card"/);
    // the item that needs no sign-in carries the small outlined chip, an account one does not
    expect(grid).toMatch(/App 0[\s\S]*?data-card-chip[^>]*>No sign-in</);
    expect(grid.match(/data-card-chip/g)).toHaveLength(1);
  });

  it("an installed item shows Added with a check, then where it comes from, and a green check at the corner", () => {
    const installed = buildPluginItems({ servers: [{ name: "linear", enabled: true, url: "https://mcp.linear.app/mcp", source: "catalog" }] });
    const html = renderToStaticMarkup(createElement(DiscoverView, {
      kind: "connectors", items: installed.map((item) => ({ ...item, installed: true })), filter: "all", onFilter: noop, type: "any", onType: noop, sourceLabel: (source: string) => source,
      onOpenItem: noop, renderAction: () => null, type_: undefined,
    } as never));
    expect(html).toMatch(/data-card-added[^>]*>[\s\S]*?Added</);
    expect(html).toContain("data-card-installed");
  });

  it("has one featured block: the first curated pick's slide with its labelled button, its source line and its artwork", () => {
    const html = discover();
    expect(html).toContain('data-plugins-section="featured"');
    const banner = html.slice(html.indexOf('data-plugins-section="featured"'));
    expect(banner).toMatch(/From Sagax catalog/);
    expect(banner).toContain('data-test-action="banner"');
    expect(banner).toContain("data-featured-art");
    expect((html.match(/data-featured-banner/g) ?? []).length).toBe(1);
    // one slide visible at a time; the picks that are slides are not repeated on the shelf
    expect((html.match(/data-featured-slide=/g) ?? []).length).toBe(1);
    const slideKeys = [...html.matchAll(/data-featured-dot="(\d+)"/g)];
    expect(slideKeys.length).toBeGreaterThan(1);
  });

  it("cycles: dots to jump, previous and next the keyboard reaches, paused on hover and focus, still under reduced motion", async () => {
    vi.useFakeTimers();
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const mountWith = async (motion: boolean) => {
      vi.stubGlobal("matchMedia", () => ({ matches: !motion, addEventListener() {}, removeEventListener() {} }));
      await act(async () => { root.render(createElement(DiscoverView, {
        kind: "connectors", items: catalog, filter: "all", onFilter: noop, type: "any", onType: noop, sourceLabel: (source: string) => source, onOpenItem: noop, renderAction: () => null,
      })); });
    };
    const shown = () => host.querySelector("[data-featured-slide]")?.getAttribute("data-featured-slide");
    await mountWith(true);
    const first = shown();
    await act(async () => { vi.advanceTimersByTime(6100); });
    expect(shown()).not.toBe(first);
    // hover pauses it
    const section = host.querySelector("[data-featured-banner]")!;
    await act(async () => { section.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })); section.dispatchEvent(new Event("mouseenter")); });
    const paused = shown();
    await act(async () => { vi.advanceTimersByTime(20_000); });
    expect(shown()).toBe(paused);
    await act(async () => { section.dispatchEvent(new Event("mouseleave")); });
    // dots jump, previous and next step, both reachable buttons
    await act(async () => { host.querySelector<HTMLButtonElement>('[data-featured-dot="0"]')!.click(); });
    expect(shown()).toBe(first);
    await act(async () => { host.querySelector<HTMLButtonElement>("[data-featured-next]")!.click(); });
    expect(shown()).not.toBe(first);
    await act(async () => { host.querySelector<HTMLButtonElement>("[data-featured-prev]")!.click(); });
    expect(shown()).toBe(first);
    expect(host.querySelector('[data-featured-dot="0"]')?.getAttribute("aria-current")).toBe("true");
    expect(host.querySelector("[data-featured-prev]")?.getAttribute("aria-label")).toBe("Previous");
    // reduced motion: it never moves by itself
    await act(async () => root.unmount());
    const root2 = createRoot(host);
    vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
    await act(async () => { root2.render(createElement(DiscoverView, { kind: "connectors", items: catalog, filter: "all", onFilter: noop, type: "any", onType: noop, sourceLabel: (source: string) => source, onOpenItem: noop, renderAction: () => null })); });
    const still = shown();
    await act(async () => { vi.advanceTimersByTime(30_000); });
    expect(shown()).toBe(still);
    await act(async () => root2.unmount());
    host.remove();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("adds one slide per vendor the console offers, from the console's data: its name, its line, its artwork and a button to its products", () => {
    const html = discover({ vendorSlides: [{ key: "vendor:harbor", consoleName: "Console \u00b7 Example Org", name: "Harbor Suite", line: "Service desk, monitoring and quoting", art: createElement("img", { "data-vendor-art": "", src: "https://cdn.example.test/harbor.svg" }), onGo: noop }] });
    expect(html).toContain('data-featured-dot="3"');
    expect((html.match(/data-featured-dot=/g) ?? []).length).toBe(4);
    // with nothing curated to show first, the vendor's slide stands alone
    const only = discover({ items: [], owned: ["Linear", "Slack", "Stripe"], vendorSlides: [{ key: "vendor:harbor", consoleName: "Console \u00b7 Example Org", name: "Harbor Suite", line: "Service desk", art: createElement("img", { "data-vendor-art": "" }), onGo: noop }] });
    expect(only).toContain('data-featured-slide="vendor:harbor"');
    expect(only).toMatch(/From Console · Example Org/);
    expect(only).toContain("Harbor Suite");
    expect(only).toContain('data-featured-vendor-go="vendor:harbor"');
    expect(only).toContain("data-vendor-art");
    expect(only).not.toContain("data-featured-dot");
  });

  it("has no banner and no section when there is nothing to recommend", () => {
    const html = discover({ items: catalog, owned: ["Linear", "Slack", "Stripe"] });
    expect(html).not.toContain("data-featured-banner");
    expect(html).not.toContain('data-plugins-section="featured"');
  });

  it("titles each section with its count in a small rounded badge and a Show all with an arrow", () => {
    const many = buildPluginItems({
      featured: Array.from({ length: 12 }, (_, index) => ({ id: `app${index}`, name: `App ${index}`, description: "", url: `https://mcp${index}.example.net/mcp`, domain: `app${index}.example.net`, auth: "oauth", category: "productivity" })),
    });
    const html = discover({ items: many });
    expect(html).toMatch(/Productivity<\/h3><span[^>]*data-section-count="12"/);
    expect(html).toMatch(/data-plugins-view-all="productivity"[^>]*>View all<svg/);
  });

  it("Yours: a row is a rule-separated list row, its category chip after the name, how it got there then what it does", () => {
    const withCategory = buildPluginItems({
      marketplaces: [{ name: "kit", plugins: [{ name: "reviewer", description: "Reviews a pull request", category: "development", installed: true, servers: [], skills: [] }] }],
    });
    const html = renderToStaticMarkup(createElement(InstalledView, props({ kind: "plugins", entries: installedEntries(withCategory), skills: [] })));
    expect(html).toContain("divide-y");
    expect(html).not.toMatch(/hover:bg-ink\/\[0\.05\]/);
    expect(html).toMatch(/Reviewer<\/span><span[^>]*data-row-category[^>]*>Code<\/span>/);
    expect(html).toContain("Added by you · Reviews a pull request");
  });

  it("a row the organization requires has no switch and says so; one it offers keeps the person's own", () => {
    const data = capabilityFixture();
    const required = { ...data, items: data.items.map((item) => item.form === "flow" ? { ...item, state: "imposed" as const } : item) };
    const html = renderToStaticMarkup(createElement(InstalledView, props({ resolved: required, botName: "Scout", kind: "plugins", consoleTitle: "Console" })));
    const imposed = html.match(/<li data-capability="flow"[\s\S]*?<\/li>/)?.[0] ?? "";
    expect(imposed).toContain("Required by your organization");
    expect(imposed).not.toContain("data-row-switch");
  });

  it("a person with none of their own sees the first block above the console's section, even when the console has some", () => {
    const html = renderToStaticMarkup(createElement(InstalledView, props({
      kind: "plugins", entries: [], skills: [], consoleTitle: "Console", consoleHasExtras: true, consoleCount: 2,
      consoleExtras: createElement("div", { "data-test-extras": "" }, "EXTRAS"),
    })));
    expect(html.indexOf("data-first-banner")).toBeGreaterThan(-1);
    expect(html.indexOf("data-first-banner")).toBeLessThan(html.indexOf("data-plugins-console-section"));
    expect(html).toContain("Add your first plugin");
    expect(html).toMatch(/Console<\/h3><span[^>]*data-section-count="2"/);
  });
});

describe("#4453: the sort button", () => {
  it("orders by name, or what is on first, and leaves the list's own order by default", () => {
    const rows = [{ n: "Beta", on: false }, { n: "alpha", on: true }, { n: "Gamma", on: true }];
    const by = (sort: "default" | "name" | "on") => sortRows(rows, sort, (row) => row.n, (row) => row.on).map((row) => row.n);
    expect(by("default")).toEqual(["Beta", "alpha", "Gamma"]);
    expect(by("name")).toEqual(["alpha", "Beta", "Gamma"]);
    expect(by("on")).toEqual(["alpha", "Gamma", "Beta"]);
  });

  it("offers only the keys it was given, checks the chosen one and says it on the button", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const onSort = vi.fn();
    await act(async () => { root.render(createElement(SortControl, { sort: "name", onSort, options: ["default", "name"] })); });
    const button = host.querySelector<HTMLButtonElement>("[data-plugins-sort-button]")!;
    expect(button.textContent).toBe("");
    expect(button.getAttribute("aria-label")).toBe("Sort");
    await act(async () => { button.click(); });
    expect([...host.querySelectorAll("[data-plugins-sort-option]")].map((option) => option.getAttribute("data-plugins-sort-option"))).toEqual(["default", "name"]);
    expect(host.querySelector('[data-plugins-sort-option="name"]')?.getAttribute("aria-checked")).toBe("true");
    await act(async () => { host.querySelector<HTMLButtonElement>('[data-plugins-sort-option="default"]')!.click(); });
    expect(onSort).toHaveBeenCalledWith("default");
    await act(async () => root.unmount());
    host.remove();
  });
});

describe("#4453: filter and sort live inside the search field; the kinds and the switch are the shared controls", () => {
  const mountView = async (extra: Record<string, unknown> = {}) => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const onTab = vi.fn();
    const onKind = vi.fn();
    await act(async () => {
      root.render(createElement(ConnectAppsView, {
        tab: "discover", onTab, onKind, kind: "connectors", refreshing: false, onRefresh: noop, installed: "I", discover: "D",
        search: createElement(ConnectAppsSearchField, { query: "", onQuery: noop, groups: [], opened: new Set<never>(), active: -1, onActive: noop, onOpen: noop }),
        filterControl: createElement("button", { "data-test-filter": "", "data-plugins-filter-button": "" }, "F"),
        sortControl: createElement("button", { "data-test-sort": "", "data-plugins-sort-button": "" }, "S"),
        ...extra,
      }));
    });
    return { host, root, onTab, onKind };
  };

  it("sit at the field's right end, after the text, behind a thin separator, in that keyboard order", async () => {
    const { host, root } = await mountView();
    const box = host.querySelector("[data-plugins-search-box]")!;
    const controls = box.querySelector("[data-plugins-search-controls]")!;
    expect(controls).not.toBeNull();
    expect(controls.className).toMatch(/border-l/);
    const order = [...box.querySelectorAll("input, button")].map((node) => node.matches("input") ? "text" : node.hasAttribute("data-test-filter") ? "filter" : node.hasAttribute("data-test-sort") ? "sort" : "other");
    expect(order).toEqual(["text", "filter", "sort"]);
    await act(async () => root.unmount());
    host.remove();
  });

  it("show the filter on Discover only; the sort on both", async () => {
    const { host, root } = await mountView({ tab: "installed" });
    expect(host.querySelector("[data-test-filter]")).toBeNull();
    expect(host.querySelector("[data-test-sort]")).not.toBeNull();
    await act(async () => root.unmount());
    host.remove();
  });

  it("the kinds are the shared PillTabs: roving tab stop, aria-controls, arrows move the kind", async () => {
    const { host, root, onKind } = await mountView();
    const tabs = [...host.querySelectorAll<HTMLElement>('[data-plugins-kinds] [role="tab"]')];
    expect(tabs.map((tab) => tab.getAttribute("tabindex"))).toEqual(["-1", "0", "-1"]);
    expect(tabs[0]!.getAttribute("aria-controls")).toBe("connect-apps-kind-panel-skills");
    await act(async () => { host.querySelector("[data-plugins-kinds]")!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })); });
    expect(onKind).toHaveBeenCalledWith("plugins");
    await act(async () => root.unmount());
    host.remove();
  });

  it("Yours | Discover is the shared segmented control, with arrows on the radio group", async () => {
    const { host, root, onTab } = await mountView({ tab: "installed" });
    const group = host.querySelector("[data-plugins-views]")!;
    expect(group.className).toContain("rounded-full border");
    expect([...group.querySelectorAll("[role=radio]")].map((node) => node.getAttribute("tabindex"))).toEqual(["0", "-1"]);
    await act(async () => { group.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })); });
    expect(onTab).toHaveBeenCalledWith("discover");
    await act(async () => root.unmount());
    host.remove();
  });

  it("show a small dot on a filter or a sort that is not the default, and none on the default", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => { root.render(createElement("div", null,
      createElement(DiscoverFilter, { chips: ["all", "design"], filter: "design", onPick: noop, label: (chip: string) => chip }),
      createElement(SortControl, { sort: "default", onSort: noop, options: ["default", "name"] }))); });
    expect(host.querySelector("[data-plugins-filter-button] [data-plugins-active-dot]")).not.toBeNull();
    expect(host.querySelector("[data-plugins-sort-button] [data-plugins-active-dot]")).toBeNull();
    await act(async () => { root.render(createElement(SortControl, { sort: "name", onSort: noop, options: ["default", "name"] })); });
    expect(host.querySelector("[data-plugins-sort-button] [data-plugins-active-dot]")).not.toBeNull();
    await act(async () => root.unmount());
    host.remove();
  });
});
