// @vitest-environment happy-dom
// Plugins (Capabilities before #2104) opens as a centred modal (decided exception like Settings).
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadLocale, setLocale } from "@/lib/i18n";
import { flowSupersededFixture, flowSupersededPluginsFixture } from "@/lib/flow-superseded.fixture";
import type { BotCapabilities } from "@/lib/capabilities";
import { CATEGORY_MODAL } from "./category-modal";

let owner = true;
let resolved: BotCapabilities | null = null;
let canChange = true;
let removeWait: Promise<void> | null = null;
let removeError = false;
vi.mock("@/lib/use-owner-or-admin", () => ({ useOwnerOrAdmin: () => owner }));
vi.mock("@/lib/perspicax-org", () => ({
  usePerspicaxOrg: () => null,
  loadPerspicaxOrg: async () => null,
}));
vi.mock("@/components/DesktopCapabilities", () => ({
  useDesktopCapabilities: () => ({}),
  useCaptionChrome: () => ({ dragProps: {}, controlsShiftStyle: undefined }),
  useMacInsetChrome: () => ({ macInset: false, browser: false }),
}));
vi.mock("./ServerModeSettings", () => ({ useServerMode: () => null }));
vi.mock("./McpServersPanel", () => ({
  useMcpServers: () => ({ servers: [], reserved: [], restricted: false, busy: null, policy: null, editing: null, startAdd: () => {}, toggleImport: () => {} }),
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
vi.mock("./settings/MyConnectionsSettings", () => ({
  MyGithubConnection: () => null,
  MyGithubSummary: () => null,
  MyMcpServers: () => null,
}));
vi.mock("./lazy-screens", () => ({
  BotCatalogPane: Object.assign(() => null, { preload: async () => {} }),
}));
vi.mock("./bot-catalog/use-bot-catalog-sources", () => ({
  useBotCatalogSources: () => ({ entries: [], templates: [], loading: false, error: null, reload: () => {} }),
}));
vi.mock("@/lib/my-connections", async () => {
  const actual = await vi.importActual<typeof import("@/lib/my-connections")>("@/lib/my-connections");
  return {
    ...actual,
    loadBotPlugins: async () => resolved
      ? { ...flowSupersededPluginsFixture(resolved.items.some((item) => item.scope === "bot")), canChange }
      : { marketplaces: [], plugins: [], policy: { mode: "any" }, engine: { loadsPlugins: true }, canChange },
  };
});
vi.mock("@/lib/bot-tailscale", () => ({ fetchBotTailscale: async () => null }));
vi.mock("@/lib/capabilities", async () => {
  const actual = await vi.importActual<typeof import("@/lib/capabilities")>("@/lib/capabilities");
  return { ...actual, useBotCapabilities: () => ({ data: resolved, error: null, reload: () => {} }) };
});

const API: Record<string, unknown> = {
  "/api/mcp/servers": { servers: [], reserved: [] },
  "/api/marketplaces": { marketplaces: [] },
  "/api/skills-library": { skills: [] },
  "/api/plugins/search": { featured: [], results: [], nextCursor: null, registryAvailable: true },
  "/api/pages": { pages: [] },
  "/api/bot-catalog": { organization: false, viewer: { principalId: "p-1", admin: true, canCreate: true }, entries: [] },
  "/api/team-library/xai": { label: "xAI", url: "https://x.ai", fetchedAt: 1, bots: [] },
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
        config: { viewer: { principalId: "p-1", role: owner ? "owner" : "member" } },
        selectedId: resolved ? "bot-a" : "",
        pluginsBotId: resolved ? "bot-a" : null,
        pluginsSurface: resolved ? "mcp" : "apps",
        bots: resolved ? [{ id: "bot-a", name: "Wren", ownerUserId: "p-1", modelSelection: { instanceId: "codex", model: "default" }, messages: [], tasks: [] }] : [],
        instances: [],
      },
      dispatch: vi.fn(),
    }),
    api: vi.fn(async (path: string, init?: { method?: string }) => {
      if (path === "/api/bots/bot-a/plugins/pulsatrix-flow-osprey%40osprey" && init?.method === "DELETE") {
        await removeWait;
        if (removeError) throw new Error("Removal failed. Try again.");
        resolved = { ...resolved!, items: resolved!.items.filter((item) => item.scope !== "bot") };
        return { ...flowSupersededPluginsFixture(false), canChange };
      }
      return API[path] ?? {};
    }),
  };
});

import { PluginsPanel } from "./PluginsPanel";
import { api } from "@/state/store";

describe("PluginsPanel modal", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    setLocale("en");
    owner = true;
    resolved = null;
    canChange = true;
    removeWait = null;
    removeError = false;
    vi.mocked(api).mockClear();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("opens Plugins as a centred modal dialog", async () => {
    await act(async () => {
      root.render(createElement(PluginsPanel));
    });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    const dialog = host.querySelector('[data-tour="apps-panel"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.getAttribute("role")).toBe("dialog");
    expect(dialog?.getAttribute("aria-modal")).toBe("true");
    expect(dialog?.className).toContain(CATEGORY_MODAL.frame.split(" ")[0]!);
    expect(host.querySelector("[data-tour=\"apps-close\"]")).not.toBeNull();
    expect(host.querySelector("[data-apps-back]")).toBeNull();
    expect(host.textContent).toMatch(/Plugins/);
  });

  it.each(["en", "fr"])("a member removes only the obsolete bot copy in one click (%s)", async (lang) => {
    await loadLocale(lang);
    owner = false;
    resolved = flowSupersededFixture();
    await act(async () => { root.render(createElement(PluginsPanel)); });
    const note = host.querySelector("[data-capability-superseded]");
    expect(note?.textContent).toBe(lang === "fr"
      ? "Remplacé par le pack Flow de l'organisation (osprey 0.1.41)"
      : "Superseded by the organization's Flow pack (osprey 0.1.41)");
    const remove = host.querySelector<HTMLButtonElement>("[data-remove-superseded]")!;
    expect(remove.textContent).toBe(lang === "fr" ? "Retirer" : "Remove");
    let finish!: () => void;
    removeWait = new Promise<void>((resolve) => { finish = resolve; });
    await act(async () => { remove.click(); });
    expect(remove.disabled).toBe(true);
    await act(async () => { remove.click(); });
    await act(async () => { finish(); });
    expect(vi.mocked(api).mock.calls.filter(([, init]) => init?.method === "DELETE")).toEqual([
      ["/api/bots/bot-a/plugins/pulsatrix-flow-osprey%40osprey", { method: "DELETE" }],
    ]);
    expect(host.querySelector("[data-capability-superseded]")).toBeNull();
    expect(host.querySelector('[data-capability="flow"]')).not.toBeNull();
    expect(host.querySelectorAll('[role="dialog"]')).toHaveLength(1);
  });

  it("keeps the old copy and reports a failed removal, and offers no removal to a reader", async () => {
    owner = false;
    resolved = flowSupersededFixture();
    removeError = true;
    await act(async () => { root.render(createElement(PluginsPanel)); });
    await act(async () => { host.querySelector<HTMLButtonElement>("[data-remove-superseded]")!.click(); });
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Removal failed");
    expect(host.querySelector<HTMLButtonElement>("[data-remove-superseded]")!.disabled).toBe(false);
    expect(host.querySelector("[data-capability-superseded]")).not.toBeNull();
    canChange = false;
    await act(async () => { root.unmount(); });
    root = createRoot(host);
    await act(async () => { root.render(createElement(PluginsPanel)); });
    expect(host.querySelector("[data-capability-superseded]")).not.toBeNull();
    expect(host.querySelector("[data-remove-superseded]")).toBeNull();
  });
});
