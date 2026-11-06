// @vitest-environment happy-dom
// Plugins (#2104, 2026-11-06: Grok Bot's Connect Apps, look for look). The
// home is the catalogue (title, "N connected" opening Manage, the round
// search, From Sagax, categories); Manage ("Manage plugins and skills")
// lists what is installed, one line per installed thing with a "..." menu,
// every empty section hidden. Bots, Pages and Sources open alone under a
// "< Plugins" back row; every GitHub setting stays in Sources (the
// organization's part for an admin only, as before).
import { createElement } from "react";
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
import { ConnectAppsView, connectedCounts, normalizeConnectAppsTab, isProvidersLink, CONNECT_APPS_TABS, SCOPELESS_TABS, connectAppsTabLabel } from "./ConnectAppsView";
import { HarnessConnectorGroups, connectorGroups, noticeAction } from "./HarnessConnectorGroups";
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

  it("the home: the title, \"N connected\" with its icons opening Manage, the search row and Bot templates (#2104, Grok Bot's Connect Apps)", () => {
    const entries = installedEntries(items);
    // GitHub (three rows folded into one) and Twilio Docs: two entries, as Manage shows them,
    // plus the three connectors of the providers, which Manage lists too
    expect(connectedCounts({ entries, engineConnected: 3 })).toEqual({ installed: 5 });
    expect(connectedCounts({ entries, engineConnected: 0 })).toEqual({ installed: 2 });
    expect(connectedCounts({ entries: [], engineConnected: 0 })).toEqual({});
    const html = renderToStaticMarkup(createElement(ConnectAppsView, {
      tab: "discover", onTab: noop, refreshing: false, onRefresh: noop,
      connected: { count: 6, icons: items.slice(0, 2) }, search: createElement("input", { "data-plugins-search": "" }), discover: "D",
    }));
    expect(html).toMatch(/id="plugins-title"[^>]*>Plugins</);
    expect(html).toMatch(/data-plugins-connected="6"[\s\S]*?6 connected</);
    expect(html).toMatch(/data-plugins-search-row[\s\S]*?data-plugins-search-slot[\s\S]*?data-plugins-bot-templates[^>]*>[\s\S]*?Bot templates/);
    // no tab row: Manage and the other views open from the home
    expect(html).not.toContain('role="tablist"');
    // nothing connected: no "0 connected", a plain Manage link (scope, pages, sources live there)
    const none = renderToStaticMarkup(createElement(ConnectAppsView, { tab: "discover", onTab: noop, refreshing: false, onRefresh: noop, connected: { count: 0, icons: [] } }));
    expect(none).not.toContain("0 connected");
    expect(none).toMatch(/data-plugins-connected="0"[\s\S]*?<span>Manage<\/span>/);
  });

  it("Manage: \"< Plugins\" back to the home, the big title, the scope and + Add in its row, links to Pages and Sources (#2104)", () => {
    const html = shell("installed");
    expect(html).toMatch(/data-plugins-home=""[^>]*>[\s\S]*?Plugins<\/button>/);
    expect(html).toMatch(/id="plugins-title"[^>]*>Manage plugins and skills</);
    expect(html).toMatch(/data-plugins-view-link="pages"[\s\S]*?data-plugins-view-link="sources"/);
    expect(html).not.toContain('data-plugins-view-link="bots"');
    expect(html).not.toContain('role="tablist"');
    expect(html).not.toContain("data-plugins-advanced");
    const scoped = renderToStaticMarkup(createElement(ConnectAppsView, {
      tab: "installed", onTab: noop, refreshing: false, onRefresh: noop,
      scope: createElement("div", { "data-test-scope": "" }), manageActions: createElement("button", { "data-test-add": "" }), installed: "I",
    }));
    expect(scoped).toMatch(/id="plugins-title"[\s\S]*?data-plugins-scope-slot[\s\S]*?data-test-scope[\s\S]*?data-test-add/);
  });

  it("Bots and Pages open alone under \"< Plugins\"; the home keeps the one search (#2104)", () => {
    for (const tab of ["bots", "pages"] as const) {
      const html = renderToStaticMarkup(createElement(ConnectAppsView, {
        tab, onTab: noop, refreshing: false, onRefresh: noop, scope: createElement("div", { "data-test-scope": "" }),
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
    const names = [...html.matchAll(/data-installed-entry="[^"]+"[\s\S]*?block truncate text-\[15px\] leading-5 text-ink">([^<]+)</g)].map((match) => match[1]);
    expect(names).toEqual(["GitHub", "Twilio Docs"]);
    expect(html).not.toContain(">github-github<");
    expect(html).toMatch(/GitHub<\/span><span[^>]*data-installed-brings[^>]*>plugin \(claude-plugins-official\) · 1 connector</);
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
    expect(bringsLabel({ app: false, plugin: "example-tools", connectors: 0, skills: 3 })).toBe("plugin (example-tools) · 3 skills");
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
    expect(actions).toEqual([["update", "Update"], ["bots", "For which bots"], ["remove", "Remove"]]);
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
    expect([...host.querySelectorAll("[data-entry-action]")].map((node) => node.textContent)).toEqual(["Mettre à jour", "Pour quels bots", "Retirer"]);
    flushSync(() => root.render(createElement(ConnectAppsView, { tab: "installed", onTab: noop, refreshing: false, onRefresh: noop })));
    expect(host.querySelector("#plugins-title")?.textContent).toBe("Gérer les plugins et les skills");
    expect([...host.querySelectorAll("[data-plugins-view-link]")].map((node) => node.textContent)).toEqual(["Pages", "Sources"]);
    flushSync(() => root.render(createElement(ConnectAppsView, { tab: "discover", onTab: noop, connected: { count: 2, icons: [] }, refreshing: false, onRefresh: noop })));
    expect(host.querySelector("[data-plugins-connected]")?.textContent).toBe("2 connectés");
    expect(host.querySelector("[data-plugins-bot-templates]")?.textContent).toBe("Modèles de bots");
  });
});

describe("Providers: the engines' connectors", () => {
  const claude = {
    available: true,
    connectors: [
      { name: "Gmail", status: "connected" as const },
      { name: "Google Drive", status: "connected" as const },
      { name: "Google Calendar", status: "connected" as const },
      { name: "Canva", status: "needs_auth" as const },
    ],
  };

  it("lists the Claude account's connectors like Grok's, grouped by engine, with real logos", () => {
    const html = renderToStaticMarkup(createElement(HarnessConnectorGroups, { groups: connectorGroups({ claude, grok: { connectors: GROK_CLOUD_CONNECTORS } }) }));
    expect(html).toMatch(/data-harness-group="claude"[\s\S]*Connectors of your Claude account[\s\S]*data-harness-group="grok"[\s\S]*Connectors of your Grok account/);
    for (const name of ["Gmail", "Google Drive", "Google Calendar", "Canva"]) expect(html).toContain(`data-harness-connector="claude:${name}"`);
    expect(html).toContain('data-harness-connector="grok:Outlook (Exchange)"');
    // Gmail, Drive and Calendar draw their product mark, not the Google "G"
    expect(html).toContain("gstatic.com/images/branding/product/2x/gmail_2020q4_48dp.png");
    expect(html).toContain("gstatic.com/images/branding/product/2x/drive_2020q4_48dp.png");
    expect(html).toContain("gstatic.com/images/branding/product/2x/calendar_2020q4_48dp.png");
    expect(html).toMatch(/data-harness-connector="claude:Gmail"[\s\S]*?data-harness-status="connected"[^>]*>Connected</);
    expect(html).toMatch(/data-harness-connector="claude:Canva"[\s\S]*?data-harness-status="needs_auth"/);
    expect(html).toMatch(/data-harness-connector="grok:X"[\s\S]*?data-harness-status="managed"[^>]*>Not verifiable: Grok catalog</);
    expect(html).toContain("Manage on Claude");
    expect(html).toContain("Manage on Grok");
    // 2026-10-27: no "What your engines reach" panel; each card names its service
    expect(html).not.toContain("data-engine-capabilities");
    expect(html).not.toContain("What your engines reach");
    expect(html).toMatch(/data-harness-connector="grok:Outlook \(Exchange\)"[\s\S]*?data-connector-capabilities[^>]*>Email · Calendar</);
    expect(html).toContain("data-harness-grok-note");
  });

  it("a ChatGPT group shows only once the server lists that account's connectors", () => {
    expect(connectorGroups({ codex: { available: false } }).map((group) => group.id)).toEqual(["claude", "grok"]);
    const groups = connectorGroups({ claude, codex: { available: true, connectors: [{ name: "Notion", status: "connected" }] } });
    expect(groups.map((group) => [group.id, group.name])).toEqual([["claude", "Claude"], ["grok", "Grok"], ["codex", "ChatGPT"]]);
  });

  it("the engine accounts: one list, no service pills, one Manage per engine, no refresh nor connect button per row (#2104)", () => {
    const groups = connectorGroups({ claude, grok: { connectors: GROK_CLOUD_CONNECTORS } });
    const html = renderToStaticMarkup(createElement(AccountsView, { groups, servers: "MY-SERVERS", onRefresh: noop }));
    expect(html).not.toContain("data-accounts-service-pill");
    expect(html).toMatch(/data-harness-group="claude"[\s\S]*data-harness-group="grok"[\s\S]*MY-SERVERS/);
    expect(html.match(/data-harness-manage="/g)).toHaveLength(2);
    expect(html).not.toContain("Check again");
    expect(html).not.toContain("data-connect-from-engine");
    expect(html).not.toContain("Connect on claude.ai");
    expect(html).not.toContain("Your connections");
    expect(html).not.toContain("GitHub");
  });

  it("Claude and Grok never vanish: a section with no connector says why and how to connect (2026-10-28)", () => {
    const notice = (input: Parameters<typeof connectorGroups>[0]) => connectorGroups(input).map((group) => [group.id, group.notice ? (group.notice.kind === "unavailable" ? group.notice.reason : group.notice.kind) : group.connectors.length]);
    // still reading, then the reasons the server gives
    expect(notice({ claude: null, claudeLoading: true, grok: null })).toEqual([["claude", "loading"], ["grok", "no_account"]]);
    expect(notice({ claude: null, claudeLoading: false, grok: null })).toEqual([["claude", "unknown"], ["grok", "no_account"]]);
    for (const reason of ["not_signed_in", "key", "no_engine", "not_operator", "managed_policy", "unknown"] as const) {
      expect(notice({ claude: { available: false, reason, connectors: [] }, grok: { connectors: GROK_CLOUD_CONNECTORS } })[0]).toEqual(["claude", reason]);
    }
    expect(notice({ claude: { available: true, connectors: [] }, grok: null })[0]).toEqual(["claude", "empty"]);
    expect(notice({ claude, grok: null })).toEqual([["claude", 4], ["grok", "no_account"]]);
    // what each offers: sign in for a missing account, check again when Claude did not answer
    expect(noticeAction({ kind: "unavailable", reason: "not_signed_in" })).toBe("setup");
    expect(noticeAction({ kind: "unavailable", reason: "key" })).toBe("setup");
    expect(noticeAction({ kind: "unavailable", reason: "unknown" })).toBe("retry");
    expect(noticeAction({ kind: "no_account" })).toBe("setup");
    expect(noticeAction({ kind: "loading" })).toBeNull();
    expect(renderToStaticMarkup(createElement(HarnessConnectorGroups, { groups: [] }))).toBe("");
  });

  it("a Grok account and a Claude sign-in the server could not read: both sections, the reason and the way to connect", () => {
    const groups = connectorGroups({ claude: { available: false, reason: "not_signed_in", connectors: [] }, grok: { connectors: GROK_CLOUD_CONNECTORS } });
    const html = renderToStaticMarkup(createElement(AccountsView, { groups, servers: "MY-SERVERS", onSetUp: noop }));
    expect(html).toMatch(/data-harness-group="claude"[\s\S]*?Connectors of your Claude account[\s\S]*?Manage on Claude[\s\S]*?data-harness-notice="not_signed_in"[\s\S]*?not signed in to Claude[\s\S]*?data-harness-setup="claude"[^>]*>Connect Claude</);
    expect(html).toMatch(/data-harness-group="grok"[\s\S]*?data-harness-connector="grok:/);
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

  it("every engine and the servers at once: nothing to pick first (#2104)", () => {
    const groups = connectorGroups({ claude: { available: true, connectors: [{ name: "Gmail", status: "connected" }] }, grok: { connectors: GROK_CLOUD_CONNECTORS } });
    flushSync(() => root.render(createElement(AccountsView, { groups, servers: createElement("div", { "data-servers": "" }) })));
    expect(host.querySelector("[data-accounts-service-pill]")).toBeNull();
    expect(host.querySelector('[data-harness-group="grok"]')).not.toBeNull();
    expect(host.querySelector('[data-harness-group="claude"]')).not.toBeNull();
    expect(host.querySelector("[data-servers]")).not.toBeNull();
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

  it("the engines and the person's servers only, no GitHub (2026-10-29)", () => {
    const groups = connectorGroups({ claude: { available: true, connectors: [{ name: "Gmail", status: "connected" }] } });
    flushSync(() => root.render(createElement(AccountsView, { groups, servers: createElement("div", { "data-servers": "" }) })));
    expect([...host.querySelectorAll("[data-harness-group]")].map((group) => group.getAttribute("data-harness-group"))).toEqual(["claude", "grok"]);
    expect(host.querySelector("[data-plugins-github-card]")).toBeNull();
    expect(host.querySelector("[data-plugins-github]")).toBeNull();
    expect(host.textContent).not.toContain("GitHub");
    expect(host.querySelector('[data-harness-group="claude"]')).not.toBeNull();
    expect(host.querySelector("[data-servers]")).not.toBeNull();
  });

});

describe("Plugins (once Capabilities), the engine accounts (once Providers) and Pages: names and old links", () => {
  it("the window is Plugins, in both languages; Pages keeps its name", () => {
    expect(CONNECT_APPS_TABS).toEqual(["installed", "discover", "bots", "pages", "sources"]);
    expect(SCOPELESS_TABS).toEqual(["bots", "pages"]);
    expect(t("connectApps.title")).toBe("Plugins");
    expect(connectAppsTabLabel("pages")).toBe("Pages");
    setLocale("fr");
    try {
      expect(t("connectApps.title")).toBe("Plugins");
      expect(connectAppsTabLabel("pages")).toBe("Pages");
    } finally {
      setLocale("en");
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
    const html = renderToStaticMarkup(createElement(AccountsView, { groups: [] }));
    expect(html).not.toContain("data-plugins-pages");
  });
});
