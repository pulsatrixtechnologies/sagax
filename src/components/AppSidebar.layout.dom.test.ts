// @vitest-environment happy-dom
// The app shell's sidebar by window width (JC 2026-11-01, Grok Bot's window
// collapses its sidebar to icons at 700 px): the real AppSidebar and Sidebar
// mounted on a store, the window's width driven through matchMedia.
//   - 390 px: the drawer (menu button, scrim, Escape gives focus back), the
//     person's own density inside it;
//   - 700 px: the icons rail, automatically, with every way out of the wide
//     sidebar still reachable (names as accessible names and tooltips, the
//     footer's avatar menu and apps grid); the saved density is untouched,
//     the edge and ⌘B leave it alone;
//   - 1338 px: the person's density, restored as it was.
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Action, AppState, Bot } from "@/state/store";

vi.mock("./DesktopCapabilities", async (importOriginal) => ({
  ...await importOriginal<typeof import("./DesktopCapabilities")>(),
  useDesktopCapabilities: () => ({ capabilities: { dictation: { available: false }, host: { packaged: true, platform: "other" }, localComputer: { available: false } }, ready: true }),
  useCaptionChrome: () => ({}),
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** The window's width, as the media queries see it. */
const viewport = vi.hoisted(() => ({ width: 1338, lists: new Set<{ query: string; listeners: Set<() => void> }>() }));
function matchMedia(query: string) {
  const min = /min-width:\s*(\d+)px/.exec(query);
  const entry = { query, listeners: new Set<() => void>() };
  viewport.lists.add(entry);
  return {
    get matches() { return min ? viewport.width >= Number(min[1]) : false; },
    media: query,
    addEventListener: (_: string, listener: () => void) => entry.listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => entry.listeners.delete(listener),
    addListener: (listener: () => void) => entry.listeners.add(listener),
    removeListener: (listener: () => void) => entry.listeners.delete(listener),
    onchange: null,
    dispatchEvent: () => true,
  };
}

const { AppSidebar } = await import("./AppSidebar");
const { BotEditorStore, initialState } = await import("@/state/store");
const prefs = await import("@/lib/sidebar-preferences");
const { setLocale } = await import("@/lib/i18n");
setLocale("en");

const bot = (id: string, name: string, title = ""): Bot => ({
  id, threadId: `t-${id}`, name, title, description: "", color: "green", notifications: true, unread: false,
  modelSelection: { instanceId: "test", model: "m" },
  messages: [{ id: `m-${id}`, role: "bot", kind: "text", text: "Synthetic reply.", at: 1 }],
  tasks: [{ threadId: `t-${id}`, title: "General", createdAt: 1 }],
} as Bot);

let state: AppState;
let dispatched: Action[];
let root: Root;
let container: HTMLDivElement;

function Shell() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  return createElement("div", { "data-app-shell-row": "", "data-drawer-state": drawerOpen ? "open" : "closed" },
    createElement(AppSidebar, { drawerOpen, onDrawerOpenChange: setDrawerOpen, composeOpen: false, onCompose: () => {} }));
}

async function draw() {
  const dispatch = (action: Action) => { dispatched.push(action); };
  const value = { state, dispatch, flushBotPatches: async () => null, refreshInstances: async () => {}, refreshModels: async () => {} };
  await act(async () => { root.render(createElement(BotEditorStore, { value: value as never, children: createElement(Shell) })); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}
async function resize(width: number) {
  viewport.width = width;
  await act(async () => { for (const list of viewport.lists) for (const listener of list.listeners) listener(); });
}

const aside = () => container.querySelector<HTMLElement>("aside[data-sidebar]")!;
const classes = (node: Element | null) => (node?.getAttribute("class") ?? "").split(/\s+/);
const drawerButton = () => container.querySelector<HTMLButtonElement>("[data-drawer-button]")!;
const separator = () => container.querySelector('[role="separator"]');
const row = (id: string) => container.querySelector<HTMLElement>(`[data-sidebar-bot-row="${id}"]`)!;
const savedDensity = () => localStorage.getItem(prefs.SIDEBAR_DENSITY_KEY);

beforeAll(() => {
  vi.stubGlobal("matchMedia", matchMedia);
});
afterAll(() => {
  vi.unstubAllGlobals();
});
beforeEach(async () => {
  localStorage.clear();
  viewport.width = 1338;
  dispatched = [];
  vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
  state = {
    ...initialState,
    connected: true,
    hydrated: true,
    selectedId: "atlas",
    config: { profile: { name: "Sample Person" } } as AppState["config"],
    bots: [bot("atlas", "Atlas", "Service desk"), bot("iris", "Iris"), bot("lina", "Lina")],
  } as AppState;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  prefs.setSidebarDensity("comfortable");
  localStorage.clear();
});

describe("the sidebar at 1338 px (wide)", () => {
  it("follows the person's full sidebar, with its edge and the wide foot", async () => {
    prefs.setSidebarDensity("comfortable");
    await draw();
    expect(aside().getAttribute("data-sidebar-layout")).toBe("own");
    expect(aside().getAttribute("data-sidebar-density")).toBe("comfortable");
    expect(aside().style.width).not.toBe(`${prefs.SIDEBAR_RAIL_WIDTH}px`);
    expect(separator()).not.toBeNull();
    expect(classes(row("atlas").querySelector("[data-sidebar-row-name]"))).not.toContain("hidden");
    // the foot: avatar and name, then the round apps grid
    expect(container.querySelector("[data-sidebar-account-row] [data-account-pill-name]")?.textContent).toBe("Sample Person");
    expect(container.querySelector("[data-sidebar-account-row] [data-sidebar-connect-apps] [data-apps-grid-icon]")).not.toBeNull();
    // the drawer's controls are phone-only (CSS), and closed
    expect(classes(drawerButton())).toContain("sm:hidden");
    expect(container.querySelector("[data-drawer-scrim]")).toBeNull();
  });

  it("keeps a rail the person chose, with its own way back to the full sidebar", async () => {
    prefs.setSidebarDensity("icons");
    await draw();
    expect(aside().getAttribute("data-sidebar-layout")).toBe("own");
    expect(aside().getAttribute("data-sidebar-density")).toBe("icons");
    expect(container.querySelector("[data-sidebar-compact-toggle]")).not.toBeNull();
    expect(separator()).not.toBeNull();
  });
});

describe("the sidebar at 700 px (the automatic rail)", () => {
  it("draws the icons rail in the flow without touching the saved density", async () => {
    prefs.setSidebarDensity("comfortable");
    await draw();
    await resize(700);
    expect(aside().getAttribute("data-sidebar-layout")).toBe("auto-rail");
    expect(aside().getAttribute("data-sidebar-density")).toBe("icons");
    expect(aside().style.width).toBe(`${prefs.SIDEBAR_RAIL_WIDTH}px`);
    // the drawer classes only apply below sm: the rail stays in the flow
    expect(classes(aside()).filter((name) => /absolute|translate/.test(name)).every((name) => name.startsWith("max-sm:"))).toBe(true);
    expect(savedDensity()).toBe("comfortable");
    // the window decides here: no edge to drag, no "full sidebar" toggle
    expect(separator()).toBeNull();
    expect(container.querySelector("[data-sidebar-compact-toggle]")).toBeNull();
  });

  it("keeps every bot reachable: name as accessible name and tooltip, in the tab order", async () => {
    await draw();
    await resize(700);
    const atlas = row("atlas");
    expect(atlas.getAttribute("aria-label")).toBe("Atlas");
    expect(atlas.getAttribute("tabindex")).toBe("0");
    expect(atlas.parentElement?.getAttribute("title")).toBe("Atlas · Service desk");
    expect(classes(atlas.querySelector("[data-sidebar-row-name]"))).toContain("hidden");
    // the mascot stays one assembled avatar in the rail
    expect(atlas.querySelectorAll("[data-sidebar-row-avatar]")).toHaveLength(1);
    // search and New keep their names
    expect(container.querySelector("[data-sidebar-search]")?.getAttribute("aria-label")).toBeTruthy();
    expect(container.querySelector("[data-sidebar-new]")?.getAttribute("aria-label")).toBe("New");
  });

  it("keeps the foot's avatar menu and apps grid, named and focusable", async () => {
    await draw();
    await resize(700);
    const account = container.querySelector<HTMLButtonElement>('[data-sidebar-account-rail] button[aria-haspopup="menu"]');
    expect(account).not.toBeNull();
    expect(account!.getAttribute("aria-label")).toBe("Sample Person");
    expect(account!.querySelector("[title]")?.getAttribute("title")).toBe("Sample Person");
    const apps = container.querySelector<HTMLButtonElement>("[data-sidebar-rail-foot] [data-sidebar-connect-apps]");
    expect(apps).not.toBeNull();
    expect(apps!.getAttribute("aria-label")).toBe("Capabilities");
    expect(apps!.querySelector("[data-apps-grid-icon]")).not.toBeNull();
    expect(classes(apps)).toEqual(expect.arrayContaining(["rounded-full", "size-9"]));
    // the apps grid comes before the avatar, like the wide row's pair
    expect(apps!.compareDocumentPosition(account!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    apps!.focus();
    expect(document.activeElement).toBe(apps);
    await act(async () => { apps!.click(); });
    expect(dispatched).toContainEqual({ type: "togglePlugins", open: true });
    await act(async () => { account!.click(); });
    expect(container.querySelector('[role="menu"]')).not.toBeNull();
  });

  it("leaves the saved density alone on ⌘B, and widening restores it", async () => {
    prefs.setSidebarDensity("compact");
    await draw();
    await resize(700);
    expect(aside().getAttribute("data-sidebar-density")).toBe("icons");
    await act(async () => { prefs.toggleSidebarCollapsed(); });
    expect(savedDensity()).toBe("compact");
    await resize(1338);
    expect(aside().getAttribute("data-sidebar-layout")).toBe("own");
    expect(aside().getAttribute("data-sidebar-density")).toBe("compact");
    expect(separator()).not.toBeNull();
    // and ⌘B works again once wide
    await act(async () => { prefs.toggleSidebarCollapsed(); });
    expect(savedDensity()).toBe("icons");
  });
});

describe("the sidebar at 390 px (a phone)", () => {
  it("is a drawer: menu button, scrim, Escape closes it and gives focus back", async () => {
    prefs.setSidebarDensity("comfortable");
    viewport.width = 390;
    await draw();
    expect(aside().getAttribute("data-sidebar-layout")).toBe("drawer");
    // the person's own density inside the drawer, not the rail
    expect(aside().getAttribute("data-sidebar-density")).toBe("comfortable");
    expect(classes(aside())).toEqual(expect.arrayContaining(["max-sm:absolute", "max-sm:-translate-x-full"]));
    expect(drawerButton().getAttribute("aria-expanded")).toBe("false");
    drawerButton().focus();
    await act(async () => { drawerButton().click(); });
    expect(drawerButton().getAttribute("aria-expanded")).toBe("true");
    expect(classes(aside())).toContain("max-sm:translate-x-0");
    expect(container.querySelector("[data-drawer-scrim]")).not.toBeNull();
    await act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
    expect(drawerButton().getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(drawerButton());
  });

  it("closes an open drawer when the window widens to the rail", async () => {
    viewport.width = 390;
    await draw();
    await act(async () => { drawerButton().click(); });
    expect(container.querySelector("[data-drawer-state]")?.getAttribute("data-drawer-state")).toBe("open");
    await resize(700);
    expect(container.querySelector("[data-drawer-state]")?.getAttribute("data-drawer-state")).toBe("closed");
    expect(aside().getAttribute("data-sidebar-layout")).toBe("auto-rail");
    expect(container.querySelector("[data-drawer-scrim]")).toBeNull();
  });
});
