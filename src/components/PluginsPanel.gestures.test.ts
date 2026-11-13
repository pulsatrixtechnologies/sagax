// @vitest-environment happy-dom
// Plugins (Capabilities before #2104), the whole panel (PluginsPanel) driven
// the way the owner uses it (redone 2026-11-06 as the reference app's Connect Apps):
// it opens on the home (the catalogue, "N connected", the one search, Bot
// templates); "N connected" opens Manage ("Manage plugins and skills"), with
// the install scope, one refresh and one + Add; Pages and Sources open from
// Manage, Bots from Bot templates, each under a "< Plugins" back row; a
// click on the GitHub row (not its "...") opens its page over the whole
// pane, with a back button to Manage; marketplace plugins wear their real
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
/** The view on screen: discover (the home), installed (Manage), bots, pages or sources. */
const selected = () => $("[data-plugins-main]")?.getAttribute("data-plugins-main") ?? null;
const title = () => $("#plugins-title")?.textContent;
/** Back to the home, from a page or a view. */
const home = async () => {
  while ($("[data-plugins-subpage]") && $("[data-plugins-back]")) await click($("[data-plugins-back]"));
  if (selected() !== "discover") await click($("[data-plugins-home]"));
};
/** The way a person reaches a view: Manage by "N connected", Pages and Sources from Manage, Bots by Bot templates. */
const go = async (view: "installed" | "bots" | "pages" | "sources") => {
  await home();
  if (view === "bots") return click($("[data-plugins-bot-templates]"));
  await click($("[data-plugins-connected]"));
  if (view !== "installed") await click($(`[data-plugins-view-link="${view}"]`));
};
const installedNames = () => [...host.querySelectorAll<HTMLElement>("[data-installed-entry]")].map((row) => row.querySelector("span.truncate")?.textContent);

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
  // the scope lives in Manage: the organization's, then back to the home
  if (personal) return;
  await go("installed");
  if ($('[data-plugins-scope-option="workspace"]')) await click($('[data-plugins-scope-option="workspace"]'));
  await home();
};

describe("Plugins, driven like the owner does", () => {
  it("opens on Me without an organization permission and keeps its installs separate", async () => {
    owner = false;
    await open(true);
    // the reference app's home has no scope line: the scope and its note are in Manage
    expect($('[data-plugins-main="discover"] [data-plugins-scope-note]')).toBeNull();
    await go("installed");
    expect($('[data-plugins-scope-note="me"]')).not.toBeNull();
    expect($('[data-plugins-scope-option="workspace"]')).toBeNull();
    expect($('[data-plugins-scope-option="me"]')?.getAttribute("aria-checked")).toBe("true");
    expect(host.textContent).toContain("Personal Review");
    expect(host.textContent).toContain("my-writing");
    expect(host.textContent).not.toContain("Twilio Docs");
    expect($("[data-plugins-add]")).toBeTruthy();
    await click($("[data-plugins-add]"));
    expect($('[data-plugins-add-action="skill"]')).toBeTruthy();
    await click($("[data-plugins-add]"));
    await click($('[data-plugins-scope-option="bot"]'));
    expect(host.textContent).not.toContain("Personal Review");
    await click($('[data-plugins-scope-option="me"]'));
    expect(host.textContent).toContain("Personal Review");
  });

  it("opens on the home; every view is one click away and has its way back (#2104, the reference app's Connect Apps)", async () => {
    paneProps = null;
    await open();
    expect(selected()).toBe("discover");
    expect(title()).toBe("Connect Apps");
    expect($('[role="tablist"]')).toBeNull();
    expect($("[data-plugins-search]")).not.toBeNull();
    expect($("[data-plugins-bot-templates]")).not.toBeNull();
    await go("installed");
    expect(selected()).toBe("installed");
    expect(title()).toBe("Manage plugins and skills");
    expect([...host.querySelectorAll("[data-plugins-view-link]")].map((link) => link.getAttribute("data-plugins-view-link"))).toEqual(["pages", "sources"]);
    for (const view of ["pages", "sources", "bots"] as const) {
      await go(view);
      expect(selected(), view).toBe(view);
      expect($(`[data-plugins-manage="${view}"]`), view).not.toBeNull();
      expect($("[data-plugins-home]")?.textContent, view).toBe("Connect Apps");
    }
    await click($("[data-plugins-home]"));
    expect(selected()).toBe("discover");
    expect($("[data-apps-back]")).toBeNull();
  });

  it("Bots opens from Bot templates or a search result; the scope is not drawn there; the home has no Browse Bots button (#2104)", async () => {
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
    expect(selected()).toBe("discover");
    await click($("[data-plugins-bot-templates]"));
    expect(selected()).toBe("bots");
  });

  it("one search on the home looks everywhere, grouped by kind; empty, the catalogue is back", async () => {
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
    await type("nothing like this");
    expect($("[data-plugins-search-empty]")?.textContent).toContain("Nothing matches");
    await type("");
    expect($("[data-plugins-results]")).toBeNull();
    expect($("[data-plugins-discover]")).not.toBeNull();
  });

  it("the search row: the round search, then Bot templates; it sticks to the top", async () => {
    await open();
    const row = $("[data-plugins-search-row]")!;
    expect([...row.children].map((child) => child.hasAttribute("data-plugins-search-slot") ? "search" : child.hasAttribute("data-plugins-bot-templates") ? "templates" : "other")).toEqual(["search", "templates"]);
    expect(row.className).toContain("sticky");
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
    // back on the home, the field is empty
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

  it("Pages opens from Manage: Your pages there, nothing about pages left in Manage, no scope (#2104)", async () => {
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

  it("every option once on Manage: one scope bar, one refresh, one + Add, no service pills, one Manage per engine (#2104)", async () => {
    await open();
    await go("installed");
    expect(host.querySelectorAll("[data-plugins-scope-bar]")).toHaveLength(1);
    expect(host.querySelectorAll('button[aria-label^="Refresh"]')).toHaveLength(1);
    expect(host.querySelectorAll("[data-plugins-add]")).toHaveLength(1);
    expect(host.querySelectorAll("[data-plugins-add-server]")).toHaveLength(0);
    expect(host.querySelectorAll("[data-plugins-new-skill]")).toHaveLength(0);
    expect(host.querySelectorAll("[data-accounts-service-pill]")).toHaveLength(0);
    expect(host.querySelectorAll("[data-connect-from-engine]")).toHaveLength(0);
    expect(host.textContent).not.toContain("See all");
    // Manage on <engine> lives in each account row's menu here, and once per engine on Discover's section heads (#2306)
    expect(host.querySelectorAll("[data-harness-manage]")).toHaveLength(0);
    // the + Add menu: a server, a pasted config, a skill, each once
    await click($("[data-plugins-add]"));
    expect([...host.querySelectorAll("[data-plugins-add-action]")].map((item) => item.getAttribute("data-plugins-add-action"))).toEqual(["server", "paste", "skill"]);
    await click($('[data-plugins-add-action="server"]'));
    expect($("[data-plugins-add-action]")).toBeNull();
    expect(host.textContent).toContain("Add MCP server");
  });

  it("the home's \"N connected\" counts what Manage lists and opens it", async () => {
    await open();
    // GitHub, Code Review, Frontend Design, Ops Flow, Twilio Docs: five connected entries,
    // and the engine accounts' connected connectors, which Manage lists as rows of their own (#2306)
    const count = Number($("[data-plugins-connected]")?.getAttribute("data-plugins-connected"));
    expect(count).toBeGreaterThanOrEqual(6);
    expect($("[data-plugins-connected]")?.textContent).toContain(`${count} connected`);
    await click($("[data-plugins-connected]"));
    expect(selected()).toBe("installed");
    if ($("[data-plugins-show-all]")) await click($("[data-plugins-show-all]"));
    const connectedRows = [...host.querySelectorAll<HTMLElement>("[data-installed-entry]")]
      .filter((row) => !row.getAttribute("data-installed-entry")!.startsWith("account:") || row.querySelector('[data-harness-status="connected"]'));
    expect(connectedRows.length).toBe(count);
  });

  it("an old link to My accounts or Providers opens Manage, with the Providers section; a link to the pages opens Pages", async () => {
    try {
      for (const old of ["accounts", "providers"]) {
        (state as { pluginsPage: string | null }).pluginsPage = old;
        await open();
        if (selected() !== "installed") await go("installed");
        expect(selected()).toBe("installed");
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

  it("keeps the scope under the big title on Manage and Sources", async () => {
    await open();
    for (const view of ["installed", "sources"] as const) {
      await go(view);
      expect($("[data-plugins-scope-bar]"), view).not.toBeNull();
      expect($("[data-plugins-scope-slot]")?.previousElementSibling?.id, view).toBe("plugins-title");
    }
  });

  it("Manage: one row per installed thing, each with its real mark; the puzzle only without one", async () => {
    await open();
    await go("installed");
    const rows = [...host.querySelectorAll<HTMLElement>("[data-installed-entry]")];
    expect(installedNames().slice(0, 5)).toEqual(["Code Review", "Frontend Design", "GitHub", "Ops Flow", "Twilio Docs"]);
    // the engine accounts' connectors follow, connected first (#2306)
    expect(rows[5]?.getAttribute("data-installed-entry")).toBe("account:claude:Gmail");
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

  it("a click on the GitHub row itself opens its page over the pane: a back button to Installed, the name once", async () => {
    await open();
    await go("installed");
    const row = () => [...host.querySelectorAll<HTMLElement>("[data-installed-entry] button[aria-label]")].find((button) => button.textContent?.includes("GitHub"))!;
    await click(row());
    expect($("[data-plugins-subpage]")).not.toBeNull();
    expect(selected()).toBe("installed");
    expect($("[data-plugins-back]")?.getAttribute("aria-label")).toBe("Back to Installed");
    expect($("[data-plugins-detail-name]")?.textContent).toBe("GitHub");
    expect($("[data-plugins-detail-head] img")).not.toBeNull();
    expect($("[data-plugins-detail-meta]")?.textContent).toMatch(/^github · anthropics\/claude-plugins-official/);
    expect([...host.querySelectorAll("[data-install-state]")].map((node) => node.textContent)).toEqual(["Installed for everyone", "Not installed on Rocket"]);
    // back to the list
    await click($("[data-plugins-back]"));
    expect($("[data-plugins-subpage]")).toBeNull();
    expect($('[data-plugins-manage="installed"]')).not.toBeNull();
    // the scope of the bot: its main action beside the name
    await click($('[data-plugins-scope-option="bot"]'));
    await home();
    await type("github");
    await click($('[data-plugins-search-group="plugins"] [role="option"]'));
    expect($("[data-plugins-detail-primary]")?.textContent).toBe("Install for Rocket");
  });

  it("Manage > engine accounts: Claude beside Grok when its connectors cannot be read, with why and Connect Claude", async () => {
    harness = { manageUrl: "https://claude.ai/customize/connectors", claude: { available: false, reason: "not_signed_in", connectors: [] }, codex: { available: false } };
    await open();
    await go("installed");
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
