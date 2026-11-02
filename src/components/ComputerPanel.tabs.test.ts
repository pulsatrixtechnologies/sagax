// @vitest-environment happy-dom
// The Computer tab shows the computer itself: Data moved to its own window
// (the chat header's Data button, src/lib/data-window.ts).
import { createElement } from "react";
import { ConfirmProvider } from "@/components/ConfirmProvider";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { AppState, Bot, InstanceInfo } from "@/state/store";

vi.mock("./DesktopCapabilities", async (importOriginal) => ({
  ...await importOriginal<typeof import("./DesktopCapabilities")>(),
  useCaptionChrome: () => ({ padClass: undefined }),
  useDesktopCapabilities: () => ({
    ready: true,
    capabilities: {
      host: { platform: "darwin", label: "Host", session: "unknown", packaged: true, homeDir: "/Users/me" },
      windowChrome: "native",
      screenPreview: { available: false, interaction: "none" },
      dictation: { available: false, engine: "none", onDevice: false },
      localComputer: { available: false, support: "unsupported", enabled: false, status: "unavailable" },
    },
  }),
}));
vi.mock("@/lib/interface-mode", () => ({ useAdvancedMode: () => true, setAdvancedMode: () => {} }));
vi.mock("@/lib/use-owner-or-admin", () => ({ useOwnerOrAdmin: () => true }));
vi.mock("./CloudScreenPreview", () => ({ CloudScreenPreview: () => null }));
vi.mock("./AndroidDevicePanel", () => ({ AndroidDevicePanel: () => null, useAndroidUsbDevices: () => ({ devices: [] }) }));
vi.mock("./BrowserPanel", () => ({ BrowserPanel: () => null }));
vi.mock("./CloudBackendPicker", () => ({ CloudBackendPicker: () => null }));
vi.mock("./bot-settings/RoutinesSection", () => ({ RoutinesSection: () => null }));
vi.mock("./data/DataPanel", () => ({ DataPanel: () => createElement("div", { "data-testid": "data-panel" }) }));
vi.mock("@/state/store", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/state/store")>(),
  api: async (path: string) => {
    if (path.startsWith("/api/bots/scout/computer/control")) return { held: false, helpReason: null };
    if (path.startsWith("/api/bots/scout/computer?")) return { surface: "cloud", backend: "box", configured: true, box: { boxId: "bx_23456789", state: "ready" } };
    return {};
  },
}));

const { ComputerPanel } = await import("./ComputerPanel");
const { BotEditorStore, initialState } = await import("@/state/store");

const engine = (instanceId: string) => ({
  instanceId, driverKind: "claudeAgent", displayName: instanceId, access: "subscription",
  snapshot: { state: "available", version: "1", authenticated: true },
  models: { default: "m", options: [{ id: "m", label: "M" }] },
  capabilities: { computerMcp: true, browserMcp: true },
}) as InstanceInfo;
const makeBot = (patch: Partial<Bot> = {}): Bot => ({
  id: "scout", threadId: "thread", name: "Scout", title: "", description: "", color: "green",
  notifications: true, unread: false, busy: false, computer: "cloud", messages: [],
  modelSelection: { instanceId: "claude", model: "m" },
  tasks: [{ threadId: "thread", title: "Thread", createdAt: 1, approvalMode: "ask" }],
  ...patch,
}) as unknown as Bot;

let root: Root | null = null;
const value = (): Parameters<typeof BotEditorStore>[0]["value"] => ({
  state: { ...initialState, instances: [engine("claude"), engine("codex")], config: { box: { configured: true } } as AppState["config"] } as AppState,
  dispatch: vi.fn(),
  flushBotPatches: async () => null,
  refreshInstances: async () => {},
  refreshModels: async () => {},
});
const settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};
const open = async (bot: Bot) => {
  if (!root) {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  }
  flushSync(() => root!.render(createElement(BotEditorStore, { value: value(), children: createElement(ConfirmProvider, null, createElement(ComputerPanel, { bot })) })));
  await settle();
};
beforeAll(() => {
  vi.stubGlobal("ogb", undefined);
});
afterEach(() => {
  root?.unmount();
  root = null;
  document.body.innerHTML = "";
});

describe("Computer panel tab", () => {
  it("shows the computer directly, with no Computer | Data picker and no Data view", async () => {
    await open(makeBot());
    expect(document.querySelector("[data-computer-view]")).toBeNull();
    expect(document.querySelector('[data-tour="computer-data"]')).toBeNull();
    expect([...document.querySelectorAll("button")].some((button) => button.textContent?.trim() === "Data")).toBe(false);
    expect(document.querySelector('[data-testid="data-panel"]')).toBeNull();
    expect(document.body.textContent).toContain("Scout");

    // Another conversation or model: still the computer, never Data.
    await open(makeBot({ modelSelection: { instanceId: "codex", model: "m" } }));
    await open(makeBot({ threadId: "thread-2", tasks: [{ threadId: "thread-2", title: "Second", createdAt: 2, approvalMode: "ask" }] } as Partial<Bot>));
    expect(document.querySelector("[data-computer-view]")).toBeNull();
    expect(document.querySelector('[data-testid="data-panel"]')).toBeNull();
  });
});
