// @vitest-environment happy-dom
// Capabilities, the whole panel (PluginsPanel) driven the way the owner
// used it (2026-10-28): it opens on Discover, the first tab; the header has
// no "N connected" button and the count sits on Installed; the scope stays
// put on every tab; a click on the GitHub row (not its "...") opens its page
// inside Installed, with the title, the scope and the tabs kept and a back
// row; marketplace plugins wear their real mark; Providers shows a Claude
// section beside Grok even when Claude's connectors cannot be read, with the
// way to connect. The /api answers are a stand-in shaped like an
// organization member's (names neutral).
import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";

let harness: unknown;
let owner = true;
vi.mock("@/lib/use-owner-or-admin", () => ({ useOwnerOrAdmin: () => owner }));
const API: Record<string, unknown> = {
  "/api/mcp/servers": { servers: [
    { name: "twilio-docs", type: "http", url: "https://mcp.twilio.com/docs", enabled: true, source: "twilio", headerKeys: [], auth: "none" },
    { name: "github", type: "http", url: "https://api.githubcopilot.com/mcp/", enabled: true, headerKeys: ["Authorization"], auth: "none" },
    { name: "github-github", type: "http", url: "https://api.githubcopilot.com/mcp/", enabled: true, source: "claude-plugins-official", headerKeys: ["Authorization"], auth: "none" },
  ], reserved: [] },
  "/api/marketplaces": { marketplaces: [
    { name: "claude-plugins-official", source: "anthropics/claude-plugins-official", visibility: "org", plugins: [
      { name: "github", description: "GitHub's MCP server", installed: true, servers: ["github-github"], skills: [], category: "development" },
      { name: "frontend-design", description: "Distinctive interfaces", installed: true, servers: [], skills: ["frontend-design"], category: "design", homepage: "https://design.example.com/plugin" },
      { name: "code-review", description: "Reviews a pull request", installed: true, servers: [], skills: ["code-review"], category: "development", homepage: "https://github.com/example/code-review" },
    ] },
    { name: "example-ops", source: "example-org/ops-marketplace", visibility: "org", plugins: [
      { name: "ops-flow", description: "Service desk routines", installed: true, servers: [], skills: ["triage"], category: "productivity", icon: "https://ops.example.com/icon.png" },
    ] },
  ] },
  "/api/skills-library": { skills: [
    { name: "frontend-design", description: "", source: "claude-plugins-official", enabled: true },
    { name: "code-review", description: "", source: "claude-plugins-official", enabled: true },
    { name: "triage", description: "", source: "example-ops", enabled: true },
  ] },
  "/api/plugins/search": { featured: [
    { id: "notion", name: "Notion", description: "Pages", url: "https://mcp.notion.com/mcp", domain: "mcp.notion.com", site: "notion.so", auth: "oauth", category: "productivity" },
  ], results: [], nextCursor: null, registryAvailable: true },
  "/api/bots/bot-a/plugins": {
    marketplaces: [{ name: "claude-plugins-official", source: "anthropics/claude-plugins-official", visibility: "org", addedAt: 1, updatedAt: 1, plugins: [
      { name: "github", description: "GitHub's MCP server", installed: false, external: false, category: "development", contents: { agents: [], commands: [], skills: [] } },
    ] }],
    plugins: [], policy: { mode: "any" }, engine: { loadsPlugins: true }, canChange: true,
  },
  // Browse Bots' lists (the Bots tab and the one search, 2026-10-29); neutral names
  "/api/bot-catalog": { organization: true, viewer: { principalId: "p-1", admin: false, canCreate: true }, entries: [
    { id: "bot-a", name: "Rocket", title: "Planner", description: "Plans the week", look: { color: "orange" }, owner: { principalId: "p-1", name: "Example member" }, source: "mine", archived: false, primary: true },
    { id: "bot-c", name: "Quill", title: "Release notes", description: "Turns merged changes into notes", look: { color: "green" }, owner: { principalId: "p-2", name: "Example teammate" }, source: "shared", archived: false, primary: false },
  ] },
  "/api/team-library/xai": { label: "xAI Bot Marketplace", url: "https://x.ai/bot/marketplace", fetchedAt: 1, bots: [] },
  "/api/bot-presets": { presets: [] },
  "/api/pages": { pages: [{ id: "pg1", title: "Weekly KPIs", status: "published", access: "private", expiresAt: null, currentVersion: 1, botId: "bot-a", threadId: "t1", createdAt: 1, updatedAt: 2, expired: false, versions: [{ n: 1, kind: "html", title: "Weekly KPIs", createdAt: 1, state: "published", bytes: 10, botId: "bot-a" }] }] },
};

API["/api/me/plugins"] = { marketplaces: [{ name: "my-tools", source: "example/my-tools", addedAt: 1, updatedAt: 1,
  plugins: [{ name: "personal-review", description: "Reviews my work", installed: true, external: false, contents: { agents: [], commands: [], skills: [] } }],
}], plugins: [{ key: "personal-review@my-tools", name: "personal-review", marketplace: "my-tools", enabled: true, removed: [], declaredMcpServers: [] }],
  policy: { mode: "any" }, engine: { loadsPlugins: true }, canChange: true };
API["/api/me/skills-library"] = { skills: [{ name: "my-writing", description: "Write my notes", source: "local-import", enabled: true, tags: [], warnings: [], assignedBots: [] }] };

const dispatch = vi.fn();
const state = {
  pluginsSurface: "apps", pluginsPage: null, pluginsBotId: null, pluginsFocusApps: null, selectedId: "bot-a",
  groups: [],
  bots: [{ id: "bot-a", name: "Rocket", instanceId: "claude-main", ownerUserId: "p-1" }],
  instances: [{ instanceId: "grok-main", driverKind: "grokAgent", displayName: "Grok", access: "subscription", snapshot: { state: "available", authenticated: true } }],
  config: { viewer: { role: "member", principalId: "p-1" }, features: {} },
};
vi.mock("@/state/store", async () => {
  class ApiError extends Error { body?: unknown; }
  return {
    ApiError,
    useStore: () => ({ state, dispatch }),
    api: vi.fn(async (path: string) => {
      const pathname = path.split("?")[0]!;
      if (pathname === "/api/me/harness-connectors") return harness;
      if (pathname in API) return structuredClone(API[pathname]);
      throw new Error(`no stand-in for ${pathname}`);
    }),
  };
});
// Browse Bots' pane: what the Bots tab hands it
let paneProps: { tabLabel?: string; focus?: { key: string } | null; sources?: unknown } | null = null;
// 1dc046846: the pane moved into its own lazy module to break the cycle.
vi.mock("./lazy-bot-catalog", async () => {
  const { createElement: h } = await import("react");
  return {
    BotCatalogPane: Object.assign((props: NonNullable<typeof paneProps>) => {
      paneProps = props;
      return h("div", { "data-test-bot-pane": props.focus?.key ?? "" }, props.tabLabel);
    }, { preload: () => Promise.resolve() }),
  };
});

const { PluginsPanel } = await import("./PluginsPanel");

let host: HTMLDivElement;
let root: Root;
const settle = async () => {
  for (let i = 0; i < 6; i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
};
const $ = (selector: string) => host.querySelector<HTMLElement>(selector);
const click = async (element: HTMLElement | null) => {
  expect(element).not.toBeNull();
  await act(async () => { element!.click(); });
  await settle();
};
const lastPane = () => paneProps;
/** Type in the one search, as a person does. */
const type = async (text: string) => {
  const input = $("[data-plugins-search]") as HTMLInputElement;
  expect(input).not.toBeNull();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await settle();
};
const key = async (name: string) => {
  const input = $("[data-plugins-search]")!;
  await act(async () => { input.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true })); });
  await settle();
};
const groups = () => [...host.querySelectorAll<HTMLElement>("[data-plugins-search-group]")].map((group) => group.getAttribute("data-plugins-search-group"));
const tabs = () => [...host.querySelectorAll<HTMLElement>("[data-plugins-tab]")].map((tab) => `${tab.getAttribute("data-plugins-tab")}${tab.getAttribute("aria-selected") === "true" ? "*" : ""}`);

beforeEach(async () => {
  // any raw request (no server here) answers 404 at once
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "test" }), { status: 404, headers: { "content-type": "application/json" } })));
  setLocale("en");
  owner = true;
  harness = { manageUrl: "https://claude.ai/customize/connectors", claude: { available: true, connectors: [{ name: "Gmail", status: "connected" }, { name: "Canva", status: "needs_auth" }] }, codex: { available: false } };
  dispatch.mockClear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const open = async (personal = false) => {
  await act(async () => { root.render(createElement(PluginsPanel)); });
  await settle();
  if (!personal) await click($('[data-plugins-scope-option="workspace"]'));
};

describe("Capabilities, driven like the owner did", () => {
  it("opens on Me without an organization permission and keeps its installs separate", async () => {
    owner = false;
    await open(true);
    expect($('[data-plugins-scope-option="workspace"]')).toBeNull();
    expect($('[data-plugins-scope-option="me"]')?.getAttribute("aria-checked")).toBe("true");
    await click($('[data-plugins-tab="installed"]'));
    expect(host.textContent).toContain("Personal Review");
    expect(host.textContent).toContain("my-writing");
    expect(host.textContent).not.toContain("Twilio Docs");
    expect($('[data-plugins-new-skill]')).toBeTruthy();
    await click($('[data-plugins-scope-option="bot"]'));
    expect(host.textContent).not.toContain("Personal Review");
    await click($('[data-plugins-scope-option="me"]'));
    expect(host.textContent).toContain("Personal Review");
  });
  it("Bots is a tab right after Discover; Discover has no Browse Bots button, for every bot", async () => {
    paneProps = null;
    await open();
    expect(tabs()).toEqual(["discover*", "bots", "installed", "pages", "sources"]);
    expect($('[data-plugins-tab="bots"] [data-plugins-tab-label]')?.textContent).toBe("Bots");
    // no search of its own in Discover, and no Browse Bots button, in either scope
    expect($('[data-plugins-manage="discover"] input')).toBeNull();
    expect($("[data-plugins-browse-bots]")).toBeNull();
    await click($('[data-plugins-scope-option="bot"]'));
    expect($("[data-plugins-browse-bots]")).toBeNull();
    expect(host.textContent).not.toContain("Browse bots");
    await click($('[data-plugins-scope-option="workspace"]'));
    await click($('[data-plugins-tab="bots"]'));
    expect(tabs()).toEqual(["discover", "bots*", "installed", "pages", "sources"]);
    expect($("[data-test-bot-pane]")?.textContent).toBe("Bots");
    expect(lastPane()?.sources).toBeTruthy();
    // the install scope does not apply to bots: shown turned off, with why
    expect($("[data-plugins-scope-note]")?.getAttribute("data-plugins-scope-note")).toBe("bots");
  });

  it("one search above the tabs looks everywhere, grouped by kind; empty, the tab is back", async () => {
    await open();
    expect(host.querySelectorAll("[data-plugins-search]")).toHaveLength(1);
    await type("review");
    expect($("[data-plugins-results]")).not.toBeNull();
    expect($("[data-plugins-discover]")).toBeNull();
    expect(groups()).toEqual(["plugins", "skills"]);
    await type("quill");
    expect(groups()).toEqual(["bots"]);
    expect($("[data-plugins-search-results]")?.textContent).toContain("Quill");
    await type("weekly");
    expect(groups()).toEqual(["pages"]);
    await type("ops");
    // Ops Flow, its skill (Triage, from example-ops), the example-ops source
    const order = ["plugins", "apps", "skills", "mcp", "bots", "templates", "pages", "sources"];
    expect(groups()).toEqual(order.filter((id) => groups().includes(id)));
    expect(groups()).toContain("plugins");
    expect(groups()).toContain("sources");
    // the same field on every tab
    await click($('[data-plugins-tab="installed"]'));
    expect(groups()).toContain("sources");
    await type("nothing like this");
    expect($("[data-plugins-search-empty]")?.textContent).toContain("Nothing matches");
    await type("");
    expect($("[data-plugins-results]")).toBeNull();
    expect($('[data-plugins-manage="installed"]')).not.toBeNull();
  });

  it("the search sits on the scope's line, to its right", async () => {
    await open();
    const row = $("[data-plugins-scope-row]")!;
    expect([...row.children].map((child) => child.getAttribute("data-plugins-scope-slot") !== null ? "scope" : child.getAttribute("data-plugins-search-slot") !== null ? "search" : "other")).toEqual(["scope", "search"]);
  });

  it("the keyboard: arrows light a row, Enter opens it (a bot opens on its page in Bots), Escape empties first", async () => {
    paneProps = null;
    await open();
    await type("quill");
    const input = $("[data-plugins-search]")!;
    expect(input.getAttribute("role")).toBe("combobox");
    await key("ArrowDown");
    expect(input.getAttribute("aria-activedescendant")).toBe("connect-apps-result-0");
    expect($("#connect-apps-result-0")?.getAttribute("aria-selected")).toBe("true");
    await key("Enter");
    expect(tabs()).toEqual(["discover", "bots*", "installed", "pages", "sources"]);
    expect(lastPane()?.focus?.key).toBe("bot:bot-c");
    expect(($("[data-plugins-search]") as HTMLInputElement).value).toBe("");
    // Escape with text empties the field and keeps the window open
    await type("review");
    dispatch.mockClear();
    await key("Escape");
    expect(($("[data-plugins-search]") as HTMLInputElement).value).toBe("");
    expect(dispatch).not.toHaveBeenCalled();
    expect($("[data-plugins-results]")).toBeNull();
  });

  it("a result opens its page or its tab: a plugin its page, a page and a source their tab", async () => {
    await open();
    await type("code review");
    await click($('[data-plugins-search-group="plugins"] [role="option"]'));
    expect($("[data-plugins-subpage]")).not.toBeNull();
    expect(host.textContent).toContain("Code Review");
    await type("weekly");
    await click($('[data-plugins-search-group="pages"] [role="option"]'));
    expect(tabs()).toEqual(["discover", "bots", "installed", "pages*", "sources"]);
    await type("example-ops");
    await click($('[data-plugins-search-group="sources"] [role="option"]'));
    expect(tabs()).toEqual(["discover", "bots", "installed", "pages", "sources*"]);
  });

  it("Pages is a tab of its own: Your pages there, and nothing about pages left in Installed", async () => {
    await open();
    expect($('[data-plugins-tab="providers"]')).toBeNull();
    expect($('[data-plugins-tab="pages"] [data-plugins-tab-label]')?.textContent).toBe("Pages");
    expect($('[data-plugins-tab="accounts"]')).toBeNull();
    await click($('[data-plugins-tab="installed"]'));
    expect($("[data-plugins-pages]")).toBeNull();
    expect($('[data-plugins-manage="installed"]')?.textContent).not.toContain("Your pages");
    expect($('[data-plugins-manage="installed"] [data-settings-card="pages"]')).toBeNull();
    await click($('[data-plugins-tab="pages"]'));
    expect($('[data-plugins-manage="pages"] [data-settings-card="pages"]')).not.toBeNull();
    expect($('[data-plugins-manage="pages"]')?.textContent).toContain("Your pages");
    expect($('[data-plugins-manage="pages"]')?.textContent).toContain("Weekly KPIs");
    // personal like the Providers: the install scope is shown turned off there too
    expect($("[data-plugins-scope-slot]")).not.toBeNull();
  });

  it("opens on Discover, the first tab; the header has no N connected button; the counts sit on the tabs", async () => {
    await open();
    expect(tabs()).toEqual(["discover*", "bots", "installed", "pages", "sources"]);
    expect($("[data-plugins-connected]")).toBeNull();
    expect(host.querySelector("header")?.textContent).not.toMatch(/connected/i);
    // GitHub, Code Review, Frontend Design, Ops Flow, Twilio Docs: five connected entries,
    // and the Claude account's one connected connector, which Installed lists under Providers
    expect($('[data-plugins-tab="installed"] [data-plugins-tab-count]')?.textContent).toBe("6");
    // (the Claude account's one connected connector is counted on Installed too, since Providers moved there)
    expect($('[data-plugins-tab="discover"] [data-plugins-tab-count]')).toBeNull();
  });

  it("an old link to My accounts or Providers opens Installed, with the Providers section; a link to the pages opens Pages", async () => {
    try {
      for (const old of ["accounts", "providers"]) {
        (state as { pluginsPage: string | null }).pluginsPage = old;
        await open();
        expect(tabs()).toEqual(["discover", "bots", "installed*", "pages", "sources"]);
        expect($('[data-plugins-manage="installed"] [data-plugins-providers]')).not.toBeNull();
        expect($("[data-plugins-providers] [data-harness-group]")).not.toBeNull();
        await act(async () => root.render(createElement("div")));
      }
      (state as { pluginsPage: string | null }).pluginsPage = "pages";
      await open();
      expect(tabs()).toEqual(["discover", "bots", "installed", "pages*", "sources"]);
      expect($('[data-plugins-manage="pages"]')?.textContent).toContain("Your pages");
    } finally {
      (state as { pluginsPage: string | null }).pluginsPage = null;
    }
  });

  it("keeps the scope under the title on every tab", async () => {
    await open();
    for (const tab of ["installed", "discover", "bots", "pages", "sources"]) {
      if (!$(`[data-plugins-tab="${tab}"]`)) continue;
      await click($(`[data-plugins-tab="${tab}"]`));
      expect($("[data-plugins-scope-bar]"), tab).not.toBeNull();
      // then the one search (2026-10-29), and nothing else in the header
      const next = $("[data-plugins-scope-slot]")?.nextElementSibling;
      expect(next?.hasAttribute("data-plugins-search-slot"), tab).toBe(true);
      expect(next?.nextElementSibling, tab).toBeNull();
    }
  });

  it("Installed: as many rows as its counter, each with its real mark; the puzzle only without one", async () => {
    await open();
    await click($('[data-plugins-tab="installed"]'));
    const rows = [...host.querySelectorAll<HTMLElement>("[data-installed-entry]")];
    expect(rows.map((row) => row.querySelector("span.font-medium")?.textContent)).toEqual(["Code Review", "Frontend Design", "GitHub", "Ops Flow", "Twilio Docs"]);
    // the counter adds the providers' connected connectors (one here) to the rows
    expect(String(rows.length + 1)).toBe($('[data-plugins-tab="installed"] [data-plugins-tab-count]')?.textContent);
    const mark = (name: string) => {
      const row = rows.find((candidate) => candidate.querySelector("span.font-medium")?.textContent === name)!;
      const img = row.querySelector("img");
      return img ? img.getAttribute("src") : row.querySelector("svg.lucide-puzzle") ? "puzzle" : "other";
    };
    expect(mark("GitHub")).toContain("github.com");
    expect(mark("Frontend Design")).toContain("design.example.com");
    expect(mark("Ops Flow")).toBe("https://ops.example.com/icon.png");
    // a homepage that is only its repository on a code host is not its mark
    expect(mark("Code Review")).toBe("puzzle");
  });

  it("a click on the GitHub row itself opens its page inside Installed: title, scope and tabs kept, a back row, the name once", async () => {
    await open();
    await click($('[data-plugins-tab="installed"]'));
    const row = [...host.querySelectorAll<HTMLElement>("[data-installed-entry] button[aria-label]")].find((button) => button.textContent?.includes("GitHub"))!;
    await click(row);
    expect($("[data-plugins-subpage]")).not.toBeNull();
    expect($("#plugins-title")?.textContent).toBe("Capabilities");
    expect($("[data-plugins-scope-bar]")).not.toBeNull();
    expect(tabs()).toEqual(["discover", "bots", "installed*", "pages", "sources"]);
    expect($('[data-plugins-tab="installed"]')?.getAttribute("aria-current")).toBe("page");
    expect($("[data-plugins-page-bar]")?.textContent).toContain("Installed");
    expect($("[data-plugins-detail-name]")?.textContent).toBe("GitHub");
    expect($("[data-plugins-detail-head] img")).not.toBeNull();
    expect($("[data-plugins-detail-meta]")?.textContent).toMatch(/^github · anthropics\/claude-plugins-official/);
    expect([...host.querySelectorAll("[data-install-state]")].map((state) => state.textContent)).toEqual(["Installed for everyone", "Not installed on Rocket"]);
    // the scope of the bot: its main action beside the name
    await click($('[data-plugins-scope-option="bot"]'));
    expect($("[data-plugins-subpage]")).not.toBeNull();
    expect($("[data-plugins-detail-primary]")?.textContent).toBe("Install for Rocket");
    // back to the list
    await click($("[data-plugins-back]"));
    expect($("[data-plugins-subpage]")).toBeNull();
    expect($('[data-plugins-manage="installed"]')).not.toBeNull();
  });

  it("Installed > Providers: Claude beside Grok when its connectors cannot be read, with why and Connect Claude", async () => {
    harness = { manageUrl: "https://claude.ai/customize/connectors", claude: { available: false, reason: "not_signed_in", connectors: [] }, codex: { available: false } };
    await open();
    await click($('[data-plugins-tab="installed"]'));
    const pills = [...host.querySelectorAll("[data-accounts-service-pill]")].map((pill) => pill.textContent);
    expect(pills.slice(0, 3)).toEqual(["All", "Claude", "Grok"]);
    expect(pills).not.toContain("GitHub");
    expect([...host.querySelectorAll("[data-harness-group]")].map((group) => group.getAttribute("data-harness-group"))).toEqual(["claude", "grok"]);
    expect($('[data-harness-group="claude"]')?.textContent).toContain("Connectors of your Claude account");
    expect($('[data-harness-notice="not_signed_in"]')?.textContent).toContain("not signed in to Claude");
    await click($('[data-harness-setup="claude"]'));
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: "togglePlugins", open: false }));
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: "toggleAppSettings", open: true, section: "engines" }));
  });

  it("Installed > Providers: the Claude account's connectors listed like Grok's when they are read", async () => {
    await open();
    await click($('[data-plugins-tab="installed"]'));
    expect($('[data-harness-connector="claude:Gmail"]')).not.toBeNull();
    expect($('[data-harness-connector="claude:Canva"] [data-harness-status="needs_auth"]')).not.toBeNull();
    expect($('[data-harness-group="claude"] [data-harness-notice]')).toBeNull();
  });

  it("GitHub lives on the GitHub plugin's page: not in Providers; Sources and the plugin's server lead there", async () => {
    const servers = (API["/api/mcp/servers"] as { servers: Array<Record<string, unknown>> }).servers;
    const plugin = servers.find((server) => server.name === "github-github")!;
    plugin.github = "missing";
    try {
      await open();
      // Providers: the engines only, no GitHub card nor section
      await click($('[data-plugins-tab="installed"]'));
      expect($('[data-accounts-service-pill="github"]')).toBeNull();
      expect($("[data-plugins-github-card]")).toBeNull();
      expect($("[data-accounts-github]")).toBeNull();
      // Installed > GitHub: the plugin's page holds the connection, first
      await click($('[data-plugins-tab="installed"]'));
      const row = [...host.querySelectorAll<HTMLElement>("[data-installed-entry] button[aria-label]")].find((button) => button.textContent?.includes("GitHub"))!;
      await click(row);
      expect($("[data-plugins-detail]")?.getAttribute("data-plugins-detail")).toBe("plugin:github@claude-plugins-official");
      expect($("[data-plugins-detail] [data-accounts-github]")).not.toBeNull();
      // no link to itself
      expect($("[data-plugin-github-account]")).toBeNull();
      // Sources: one row that opens that same page, in Sources
      await click($('[data-plugins-tab="sources"]'));
      expect($("[data-plugins-marketplaces]")).not.toBeNull();
      expect($('[data-plugins-manage="sources"] [data-accounts-github]')).toBeNull();
      await click($("[data-plugins-sources-github-open]"));
      expect(tabs()).toEqual(["discover", "bots", "installed", "pages", "sources*"]);
      expect($("[data-plugins-detail]")?.getAttribute("data-plugins-detail")).toBe("plugin:github@claude-plugins-official");
      expect($("[data-accounts-github]")).not.toBeNull();
      // the plugin's server page: Open the GitHub plugin leads there too
      await click($('[data-plugins-tab="installed"]'));
      await click([...host.querySelectorAll<HTMLElement>("[data-installed-entry] button[aria-label]")].find((button) => button.textContent?.includes("GitHub"))!);
      await click([...host.querySelectorAll<HTMLElement>("[data-plugins-detail] li button")].find((button) => button.textContent?.includes("github-github"))!);
      expect($("[data-plugins-detail]")?.getAttribute("data-plugins-detail")).toBe("mcp:github-github");
      expect($("[data-mcp-open-github]")?.textContent).toBe("Open the GitHub plugin");
      await click($("[data-mcp-open-github]"));
      expect($("[data-plugins-detail]")?.getAttribute("data-plugins-detail")).toBe("plugin:github@claude-plugins-official");
      expect($("[data-accounts-github]")).not.toBeNull();
    } finally {
      delete plugin.github;
    }
  });

  it("no marketplace has the GitHub plugin: Sources opens a GitHub page of its own with the same connection", async () => {
    const markets = API["/api/marketplaces"] as { marketplaces: Array<{ plugins: Array<{ name: string }> }> };
    const saved = structuredClone(markets);
    markets.marketplaces[0]!.plugins = markets.marketplaces[0]!.plugins.filter((entry) => entry.name !== "github");
    try {
      await open();
      await click($('[data-plugins-tab="sources"]'));
      await click($("[data-plugins-sources-github-open]"));
      expect($("[data-plugins-github-page] [data-accounts-github]")).not.toBeNull();
      expect($("[data-plugins-page-title]")?.textContent).toBe("GitHub");
      await click($("[data-plugins-back]"));
      expect($('[data-plugins-manage="sources"]')).not.toBeNull();
    } finally {
      Object.assign(markets, saved);
    }
  });
});

describe("githubPluginKey: the page that holds the GitHub connection", () => {
  const item = (fields: Record<string, unknown>) => ({ kind: "plugin", name: "x", source: "m", status: "available", ...fields }) as never;
  it("the plugin named github, an installed one first; else one whose server reads the GitHub account; else none", async () => {
    const { githubPluginKey } = await import("./PluginsPanel");
    expect(githubPluginKey([])).toBeNull();
    expect(githubPluginKey([
      item({ key: "plugin:github@b", id: "github@b", installed: false }),
      item({ key: "plugin:github@a", id: "github@a", installed: true }),
    ])).toBe("plugin:github@a");
    expect(githubPluginKey([
      item({ key: "plugin:tools@a", id: "tools@a", installed: true }),
      { key: "mcp:tools-gh", kind: "mcp", id: "tools-gh", name: "tools-gh", parent: "plugin:tools@a", githubAccount: "connected" } as never,
    ])).toBe("plugin:tools@a");
    expect(githubPluginKey([item({ key: "plugin:tools@a", id: "tools@a", installed: true })])).toBeNull();
  });
});
