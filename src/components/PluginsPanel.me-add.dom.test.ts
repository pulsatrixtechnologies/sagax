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

const MINE = {
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
  "/api/me/connections": MINE,
  "/api/plugins/search": { featured: [], results: [], nextCursor: null, registryAvailable: true },
  "/api/pages": { pages: [] },
  "/api/bot-catalog": { organization: true, viewer: { principalId: "p-1", admin: false, canCreate: true }, entries: [] },
  "/api/bot-presets": { presets: [] },
  "/api/me/harness-connectors": { manageUrl: "", canManage: true, enabled: true, claude: { available: false, connectors: [] } },
  "/api/messages/setup": { useMessages: false },
};

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
        selectedId: "",
        pluginsBotId: null,
        pluginsSurface: "apps",
        bots: [],
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
});
