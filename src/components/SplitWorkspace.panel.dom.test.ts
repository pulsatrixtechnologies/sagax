// @vitest-environment happy-dom
// The split view's pill (#1601 follow-up): every section, a bot's or a
// group's, wears the main chat's pill centered at its top; its click opens
// that bot's or group's panel, always at the window's right edge, and one
// panel shows at a time.
import { createContext, createElement, useContext, useReducer, useState, type ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { insertSection, MAIN_LEAF, MAIN_LEAF_ID, resetSplitLayout, setSplitLayout, type SplitNode } from "@/lib/split-view";
import type { AppState, Bot, Group } from "@/state/store";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The real reducer behind a test store: the pill's actions run as in the app.
const TestStore = createContext<{ state: AppState; dispatch: (action: unknown) => void } | null>(null);
vi.mock("@/state/store", async (original) => {
  const actual = await original<typeof import("@/state/store")>();
  return { ...actual, useStore: () => useContext(TestStore)!, api: () => Promise.resolve({}) };
});
vi.mock("./DesktopCapabilities", () => ({
  useDesktopCapabilities: () => ({ capabilities: { dictation: { available: false } } }),
  useCaptionChrome: () => ({}),
  useMacInsetChrome: () => ({}),
}));
// Bot sections wait on their thread: the header (with its pill) is what is
// tested. A group's thread loads, so its view (and its panel) render.
vi.mock("@/lib/use-side-transcript", () => ({
  useSideTranscript: (threadId: string) => ({
    loaded: threadId.startsWith("room"),
    failed: false,
    messages: [],
    activeLeafId: null,
    hasMore: false,
    loadingOlder: false,
    loadOlder: () => {},
  }),
}));

const { reducer, initialState } = await import("@/state/store");
const { SplitWorkspace, useBotPanelBot } = await import("./SplitWorkspace");

const bot = (id: string, name: string): Bot => ({ id, name, color: "blue", threadId: `${id}-t`, messages: [], hasMore: false } as unknown as Bot);
const bots = [bot("main-bot", "Main"), bot("scout", "Scout"), bot("pepper", "Pepper")];
const groups = [{
  id: "crew", threadId: "room-crew", name: "Crew", memberIds: ["scout", "pepper"], humanIds: [], defaultResponder: "scout",
  bulletin: "", unread: false, createdAt: 1, messages: [], hasMore: false,
} as unknown as Group];

/** Where App.tsx draws the bot panel, as data attributes. */
function PanelProbe() {
  const { state } = useContext(TestStore)!;
  const panelBot = useBotPanelBot(bots[0]);
  const open = (state.settingsOpen || state.computerOpen) && panelBot;
  return createElement("div", { "data-probe": "", "data-open": open ? "yes" : "no", "data-bot": open ? panelBot!.id : "", "data-owner": state.panelOwner ? JSON.stringify(state.panelOwner) : "" });
}

/** App's shell row: the content frame, then the panel slot at the right edge. */
function Harness({ children }: { children?: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, { ...initialState, bots, groups, selectedId: "main-bot", connected: true } as AppState);
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  return createElement(TestStore.Provider, { value: { state, dispatch: dispatch as (action: unknown) => void } },
    createElement("div", { "data-test-row": "" },
      createElement("div", { "data-test-frame": "" }, createElement(SplitWorkspace, { panelSlot: slot, main: createElement("main", { "data-test-main": "" }, "Main chat") })),
      createElement("div", { ref: setSlot, "data-split-panel-slot": "" }),
    ),
    createElement(PanelProbe),
    children,
  );
}

let root: Root | null = null;
let host: HTMLElement;
const mount = (layout: SplitNode) => {
  setSplitLayout(layout);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(createElement(Harness)));
};
const pill = (pane: string) => host.querySelector<HTMLButtonElement>(`[data-split-pane="${pane}"] [data-split-pane-pill] [data-bot-header-pill]`);
const probe = () => host.querySelector<HTMLElement>("[data-probe]")!.dataset;
const slot = () => host.querySelector<HTMLElement>("[data-split-panel-slot]")!;
const click = (element: Element | null) => act(() => { (element as HTMLElement).click(); });
/** Scout on the left, the main chat, the Crew group on the right. */
const threeSections = () => {
  const left = insertSection(MAIN_LEAF, { kind: "bot", botId: "scout" }, "left");
  return insertSection(left.layout, { kind: "group", groupId: "crew" }, "right").layout;
};

beforeEach(() => {
  try { localStorage.clear(); } catch { /* none */ }
  resetSplitLayout();
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  resetSplitLayout();
});

describe("a section's pill", () => {
  it("is the main chat's pill, centered at the top of every section, bot and group, beside Open in main and Close", () => {
    mount(threeSections());
    for (const [pane, name] of [["bot:scout", "Scout"], ["group:crew", "Crew"]] as const) {
      const header = host.querySelector(`[data-split-pane="${pane}"] [data-split-pane-header]`)!;
      const centered = header.querySelector<HTMLElement>("[data-split-pane-pill]")!;
      const center = centered.closest<HTMLElement>("[data-chat-header-center]")!;
      expect(center.className).toContain("left-1/2");
      expect(center.className).toContain("-translate-x-1/2");
      expect(header.hasAttribute("data-chat-header-bar")).toBe(true);
      expect(header.querySelector('[data-chat-edge-fade="top"]')).not.toBeNull();
      const button = centered.querySelector("[data-bot-header-pill]")!;
      expect(button.textContent).toContain(name);
      expect(button.querySelector("[data-bot-header-chevron]")).not.toBeNull();
      expect(button.getAttribute("aria-expanded")).toBe("false");
      expect(header.querySelector("[data-split-open-main]")).not.toBeNull();
      expect(header.querySelector("[data-split-close]")).not.toBeNull();
    }
    expect(probe().open).toBe("no");
  });

  it("opens a bot section's panel at the right edge, even for a section on the left", () => {
    mount(threeSections());
    click(pill("bot:scout"));
    // App.tsx draws the one bot panel after the content frame, at the right.
    expect(probe()).toMatchObject({ open: "yes", bot: "scout" });
    expect(pill("bot:scout")!.getAttribute("aria-expanded")).toBe("true");
    expect(slot().children).toHaveLength(0);
  });

  it("opens a group section's panel in the right-edge slot, with its name", () => {
    mount(threeSections());
    click(pill("group:crew"));
    expect(JSON.parse(probe().owner!)).toEqual({ leafId: expect.any(String), groupId: "crew" });
    expect(probe().open).toBe("no");
    const panel = slot().querySelector<HTMLElement>("[data-testid='group-panel']");
    expect(panel).not.toBeNull();
    expect(panel!.querySelector("#group-panel-title")?.textContent).toContain("Crew");
    // Not inside the section: only in the slot.
    expect(host.querySelector("[data-split-pane='group:crew'] [data-testid='group-panel']")).toBeNull();
    expect(pill("group:crew")!.getAttribute("aria-expanded")).toBe("true");
  });

  it("shows one panel at a time: opening another section's closes the first", () => {
    mount(threeSections());
    click(pill("bot:scout"));
    click(pill("group:crew"));
    expect(probe().open).toBe("no");
    expect(slot().querySelector("[data-testid='group-panel']")).not.toBeNull();
    expect(pill("bot:scout")!.getAttribute("aria-expanded")).toBe("false");
    click(pill("bot:scout"));
    expect(probe()).toMatchObject({ open: "yes", bot: "scout" });
    expect(slot().querySelector("[data-testid='group-panel']")).toBeNull();
    expect(pill("group:crew")!.getAttribute("aria-expanded")).toBe("false");
    // A second click closes it.
    click(pill("bot:scout"));
    expect(probe().open).toBe("no");
    expect(probe().owner).toBe("");
  });

  it("closes its panel with its section, a bot's and a group's", () => {
    mount(threeSections());
    click(pill("bot:scout"));
    click(host.querySelector(`[data-split-pane="bot:scout"] [data-split-close]`));
    expect(probe().open).toBe("no");
    expect(probe().owner).toBe("");
    click(pill("group:crew"));
    expect(slot().querySelector("[data-testid='group-panel']")).not.toBeNull();
    click(host.querySelector(`[data-split-pane="group:crew"] [data-split-close]`));
    expect(slot().querySelector("[data-testid='group-panel']")).toBeNull();
    expect(probe().owner).toBe("");
    expect(host.querySelector("[data-split-leaf]")).toBeNull();
  });

  it("leaves the main chat's panel alone when no section opened it", () => {
    mount(MAIN_LEAF);
    expect(host.querySelector("[data-test-main]")).not.toBeNull();
    expect(host.querySelector(`[data-split-leaf="${MAIN_LEAF_ID}"]`)).toBeNull();
    expect(probe().open).toBe("no");
  });
});
