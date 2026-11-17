// @vitest-environment happy-dom
// Connect Apps (Capabilities before #2104), the whole panel (PluginsPanel)
// driven the way the owner uses it (#4453, 2026-11-16: three kinds, Skills,
// Connectors and Plugins, each with Yours and Discover, the install scope,
// one refresh, one search and one + Add; Bot templates, Published pages and
// Sources under the title bar's "...", each under a "< Connect Apps" back
// row); a click on the GitHub row (not its "...") opens its page over the
// whole pane, with a back button to its kind; marketplace plugins wear their real
// mark; the engine accounts show a Claude section beside Grok even when
// Claude's connectors cannot be read, with the way to connect. The /api
// answers are a stand-in shaped like an organization member's (names
// neutral).
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
/** The view on screen: installed (Yours), discover, bots, pages or sources. */
const selected = () => $("[data-plugins-main]")?.getAttribute("data-plugins-main") ?? null;
const title = () => $("#plugins-title")?.textContent;
/** Out of any page or view, back to Yours or Discover. */
const home = async () => {
  while ($("[data-plugins-subpage]") && $("[data-plugins-back]")) await click($("[data-plugins-back]"));
  if (selected() !== "installed" && selected() !== "discover") await click($("[data-plugins-home]"));
};
/** The way a person reaches a view: Yours and Discover by the segment, Bots, Pages and Sources by "...". */
const go = async (view: "installed" | "discover" | "bots" | "pages" | "sources") => {
  await home();
  if (view === "installed" || view === "discover") return click($(`[data-plugins-view="${view}"]`));
  await click($("[data-plugins-more-button]"));
  await click($(`[data-plugins-view-link="${view}"]`));
};
/** A kind's tab. */
const kind = (name: "skills" | "connectors" | "plugins") => click($(`[data-plugins-kind-tab="${name}"]`));
const installedNames = () => [...host.querySelectorAll<HTMLElement>("[data-installed-entry]")].map((row) => row.querySelector("span.truncate")?.textContent);

beforeEach(async () => {
  // any raw request (no server here) answers 404 at once
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "test" }), { status: 404, headers: { "content-type": "application/json" } })));
  setLocale("en");
  try { window.localStorage.clear(); } catch { /* none */ }
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
  if (personal) return;
  await go("installed");
  await home();
};
/** Opened from a bot's page: the window works on that bot (#4453: no scope control, the bot is the scope). */
const openFromBot = async () => {
  await act(async () => root.render(createElement("div")));
  (state as { pluginsBotId: string | null }).pluginsBotId = "bot-a";
  await open(true);
};
const fromBotDone = () => { (state as { pluginsBotId: string | null }).pluginsBotId = null; };

describe("Plugins, driven like the owner does", () => {
  it("opens on Me without an organization permission and keeps its installs separate", async () => {
    owner = false;
    await open(true);
    await go("installed");
    expect($('[data-plugins-scope-note="me"]')).not.toBeNull();
    // #4453: no scope control at all; the window works on the person's own
    expect($("[data-plugins-scope-option]")).toBeNull();
    expect($("[data-plugins-scope]")?.getAttribute("data-plugins-scope")).toBe("me");
    await kind("plugins");
    expect(host.textContent).toContain("Personal Review");
    await kind("skills");
    expect(host.textContent).toContain("my-writing");
    expect(host.textContent).not.toContain("Personal Review");
    await kind("connectors");
    expect(host.textContent).not.toContain("Twilio Docs");
    await kind("skills");
    expect($("[data-plugins-add]")).toBeTruthy();
    await click($("[data-plugins-add]"));
    expect($('[data-plugins-add-action="skill"]')).toBeTruthy();
    await click($("[data-plugins-add]"));
    await kind("plugins");
    expect(host.textContent).toContain("Personal Review");
    // opened from a bot's page the window works on that bot alone: the title carries its name
    try {
      await openFromBot();
      await go("installed");
      expect($("[data-plugins-scope]")?.getAttribute("data-plugins-scope")).toBe("bot");
      expect(title()).toBe("Connect Apps \u00b7 Rocket");
      await kind("plugins");
      expect(host.textContent).not.toContain("Personal Review");
    } finally {
      fromBotDone();
    }
  });

  it("#4453: a person's plugin says where it is on, has its switch, and a right click opens its menu", async () => {
    owner = false;
    await open(true);
    await go("installed");
    await kind("plugins");
    const row = $('[data-installed-entry="plugin:personal-review@my-tools"]')!;
    expect(row).not.toBeNull();
    // the state icon column, the switch, then "...": the default scope is not printed
    expect(row.querySelector("[data-row-scope]")).toBeNull();
    expect(row.querySelector("[data-row-switch]")?.getAttribute("aria-checked")).toBe("true");
    expect(row.querySelector("[data-entry-menu]")).not.toBeNull();
    // a right click anywhere on the row opens the same menu
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 30, clientY: 30 });
    await act(async () => { row.querySelector("span.truncate")!.dispatchEvent(event); });
    expect(event.defaultPrevented).toBe(true);
    const lines = [...row.querySelectorAll("[data-entry-action]")].map((item) => item.getAttribute("data-entry-action"));
    expect(lines).toEqual(expect.arrayContaining(["off", "detail", "remove"]));
    // a person's plugin is on for all their bots already: no Turn on
    expect(lines).not.toContain("all");
    // See the detail opens the plugin's page
    await click(row.querySelector('[data-entry-action="detail"]'));
    expect($("[data-plugins-subpage]")).not.toBeNull();
  });

  it("#4453: three kind tabs, Yours and Discover; every other view one click away under \"...\" with its way back", async () => {
    paneProps = null;
    await open();
    expect(["installed", "discover"]).toContain(selected());
    expect(title()).toBe("Connect Apps");
    expect([...host.querySelectorAll("[data-plugins-kind-tab]")].map((tab) => tab.textContent?.replace(/\d+$/, ""))).toEqual(["Skills", "Connectors", "Plugins"]);
    expect($("[data-plugins-search]")).not.toBeNull();
    await go("installed");
    expect(selected()).toBe("installed");
    expect(title()).toBe("Connect Apps");
    await go("discover");
    expect(selected()).toBe("discover");
    await click($("[data-plugins-more-button]"));
    expect([...host.querySelectorAll("[data-plugins-view-link]")].map((link) => link.getAttribute("data-plugins-view-link"))).toEqual(["bots", "pages", "sources"]);
    await click($("[data-plugins-more-button]"));
    for (const view of ["pages", "sources", "bots"] as const) {
      await go(view);
      expect(selected(), view).toBe(view);
      expect($(`[data-plugins-manage="${view}"]`), view).not.toBeNull();
      expect($("[data-plugins-home]")?.textContent, view).toBe("Connect Apps");
    }
    // back where the person was
    await click($("[data-plugins-home]"));
    expect(selected()).toBe("discover");
    expect($("[data-apps-back]")).toBeNull();
    // a kind keeps the view open
    await kind("plugins");
    expect(selected()).toBe("discover");
    expect($('[data-plugins-kind-tab="plugins"]')?.getAttribute("aria-selected")).toBe("true");
  });

  it("Bots opens from \"...\" or a search result; the scope is not drawn there; no Browse Bots button (#2104, #4453)", async () => {
    paneProps = null;
    await open();
    expect($('[data-plugins-manage="discover"] [data-plugins-discover] input')).toBeNull();
    expect($("[data-plugins-browse-bots]")).toBeNull();
    expect(host.textContent).not.toContain("Browse bots");
    await type("quill");
    await click($('[data-plugins-search-group="bots"] [role="option"]'));
    expect(selected()).toBe("bots");
    expect($("[data-test-bot-pane]")?.textContent).toBe("Bots");
    expect(lastPane()?.sources).toBeTruthy();
    // the install scope does not apply to bots
    expect($("[data-plugins-scope-slot]")).toBeNull();
    await click($("[data-plugins-home]"));
    expect(["installed", "discover"]).toContain(selected());
    await go("bots");
    expect(selected()).toBe("bots");
  });

  it("one search looks everywhere, grouped by kind; empty, the list is back", async () => {
    await open();
    await go("discover");
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
    await type("nothing like this");
    expect($("[data-plugins-search-empty]")?.textContent).toContain("Nothing matches");
    await type("");
    expect($("[data-plugins-results]")).toBeNull();
    expect($("[data-plugins-discover]")).not.toBeNull();
  });

  it("#4453: the title line keeps the title and \"...\"; ONE row holds the kinds, a separator, Yours | Discover, the search and Add; the head stays out of the scrolling list", async () => {
    await open();
    const head = $("[data-plugins-head]")!;
    expect(head.querySelector("#plugins-title")).not.toBeNull();
    expect(head.querySelector("[data-plugins-more-button]")).not.toBeNull();
    expect(head.querySelector("[data-plugins-search]")).toBeNull();
    expect(head.querySelector("[data-plugins-add]")).toBeNull();
    const row = $("[data-plugins-kind-row]")!;
    expect([...row.children].map((child) => child.matches("[data-plugins-kinds]") ? "kinds" : child.matches("[data-plugins-separator]") ? "separator" : child.matches("[data-plugins-views]") ? "views" : child.matches("[data-plugins-actions]") ? "actions" : "other")).toEqual(["kinds", "separator", "views", "actions"]);
    const actions = row.querySelector("[data-plugins-actions]")!;
    expect(actions.querySelector("[data-plugins-search-slot] [data-plugins-search]")).not.toBeNull();
    expect(actions.querySelector("[data-plugins-sort-button]")).not.toBeNull();
    expect(actions.querySelector("[data-plugins-add]")).not.toBeNull();
    expect($("[data-plugins-view-row]")).toBeNull();
    expect($("[data-plugins-list]")?.contains($("[data-plugins-title-row]"))).toBe(false);
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
    expect(selected()).toBe("bots");
    expect(lastPane()?.focus?.key).toBe("bot:bot-c");
    // back on the list, the field is empty
    await click($("[data-plugins-home]"));
    expect(($("[data-plugins-search]") as HTMLInputElement).value).toBe("");
    // Escape with text empties the field and keeps the window open
    await type("review");
    dispatch.mockClear();
    await key("Escape");
    expect(($("[data-plugins-search]") as HTMLInputElement).value).toBe("");
    expect(dispatch).not.toHaveBeenCalled();
    expect($("[data-plugins-results]")).toBeNull();
  });

  it("a result opens its page or its view: a plugin its page, a page and a source their view", async () => {
    await open();
    await type("code review");
    await click($('[data-plugins-search-group="plugins"] [role="option"]'));
    expect($("[data-plugins-subpage]")).not.toBeNull();
    expect(host.textContent).toContain("Code Review");
    await home();
    await type("weekly");
    await click($('[data-plugins-search-group="pages"] [role="option"]'));
    expect(selected()).toBe("pages");
    await home();
    await type("example-ops");
    await click($('[data-plugins-search-group="sources"] [role="option"]'));
    expect(selected()).toBe("sources");
  });

  it("Pages opens from \"...\": Your pages there, nothing about pages left in Yours, no scope (#2104, #4453)", async () => {
    await open();
    await go("installed");
    expect($("[data-plugins-pages]")).toBeNull();
    expect($('[data-plugins-manage="installed"]')?.textContent).not.toContain("Your pages");
    expect($('[data-plugins-manage="installed"] [data-settings-card="pages"]')).toBeNull();
    await go("pages");
    expect($('[data-plugins-manage="pages"] [data-settings-card="pages"]')).not.toBeNull();
    expect($('[data-plugins-manage="pages"]')?.textContent).toContain("Your pages");
    expect($('[data-plugins-manage="pages"]')?.textContent).toContain("Weekly KPIs");
    expect($("[data-plugins-scope-slot]")).toBeNull();
  });

  it("every option once: no scope bar, one refresh, one + Add by kind, no service pills, one Manage per engine (#2104, #4453)", async () => {
    await open();
    await go("installed");
    await kind("connectors");
    expect(host.querySelectorAll("[data-plugins-scope-bar]")).toHaveLength(0);
    // Refresh left the header: it is the first line of the title bar's "..." menu
    expect(host.querySelectorAll('button[aria-label^="Refresh"]')).toHaveLength(0);
    expect($("[data-plugins-refresh]")).toBeNull();
    await click($("[data-plugins-more-button]"));
    expect([...host.querySelectorAll('[role="menu"] [role="menuitem"]')][0]?.getAttribute("data-plugins-refresh")).toBe("");
    expect([...host.querySelectorAll('[role="menu"] [role="menuitem"]')][0]?.textContent).toBe("Refresh");
    await click($("[data-plugins-more-button]"));
    expect(host.querySelectorAll("[data-plugins-add]")).toHaveLength(1);
    expect(host.querySelectorAll("[data-plugins-add-server]")).toHaveLength(0);
    expect(host.querySelectorAll("[data-plugins-new-skill]")).toHaveLength(0);
    expect(host.querySelectorAll("[data-accounts-service-pill]")).toHaveLength(0);
    expect(host.querySelectorAll("[data-connect-from-engine]")).toHaveLength(0);
    expect(host.textContent).not.toContain("See all");
    // Manage on <engine> lives in each account row's menu here, and once per engine on Discover's section heads (#2306)
    expect(host.querySelectorAll("[data-harness-manage]")).toHaveLength(0);
    const addMenu = async () => {
      await click($("[data-plugins-add]"));
      const ids = [...host.querySelectorAll("[data-plugins-add-action]")].map((item) => item.getAttribute("data-plugins-add-action"));
      return ids;
    };
    // the + Add of each kind: its own ways, each once
    expect(await addMenu()).toEqual(["catalog", "server", "paste", "url"]);
    await click($("[data-plugins-add]"));
    await kind("skills");
    expect(await addMenu()).toEqual(["skill"]);
    await click($("[data-plugins-add]"));
    await kind("plugins");
    expect(await addMenu()).toEqual(["marketplace-plugin", "marketplace"]);
    await click($('[data-plugins-add-action="marketplace"]'));
    expect(selected()).toBe("sources");
    await go("installed");
    await kind("connectors");
    await addMenu();
    await click($('[data-plugins-add-action="server"]'));
    expect($("[data-plugins-add-action]")).toBeNull();
    expect(host.textContent).toContain("Add MCP server");
  });

  it("#4453: the pill tabs carry no counts; each kind's Yours lists its own rows", async () => {
    await open();
    await go("installed");
    expect($("[data-plugins-kind-count]")).toBeNull();
    // GitHub, Code Review, Frontend Design, Ops Flow are plugins; Twilio Docs and the engine accounts' rows connectors
    await kind("plugins");
    expect(host.querySelectorAll("[data-installed-entry]")).toHaveLength(4);
    await kind("connectors");
    expect(host.querySelectorAll("[data-installed-entry]").length).toBeGreaterThanOrEqual(3);
  });

  it("an old link to My accounts or Providers opens Manage, with the Providers section; a link to the pages opens Pages", async () => {
    try {
      for (const old of ["accounts", "providers"]) {
        (state as { pluginsPage: string | null }).pluginsPage = old;
        await open();
        if (selected() !== "installed") await go("installed");
        expect(selected()).toBe("installed");
        expect($('[data-plugins-kind-tab="connectors"]')?.getAttribute("aria-selected")).toBe("true");
        expect($('[data-plugins-manage="installed"] [data-plugins-providers]')).not.toBeNull();
        expect($('[data-plugins-manage="installed"] [data-installed-entry^="account:"]')).not.toBeNull();
        await act(async () => root.render(createElement("div")));
      }
      (state as { pluginsPage: string | null }).pluginsPage = "pages";
      await open(true);
      expect(selected()).toBe("pages");
      expect($('[data-plugins-manage="pages"]')?.textContent).toContain("Your pages");
      await act(async () => root.render(createElement("div")));
      (state as { pluginsPage: string | null }).pluginsPage = "bots";
      await open(true);
      expect(selected()).toBe("bots");
      expect($("[data-plugins-home]")).not.toBeNull();
    } finally {
      (state as { pluginsPage: string | null }).pluginsPage = null;
    }
  });

  it("keeps one row of controls on Yours, with no scope anywhere, Sources included (#4453)", async () => {
    await open();
    await go("installed");
    expect($("[data-plugins-scope-bar]")).toBeNull();
    expect($("[data-plugins-scope-slot]")).toBeNull();
    expect($("[data-plugins-kind-row] [data-plugins-kinds]")).not.toBeNull();
    expect($("[data-plugins-kind-row] [data-plugins-views]")).not.toBeNull();
    expect($("[data-plugins-kind-row] [data-plugins-search]")).not.toBeNull();
    expect($("[data-plugins-kind-row] [data-plugins-add]")).not.toBeNull();
    // the filter is Discover's alone; the sort is on both
    expect($("[data-plugins-filter]")).toBeNull();
    expect($("[data-plugins-sort]")).not.toBeNull();
    await go("sources");
    expect($("[data-plugins-scope-bar]")).toBeNull();
    expect($("[data-plugins-scope-slot]")).toBeNull();
  });

  it("Yours: one row per installed thing in its kind, each with its real mark; the puzzle only without one", async () => {
    await open();
    await go("installed");
    await kind("connectors");
    // a server, then the engine accounts' connectors, connected first (#2306)
    expect(installedNames()[0]).toBe("Twilio Docs");
    expect(host.querySelectorAll("[data-installed-entry]")[1]?.getAttribute("data-installed-entry")).toBe("account:claude:Gmail");
    await kind("plugins");
    const rows = [...host.querySelectorAll<HTMLElement>("[data-installed-entry]")];
    expect(installedNames()).toEqual(["Code Review", "Frontend Design", "GitHub", "Ops Flow"]);
    const mark = (name: string) => {
      const row = rows.find((candidate) => candidate.querySelector("span.truncate")?.textContent === name)!;
      const img = row.querySelector("img");
      return img ? img.getAttribute("src") : row.querySelector("svg.lucide-puzzle") ? "puzzle" : "other";
    };
    expect(mark("GitHub")).toContain("github.com");
    expect(mark("Frontend Design")).toContain("design.example.com");
    expect(mark("Ops Flow")).toBe("https://ops.example.com/icon.png");
    // a homepage that is only its repository on a code host is not its mark
    expect(mark("Code Review")).toBe("puzzle");
  });

  it("a click on the GitHub row itself opens its page over the pane: a back button to its kind, the name once", async () => {
    await open();
    await go("installed");
    await kind("plugins");
    const row = () => [...host.querySelectorAll<HTMLElement>("[data-installed-entry] button[aria-label]")].find((button) => button.textContent?.includes("GitHub"))!;
    await click(row());
    expect($("[data-plugins-subpage]")).not.toBeNull();
    expect(selected()).toBe("installed");
    expect($("[data-plugins-back]")?.getAttribute("aria-label")).toBe("Back to Plugins");
    expect($("[data-plugins-detail-name]")?.textContent).toBe("GitHub");
    expect($("[data-plugins-detail-head] img")).not.toBeNull();
    expect($("[data-plugins-detail-meta]")?.textContent).toMatch(/^github · anthropics\/claude-plugins-official/);
    expect([...host.querySelectorAll("[data-install-state]")].map((node) => node.textContent)).toEqual(["Installed for everyone", "Not installed on Rocket"]);
    // back to the list
    await click($("[data-plugins-back]"));
    expect($("[data-plugins-subpage]")).toBeNull();
    expect($('[data-plugins-manage="installed"]')).not.toBeNull();
    // opened from a bot's page: its main action beside the name
    try {
      await openFromBot();
      await home();
    } finally {
      fromBotDone();
    }
    await type("github");
    await click($('[data-plugins-search-group="plugins"] [role="option"]'));
    expect($("[data-plugins-detail-primary]")?.textContent).toBe("Install for Rocket");
  });

  it("Manage > engine accounts: Claude beside Grok when its connectors cannot be read, with why and Connect Claude", async () => {
    harness = { manageUrl: "https://claude.ai/customize/connectors", claude: { available: false, reason: "not_signed_in", connectors: [] }, codex: { available: false } };
    await open();
    await go("installed");
    await kind("connectors");
    expect($("[data-accounts-service-pill]")).toBeNull();
    expect($("[data-harness-group]")).toBeNull();
    expect($('[data-harness-notice="not_signed_in"]')?.textContent).toContain("not signed in to Claude");
    await click($('[data-harness-setup="claude"]'));
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: "togglePlugins", open: false }));
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: "toggleAppSettings", open: true, section: "engines" }));
  });

  it("Manage > engine accounts: the Claude account's connectors listed like Grok's when they are read", async () => {
    await open();
    await go("installed");
    await kind("connectors");
    expect($('[data-installed-entry="account:claude:Gmail"]')).not.toBeNull();
    if ($("[data-plugins-show-all]")) await click($("[data-plugins-show-all]"));
    expect($('[data-installed-entry="account:claude:Canva"] [data-harness-signin][data-harness-status="needs_auth"]')).not.toBeNull();
    expect($("[data-harness-notice]")).toBeNull();
  });

  it("GitHub lives on the GitHub plugin's page: not in the engine accounts; Sources and the plugin's server lead there", async () => {
    const servers = (API["/api/mcp/servers"] as { servers: Array<Record<string, unknown>> }).servers;
    const plugin = servers.find((server) => server.name === "github-github")!;
    plugin.github = "missing";
    const githubRow = () => [...host.querySelectorAll<HTMLElement>("[data-installed-entry] button[aria-label]")].find((button) => button.textContent?.includes("GitHub"))!;
    try {
      await open();
      // the engine accounts: no GitHub card nor section
      await go("installed");
      await kind("plugins");
      expect($('[data-accounts-service-pill="github"]')).toBeNull();
      expect($("[data-plugins-github-card]")).toBeNull();
      expect($("[data-accounts-github]")).toBeNull();
      // Manage > GitHub: the plugin's page holds the connection, first
      await click(githubRow());
      expect($("[data-plugins-detail]")?.getAttribute("data-plugins-detail")).toBe("plugin:github@claude-plugins-official");
      expect($("[data-plugins-detail] [data-accounts-github]")).not.toBeNull();
      // no link to itself
      expect($("[data-plugin-github-account]")).toBeNull();
      // Sources: one row that opens that same page, in Sources
      await go("sources");
      expect($("[data-plugins-marketplaces]")).not.toBeNull();
      expect($('[data-plugins-manage="sources"] [data-accounts-github]')).toBeNull();
      await click($("[data-plugins-sources-github-open]"));
      expect(selected()).toBe("sources");
      expect($("[data-plugins-detail]")?.getAttribute("data-plugins-detail")).toBe("plugin:github@claude-plugins-official");
      expect($("[data-accounts-github]")).not.toBeNull();
      // the plugin's server page: Open the GitHub plugin leads there too
      await go("installed");
      await click(githubRow());
      // the server rows sit behind the collapsed Tools card (Connect Apps parity, #2104)
      await click($("[data-plugin-tools-toggle]"));
      await click($('[data-plugin-tool-open="github-github"]'));
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
      await go("sources");
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
