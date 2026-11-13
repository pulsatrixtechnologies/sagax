// @vitest-environment happy-dom
// Plugins > Me on an organization server (the owner, 2026-11-06): the person's own
// MCP servers are rows of Installed, no "My MCP servers" card at the bottom,
// and "+ Add" offers the same three entries as Organization (Add an MCP
// server, Paste config, New skill), each one in the person's own scope.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadLocale, setLocale } from "@/lib/i18n";

vi.mock("@/lib/use-owner-or-admin", () => ({ useOwnerOrAdmin: () => false }));
vi.mock("@/lib/perspicax-org", () => ({
  usePerspicaxOrg: () => null,
  loadPerspicaxOrg: async () => null,
}));
vi.mock("@/components/DesktopCapabilities", () => ({
  useDesktopCapabilities: () => ({}),
  useCaptionChrome: () => ({ dragProps: {}, controlsShiftStyle: undefined }),
  useMacInsetChrome: () => ({ macInset: false, browser: false }),
}));
// an organization server: Me is the member's own scope
vi.mock("./ServerModeSettings", () => ({ useServerMode: () => ({ active: true }) }));
vi.mock("./McpServersPanel", () => ({
  useMcpServers: () => ({ servers: [], reserved: [], restricted: false, busy: null, policy: null, editing: null, startAdd: () => {}, toggleImport: () => {} }),
  ClaudeCodeSwitches: () => null,
  ClaudeMcpSwitch: () => null,
  McpAuthLine: () => null,
  McpClientForm: () => null,
  McpImportForm: () => null,
  McpMessages: () => null,
  McpReservedServers: () => null,
  McpServerEditor: () => null,
  WhopAction: () => null,
  WhopBelow: () => null,
  isRemoteMcpListing: () => false,
}));
vi.mock("./lazy-screens", () => ({
  BotCatalogPane: Object.assign(() => null, { preload: async () => {} }),
}));
vi.mock("./bot-catalog/use-bot-catalog-sources", () => ({
  useBotCatalogSources: () => ({ entries: [], templates: [], loading: false, error: null, reload: () => {} }),
}));
vi.mock("@/lib/bot-tailscale", () => ({ fetchBotTailscale: async () => null }));
const openExternalLink = vi.fn(async (_url: string) => {});
vi.mock("@/lib/app-links", async () => ({ ...(await vi.importActual<object>("@/lib/app-links")), openExternalLink: (url: string) => openExternalLink(url) }));

const MINE: { github: unknown; sandbox: boolean; servers: Array<Record<string, unknown>> } = {
  github: { state: "none", deviceFlow: true },
  sandbox: true,
  servers: [
    { name: "notes", kind: "remote", type: "http", url: "https://mcp.example.com/mcp", domain: "mcp.example.com", auth: "oauth", tokenConfigured: false, enabled: true, addedAt: 1, authState: "connected" },
  ],
};
const API: Record<string, unknown> = {
  "/api/mcp/servers": { servers: [], reserved: [] },
  "/api/marketplaces": { marketplaces: [] },
  "/api/skills-library": { skills: [] },
  "/api/me/skills-library": { skills: [] },
  "/api/me/plugins": { marketplaces: [], plugins: [], policy: { mode: "any" }, engine: { loadsPlugins: true }, canChange: true },
  "/api/bots/bot-a/capabilities": { items: [] },
  "/api/bots/bot-a/plugins": { marketplaces: [], plugins: [], policy: { mode: "any" }, engine: { loadsPlugins: true }, canChange: true },
  "/api/me/connections": MINE,
  "/api/plugins/search": { featured: [], results: [], nextCursor: null, registryAvailable: true },
  "/api/pages": { pages: [] },
  "/api/bot-catalog": { organization: true, viewer: { principalId: "p-1", admin: false, canCreate: true }, entries: [] },
  "/api/bot-presets": { presets: [] },
  "/api/me/harness-connectors": { manageUrl: "", canManage: true, enabled: true, claude: { available: false, connectors: [] } },
  "/api/messages/setup": { useMessages: false },
};

// #3910: a bot's Add > MCP servers opens Plugins for that bot on the "mcp" surface
let openedFrom: { pluginsBotId: string | null; pluginsSurface: "apps" | "mcp" } = { pluginsBotId: null, pluginsSurface: "apps" };
vi.mock("@/state/store", async () => {
  const actual = await vi.importActual<typeof import("@/state/store")>("@/state/store");
  return {
    ...actual,
    useStore: () => ({
      state: {
        ...actual.initialState,
        pluginsOpen: true,
        activeView: "apps",
        connected: true,
        config: { viewer: { principalId: "p-1", role: "member" } },
        selectedId: openedFrom.pluginsBotId ?? "",
        ...openedFrom,
        bots: openedFrom.pluginsBotId ? [{ id: openedFrom.pluginsBotId, name: "Wren", ownerUserId: "p-1", modelSelection: { instanceId: "codex", model: "default" }, messages: [], tasks: [] }] : [],
        instances: [],
      },
      dispatch: vi.fn(),
    }),
    api: vi.fn(async (path: string, init?: { method?: string }) => {
      if (init?.method === "POST" || init?.method === "PUT") return { servers: MINE.servers, added: [] };
      return API[path.split("?")[0]!] ?? {};
    }),
  };
});

import { PluginsPanel } from "./PluginsPanel";
import { api } from "@/state/store";

const settle = async () => { await act(async () => { for (let index = 0; index < 6; index++) await Promise.resolve(); }); };
const type = (element: HTMLInputElement | HTMLTextAreaElement, value: string) => {
  const proto = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
};

describe("Plugins > Me: the same + Add as Organization, the servers in Installed", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    setLocale("en");
    vi.mocked(api).mockClear();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    openedFrom = { pluginsBotId: null, pluginsSurface: "apps" };
    act(() => root.unmount());
    host.remove();
    setLocale("en");
  });

  const open = async () => {
    await act(async () => { root.render(createElement(PluginsPanel)); });
    await settle();
    const link = host.querySelector<HTMLButtonElement>("[data-plugins-connected]");
    if (link) await act(async () => { link.click(); });
    await settle();
    expect(host.querySelector("[data-plugins-scope]")?.getAttribute("data-plugins-scope")).toBe("me");
  };
  const pick = async (id: string) => {
    await act(async () => { host.querySelector<HTMLButtonElement>("[data-plugins-add]")!.click(); });
    await act(async () => { host.querySelector<HTMLButtonElement>(`[data-plugins-add-action="${id}"]`)!.click(); });
    await settle();
  };
  const calls = (method: string) => vi.mocked(api).mock.calls.filter(([, init]) => (init as { method?: string } | undefined)?.method === method).map(([path]) => path);

  it.each(["en", "fr"])("no My MCP servers card; the person's servers are Installed rows (%s)", async (lang) => {
    await loadLocale(lang);
    await open();
    expect(host.querySelector("[data-plugins-personal]")).toBeNull();
    expect(host.textContent).not.toMatch(/My MCP servers|Mes serveurs MCP|No MCP server of your own yet|Aucun serveur MCP/);
    const row = host.querySelector("[data-plugins-installed] [data-personal-server=\"notes\"]");
    expect(row).not.toBeNull();
    expect(row?.textContent).toContain("mcp.example.com");
  });

  it("+ Add under Me has the three entries of Organization", async () => {
    await open();
    await act(async () => { host.querySelector<HTMLButtonElement>("[data-plugins-add]")!.click(); });
    const ids = [...host.querySelectorAll("[data-plugins-add-action]")].map((item) => item.getAttribute("data-plugins-add-action"));
    expect(ids).toEqual(["server", "paste", "skill"]);
    expect([...host.querySelectorAll("[data-plugins-add-action]")].map((item) => item.textContent)).toEqual(["Add an MCP server", "Paste config", "New skill"]);
  });

  it("Add an MCP server opens the person's own form and saves to /api/me", async () => {
    await open();
    await pick("server");
    const form = host.querySelector<HTMLFormElement>("[data-add-personal-server]")!;
    expect(form).not.toBeNull();
    expect(form.textContent).toContain("never on the Sagax server");
    await act(async () => { type(form.querySelector<HTMLInputElement>("input[aria-label=\"Address\"]") ?? form.querySelectorAll<HTMLInputElement>("input")[1]!, "https://mcp.example.org/mcp"); });
    await act(async () => { form.querySelector<HTMLButtonElement>("button[type=submit]")!.click(); });
    await settle();
    expect(calls("POST")).toContain("/api/me/mcp/servers");
  });

  it("Paste config imports into the person's own servers", async () => {
    await open();
    await pick("paste");
    const box = host.querySelector<HTMLElement>("[data-import-personal-servers]")!;
    expect(box).not.toBeNull();
    await act(async () => { type(box.querySelector("textarea")!, '{"mcpServers":{"wiki":{"url":"https://wiki.example.com/mcp"}}}'); });
    const importButton = [...box.querySelectorAll<HTMLButtonElement>("button")].at(-1)!;
    await act(async () => { importButton.click(); });
    await settle();
    expect(calls("POST")).toContain("/api/me/mcp/servers/import");
  });

  it("New skill opens the skill page on the person's own library", async () => {
    await open();
    vi.mocked(api).mockClear();
    await pick("skill");
    expect(host.querySelector("[data-skill-head]")).not.toBeNull();
    expect(vi.mocked(api).mock.calls.some(([path]) => path === "/api/skills-library")).toBe(false);
  });

  it("a row's menu edits the server in place, with the same form", async () => {
    await open();
    const row = host.querySelector<HTMLElement>("[data-personal-server=\"notes\"]")!;
    await act(async () => { row.querySelector<HTMLButtonElement>("[data-entry-menu]")!.click(); });
    expect([...row.querySelectorAll("[data-entry-action]")].map((item) => item.getAttribute("data-entry-action"))).toEqual(["edit", "signout", "toggle", "remove"]);
    await act(async () => { row.querySelector<HTMLButtonElement>("[data-entry-action=\"edit\"]")!.click(); });
    const form = host.querySelector<HTMLFormElement>("[data-edit-personal-server=\"notes\"]")!;
    expect(form).not.toBeNull();
    await act(async () => { form.querySelector<HTMLButtonElement>("button[type=submit]")!.click(); });
    await settle();
    expect(calls("PUT")).toContain("/api/me/mcp/servers/notes");
  });

  it("a bot's Add > MCP servers lands on Manage where + Add adds a server, not on This bot (#3910)", async () => {
    openedFrom = { pluginsBotId: "bot-a", pluginsSurface: "mcp" };
    await act(async () => { root.render(createElement(PluginsPanel)); });
    await settle();
    // no click on the home's link: it opens on Manage
    expect(host.querySelector("[data-plugins-installed]")).not.toBeNull();
    expect(host.querySelector("[data-plugins-scope]")?.getAttribute("data-plugins-scope")).toBe("me");
    await act(async () => { host.querySelector<HTMLButtonElement>("[data-plugins-add]")!.click(); });
    const ids = [...host.querySelectorAll("[data-plugins-add-action]")].map((item) => item.getAttribute("data-plugins-add-action"));
    expect(ids).toContain("server");
  });

  it("after Add > MCP servers and a close, a plain open of a bot's Plugins lands on the home in This bot (#3910)", async () => {
    const { reducer, initialState } = await vi.importActual<typeof import("@/state/store")>("@/state/store");
    let state = reducer(initialState, { type: "togglePlugins", open: true, surface: "mcp", botId: "bot-a" });
    state = reducer(state, { type: "togglePlugins", open: false });
    state = reducer(state, { type: "togglePlugins", open: true, botId: "bot-a" });
    openedFrom = { pluginsBotId: state.pluginsBotId, pluginsSurface: state.pluginsSurface };
    await act(async () => { root.render(createElement(PluginsPanel)); });
    await settle();
    // the home, not Manage
    expect(host.querySelector("[data-plugins-installed]")).toBeNull();
    const link = host.querySelector<HTMLButtonElement>("[data-plugins-connected]");
    expect(link).not.toBeNull();
    await act(async () => { link!.click(); });
    await settle();
    expect(host.querySelector("[data-plugins-scope]")?.getAttribute("data-plugins-scope")).toBe("bot");
  });
});

// #4207: Connect Apps opens on Me; Recommended for you is its first section
// there too, with the catalog's apps a bot usually wants, each one added as a
// server of the person's own (an organization server).
describe("Connect Apps > Me: Recommended for you first, from the catalog", () => {
  let host: HTMLDivElement;
  let root: Root;
  const search = API["/api/plugins/search"];
  const servers = MINE.servers;

  beforeEach(() => {
    setLocale("en");
    vi.mocked(api).mockClear();
    openExternalLink.mockClear();
    API["/api/plugins/search"] = {
      featured: [
        { id: "linear", name: "Linear", description: "Issues", url: "https://mcp.linear.app/mcp", domain: "linear.app", auth: "oauth" },
        { id: "slack", name: "Slack", description: "Channels", url: "https://mcp.slack.com/mcp", domain: "slack.com", auth: "oauth" },
        { id: "notion", name: "Notion", description: "Pages", url: "https://mcp.notion.com/mcp", domain: "notion.com", auth: "oauth" },
        // a key to paste, or a data center to choose first: not offered here
        { id: "stripe", name: "Stripe", description: "Payments", url: "https://mcp.stripe.com", domain: "stripe.com", auth: "api-key" },
        { id: "sentry", name: "Sentry", description: "Errors", url: "https://us.sentry.io/mcp", domain: "sentry.io", auth: "oauth", regions: [{ id: "us", label: "US", url: "https://us.sentry.io/mcp" }, { id: "de", label: "DE", url: "https://de.sentry.io/mcp" }] },
      ],
      results: [], nextCursor: null, registryAvailable: true,
    };
    // the person already has Notion as a server of their own
    MINE.servers = [...servers, { name: "notion", kind: "remote", type: "http", url: "https://mcp.notion.com/mcp", domain: "mcp.notion.com", auth: "oauth", tokenConfigured: false, enabled: true, addedAt: 2, authState: "connected" }];
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    API["/api/plugins/search"] = search;
    MINE.servers = servers;
    act(() => root.unmount());
    host.remove();
  });

  const home = async () => {
    await act(async () => { root.render(createElement(PluginsPanel)); });
    await settle();
  };
  const shelf = () => [...host.querySelectorAll('[data-plugins-section="recommended"] [data-plugin-row]')].map((row) => row.getAttribute("data-plugin-row"));

  it.each(["en", "fr"])("the home opens on Me with the picks as its first section (%s)", async (lang) => {
    await loadLocale(lang);
    await home();
    const sections = [...host.querySelectorAll("[data-plugins-section]")].map((section) => section.getAttribute("data-plugins-section"));
    expect(sections[0]).toBe("recommended");
    // chat before tickets; what the person has, a key to paste and a data center to choose are left out
    expect(shelf()).toEqual(["featured:slack", "featured:linear"]);
  });

  it("Connect adds the app as the person's own server, then opens its sign-in", async () => {
    await home();
    await act(async () => { host.querySelector<HTMLButtonElement>('[data-personal-connect="slack"]')!.click(); });
    await settle();
    const posts = vi.mocked(api).mock.calls.filter(([, init]) => (init as { method?: string } | undefined)?.method === "POST");
    const add = posts.find(([path]) => path === "/api/me/mcp/servers");
    expect(JSON.parse(String((add?.[1] as { body?: string } | undefined)?.body))).toEqual({ name: "slack", url: "https://mcp.slack.com/mcp", auth: "oauth" });
    expect(posts.map(([path]) => path)).toContain("/api/me/mcp/servers/slack/oauth/start");
    expect(posts.map(([path]) => path)).not.toContain("/api/plugins/install");
    expect(openExternalLink).toHaveBeenCalledTimes(1);
  });
});
