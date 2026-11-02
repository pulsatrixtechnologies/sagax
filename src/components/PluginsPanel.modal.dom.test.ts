// @vitest-environment happy-dom
// Capabilities opens as a centred modal (decided exception like Settings).
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";
import { CATEGORY_MODAL } from "./category-modal";

let owner = true;
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
    loadBotPlugins: async () => ({ marketplaces: [], plugins: [], policy: { mode: "any" }, engine: { loadsPlugins: true }, canChange: true }),
  };
});
vi.mock("@/lib/bot-tailscale", () => ({ fetchBotTailscale: async () => null }));
vi.mock("@/lib/capabilities", async () => {
  const actual = await vi.importActual<typeof import("@/lib/capabilities")>("@/lib/capabilities");
  return { ...actual, useBotCapabilities: () => ({ data: null, error: null, reload: () => {} }) };
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
        config: { viewer: { principalId: "p-1", role: "owner" } },
        bots: [],
        instances: [],
      },
      dispatch: vi.fn(),
    }),
    api: vi.fn(async (path: string) => API[path] ?? {}),
  };
});

import { PluginsPanel } from "./PluginsPanel";

describe("PluginsPanel modal", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    setLocale("en");
    owner = true;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("opens Capabilities as a centred modal dialog", async () => {
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
    expect(host.textContent).toMatch(/Capabilities|Connect/);
  });
});
