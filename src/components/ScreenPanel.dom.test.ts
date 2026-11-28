// @vitest-environment happy-dom
// The screen side panel (#4452): a docked column beside the chat with the
// bot's live browser (not the Computer tab's preview square), closed by its
// X or Escape, and resizable from its left edge. Compact chrome
// (M-20261127-064): no title header. One top row for every place
// (M-20261127-181): the browser's real chrome (LiveBrowserView) and the VM
// put the same buttons in the same order in the same row.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot } from "@/state/store";
import type { LiveBrowserDocked } from "./BrowserPanel.tsx-parts/LiveBrowserView";
import { isScreenPanelOpen, setScreenPanelOpen } from "@/lib/screen-panel";
import { openScreenPanelWindow } from "@/lib/screen-panel-window";
import { CIRCLE_BUTTON, CIRCLE_ICON, CIRCLE_LABEL_BUTTON } from "@/lib/circle-button";
import { renderToStaticMarkup } from "react-dom/server";
import { chooseFold, SCREEN_PANEL_TOP_ROW, ScreenBar, type ScreenBarFold } from "./ScreenPanelChrome";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const seen = vi.hoisted(() => ({ live: undefined as boolean | undefined, botId: "", docked: false }));
// The browser's own chrome, without its stream: a connected page the bot drives.
vi.mock("./BrowserPanel", async () => {
  const { LiveBrowserView } = await import("./BrowserPanel.tsx-parts/LiveBrowserView");
  const { liveBrowserViewProps } = await import("@/testing/live-browser-view-props");
  return {
    BrowserPanel: ({ bot, live, docked }: { bot: Bot; live?: boolean; docked?: LiveBrowserDocked }) => {
      seen.live = live; seen.botId = bot.id; seen.docked = Boolean(docked);
      return createElement(LiveBrowserView, liveBrowserViewProps(bot, {
        docked,
        frame: { seq: 1, data: "AAAA", viewerId: "v1", generation: 1 },
        tabs: [{ tabId: "t1", title: "Tickets", url: "https://example.com/", active: true }],
      }));
    },
  };
});
const opened = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/lib/screen-panel-window", () => ({
  openScreenPanelWindow: vi.fn(),
  closeScreenPanelWindow: vi.fn(),
  useScreenPanelWindow: () => opened.current,
}));
const found = vi.hoisted(() => ({ places: ["browser"] as string[], vm: null as string | null, remote: null as unknown }));
vi.mock("./ScreenPlaces", () => ({
  useScreenPlaces: () => found,
  placeControllable: (place: string, vm: string | null, remote: { controllable?: boolean } | null) => place === "vm" ? vm === "server" : remote?.controllable === true,
  VmPane: ({ source, control }: { source: string; control: boolean }) => createElement("div", { "data-pane": "vm", "data-source": source, "data-control": String(control) }),
  RemotePane: () => createElement("div", { "data-pane": "remote" }),
}));
vi.mock("@/state/store", () => ({ useStore: () => ({ dispatch: vi.fn(), state: {} }) }));
import { ScreenPanel } from "./ScreenPanel";

const bot = { id: "ada", name: "Ada" } as unknown as Bot;

/** The buttons every place shares, as the panel shows them, in order. */
const SHARED = "[data-screen-tab], [data-screen-control], [data-screen-panel-marks], [data-screen-panel-detach], [data-screen-panel-expand], [data-screen-panel-close]";
function sharedButtons(scope: ParentNode): string[] {
  return [...scope.querySelectorAll<HTMLElement>(SHARED)].map((button) => button.dataset.screenTab ? `place:${button.dataset.screenTab}`
    : button.hasAttribute("data-screen-control") ? "control"
    : button.hasAttribute("data-screen-panel-marks") ? "mark-up"
    : button.hasAttribute("data-screen-panel-detach") ? "detach"
    : button.hasAttribute("data-screen-panel-expand") ? "expand" : "close");
}
/** The panel's top row, its place of the shared buttons, and where they sit. */
function topRow() {
  const body = host.querySelector("[data-screen-panel-body]")!;
  const bars = body.querySelectorAll("[data-screen-panel-bar]");
  const bar = bars[0]!;
  const first = body.querySelector("[data-browser-compact]")?.firstElementChild ?? body.firstElementChild;
  return {
    bars: bars.length,
    first: first === bar,
    buttons: sharedButtons(bar),
    everywhere: sharedButtons(body),
    leftSide: sharedButtons(bar.querySelector("[data-screen-bar-leading]")!),
  };
}
let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  found.places = ["browser"]; found.vm = null; found.remote = null; opened.current = null;
  seen.live = undefined; seen.botId = ""; seen.docked = false;
  vi.mocked(openScreenPanelWindow).mockClear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  setScreenPanelOpen(true);
  act(() => root.render(createElement(ScreenPanel, { bot })));
});
afterEach(() => { act(() => root.unmount()); host.remove(); setScreenPanelOpen(false); });

describe("ScreenPanel", () => {
  it("is a labelled compact column that hosts the bot's live browser", () => {
    const aside = host.querySelector("aside[data-screen-panel]")!;
    expect(aside.getAttribute("aria-label")).toBe("Ada’s screen");
    expect(aside.hasAttribute("data-screen-compact")).toBe(true);
    expect(seen).toEqual({ live: true, botId: "ada", docked: true });
    expect(host.querySelector("[role=separator]")?.getAttribute("aria-label")).toBe("Resize the screen panel");
    expect(host.querySelector("[data-screen-panel-header]")).toBeNull();
    expect(host.querySelector("[data-screen-panel-detach]")).not.toBeNull();
    expect(host.querySelector("[data-screen-panel-expand]")).not.toBeNull();
    expect(host.querySelector("[data-screen-panel-close]")).not.toBeNull();
  });

  it("shows the marking tools only while Mark up is on", () => {
    const toggle = host.querySelector("[data-screen-panel-marks]") as HTMLButtonElement;
    expect(host.querySelector("[data-screen-marks-bar]")).toBeNull();
    act(() => { toggle.click(); });
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(host.querySelector("[data-screen-marks-bar]")).not.toBeNull();
    expect(host.querySelector("[data-screen-marks-overlay]")).not.toBeNull();
    act(() => { toggle.click(); });
    expect(host.querySelector("[data-screen-marks-overlay]")).toBeNull();
  });

  it("closes from its X button", () => {
    act(() => { (host.querySelector("[data-screen-panel-close]") as HTMLButtonElement).click(); });
    expect(isScreenPanelOpen()).toBe(false);
  });

  it("expands into the browser window without closing the panel", () => {
    act(() => { (host.querySelector("[data-screen-panel-expand]") as HTMLButtonElement).click(); });
    expect(isScreenPanelOpen()).toBe(true);
    expect(openScreenPanelWindow).toHaveBeenCalledWith({ botId: "ada", mode: "expand", kind: "browser" });
  });

  it("detaches into a window and closes the side panel", () => {
    act(() => { (host.querySelector("[data-screen-panel-detach]") as HTMLButtonElement).click(); });
    expect(isScreenPanelOpen()).toBe(false);
    expect(openScreenPanelWindow).toHaveBeenCalledWith({ botId: "ada", mode: "detach", kind: "browser" });
  });

  it("closes on Escape, but not from inside a field", () => {
    const aside = host.querySelector("aside")!;
    const input = document.createElement("input");
    aside.append(input);
    act(() => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(isScreenPanelOpen()).toBe(true);
    act(() => { aside.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(isScreenPanelOpen()).toBe(false);
  });

  it("shows no place tabs while the bot has one place, and place tabs when it has several", () => {
    expect(host.querySelector("[role=tablist]")).toBeNull();
    found.places = ["browser", "vm", "remote"]; found.vm = "server"; found.remote = { id: "r1", controllable: true };
    act(() => root.render(createElement(ScreenPanel, { bot })));
    const tabs = [...host.querySelectorAll<HTMLElement>("[role=tab]")];
    expect(tabs.map((tab) => tab.textContent)).toEqual(["Browser", "VM", "Remote computer"]);
    expect(seen.docked).toBe(true);
  });

  it("switches to the VM and the remote computer in the same panel, watching first", () => {
    found.places = ["browser", "vm", "remote"]; found.vm = "server"; found.remote = { id: "r1", controllable: true };
    act(() => root.render(createElement(ScreenPanel, { bot })));
    act(() => { (host.querySelector("[data-screen-tab=vm]") as HTMLElement).click(); });
    expect(host.querySelector("aside")!.getAttribute("data-screen-place")).toBe("vm");
    expect(host.textContent).toContain("Ada’s VM");
    expect(host.querySelector("[data-pane=vm]")!.getAttribute("data-control")).toBe("false");
    act(() => { (host.querySelector("[data-screen-control]") as HTMLElement).click(); });
    expect(host.querySelector("[data-pane=vm]")!.getAttribute("data-control")).toBe("true");
    act(() => { (host.querySelector("[data-screen-panel-marks]") as HTMLElement).click(); });
    expect(host.querySelector("[data-screen-marks-bar]")).not.toBeNull();
    act(() => { (host.querySelector("[data-screen-tab=remote]") as HTMLElement).click(); });
    expect(host.querySelector("[data-pane=remote]")).not.toBeNull();
    expect(host.textContent).toContain("Ada’s remote computer");
    expect(host.querySelector("[data-screen-marks-bar]")).toBeNull();
  });

  it("draws the chat header's round controls, the app's tabs and the frame's header height (M-20261127-179)", () => {
    const classes = (element: Element) => (element.getAttribute("class") ?? "").split(/\s+/);
    for (const selector of ["[data-screen-panel-marks]", "[data-screen-panel-detach]", "[data-screen-panel-expand]", "[data-screen-panel-close]"]) {
      const button = host.querySelector(selector)!;
      expect(classes(button), selector).toEqual(expect.arrayContaining(CIRCLE_BUTTON.split(/\s+/)));
      const svg = button.querySelector("svg")!;
      expect({ size: Number(svg.getAttribute("width")), strokeWidth: Number(svg.getAttribute("stroke-width")) }, selector).toEqual(CIRCLE_ICON);
    }
    found.places = ["browser", "vm"]; found.vm = "server";
    act(() => root.render(createElement(ScreenPanel, { bot })));
    const tabs = [...host.querySelectorAll("[data-screen-place-select] [role=tab]")];
    expect(tabs).toHaveLength(2);
    for (const tab of tabs) {
      expect(classes(tab)).toEqual(expect.arrayContaining(["rounded-full", "text-[13px]", "leading-[18px]"]));
      expect(tab.querySelector("svg")!.getAttribute("width")).toBe("16");
    }
    act(() => { (host.querySelector("[data-screen-tab=vm]") as HTMLElement).click(); });
    expect(classes(host.querySelector("[data-screen-panel-bar]")!)).toEqual(expect.arrayContaining([...SCREEN_PANEL_TOP_ROW.split(/\s+/), "group/screenbar"]));
  });

  it("folds a row's labels only while its controls do not fit, place tabs first (ScreenBar)", () => {
    expect(chooseFold(() => true)).toBe("none");
    expect(chooseFold((fold) => fold !== "none")).toBe("places");
    expect(chooseFold(() => false)).toBe("all");
    // a stand-in layout: the row is 456px wide; the field keeps 0, 100 or 220px by fold
    const field: Record<ScreenBarFold, number> = { none: 0, places: 100, all: 220 };
    const fold = (rowWidth: number, min: number) => {
      const proto = HTMLElement.prototype;
      const client = vi.spyOn(proto, "clientWidth", "get").mockImplementation(function (this: HTMLElement) { return this.hasAttribute("data-fold") ? rowWidth : 0; });
      const scroll = vi.spyOn(proto, "scrollWidth", "get").mockImplementation(function (this: HTMLElement) { return this.hasAttribute("data-fold") ? Math.min(rowWidth, 456) : 0; });
      const rect = vi.spyOn(proto, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
        const row = this.closest<HTMLElement>("[data-fold]");
        const width = rowWidth >= 900 ? 400 : field[(row?.dataset.fold ?? "none") as ScreenBarFold];
        return { width, height: 30, x: 0, y: 0, top: 0, left: 0, right: width, bottom: 30, toJSON: () => ({}) } as DOMRect;
      });
      const bar = document.createElement("div");
      document.body.append(bar);
      const barRoot = createRoot(bar);
      act(() => barRoot.render(createElement(ScreenBar, { min, "data-test-bar": "" } as never,
        createElement("input", { "data-screen-bar-flex": "" }))));
      const value = bar.querySelector("[data-test-bar]")!.getAttribute("data-fold");
      act(() => barRoot.unmount()); bar.remove();
      client.mockRestore(); scroll.mockRestore(); rect.mockRestore();
      return value;
    };
    expect(fold(900, 160)).toBe("none");
    expect(fold(456, 90)).toBe("places");
    expect(fold(456, 160)).toBe("all");
  });

  it("gives the VM's Take control the top bar's 36px labelled button", async () => {
    const { ControlSwitch } = await vi.importActual<typeof import("./ScreenPanelChrome")>("./ScreenPanelChrome");
    for (const on of [false, true]) {
      const html = renderToStaticMarkup(createElement(ControlSwitch, { on, onChange: () => {} }));
      const list = /class="([^"]+)"/.exec(html)![1]!.split(/\s+/);
      expect(list).toEqual(expect.arrayContaining(["h-9", "rounded-full", "text-[13px]", "leading-[18px]"]));
      expect(CIRCLE_LABEL_BUTTON.split(/\s+/).every((name) => list.includes(name) || /^(bg|text|border|hover:bg)-/.test(name))).toBe(true);
      expect(html).toMatch(/aria-label="[^"]+"/);
    }
  });

  it("falls back to the first place when the picked one goes away", () => {
    found.places = ["browser", "vm"]; found.vm = "server";
    act(() => root.render(createElement(ScreenPanel, { bot })));
    act(() => { (host.querySelector("[data-screen-tab=vm]") as HTMLElement).click(); });
    found.places = ["browser"]; found.vm = null;
    act(() => root.render(createElement(ScreenPanel, { bot })));
    expect(host.querySelector("aside")!.getAttribute("data-screen-place")).toBe("browser");
  });

  it("hosts an artifact with the same Detach, Expand and Close chrome", () => {
    const onDetach = vi.fn();
    const onExpand = vi.fn();
    act(() => root.render(createElement(ScreenPanel, {
      bot,
      artifact: {
        title: "Report",
        body: createElement("div", { "data-artifact-body": "" }, "body"),
        onDetach,
        onExpand,
      },
    })));
    expect(host.querySelector("aside")!.getAttribute("data-screen-place")).toBe("artifact");
    expect(host.querySelector("[data-artifact-body]")?.textContent).toBe("body");
    expect(host.querySelector("[data-screen-panel-marks]")).toBeNull();
    expect(host.querySelector("[data-screen-panel-detach]")).not.toBeNull();
    expect(host.querySelector("[data-screen-panel-expand]")).not.toBeNull();
    expect(host.querySelector("[data-screen-panel-close]")).not.toBeNull();
    expect(host.textContent).toContain("Report");
    act(() => { (host.querySelector("[data-screen-panel-detach]") as HTMLButtonElement).click(); });
    expect(onDetach).toHaveBeenCalledOnce();
    expect(openScreenPanelWindow).not.toHaveBeenCalled();
  });

  it("omits Detach and Expand on an artifact that does not supply them", () => {
    act(() => root.render(createElement(ScreenPanel, {
      bot,
      artifact: {
        title: "Draft",
        body: createElement("div", { "data-artifact-body": "" }, "body"),
      },
    })));
    expect(host.querySelector("[data-screen-panel-detach]")).toBeNull();
    expect(host.querySelector("[data-screen-panel-expand]")).toBeNull();
    expect(host.querySelector("[data-screen-panel-close]")).not.toBeNull();
    expect(host.querySelector("[data-screen-panel-marks]")).toBeNull();
  });
});

// M-20261127-180: the compact chrome (#5453) moved the pen, Detach, Expand and
// Close into the body, under the marks overlay: marking up could not be left.
describe("ScreenPanel marking up", () => {
  const pen = () => host.querySelector("[data-screen-panel-marks]") as HTMLButtonElement;
  const overlay = () => host.querySelector("[data-screen-marks-overlay]");
  const escape = (target: EventTarget) => act(() => { target.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });

  it("draws over the page only: the pen, Detach, Expand, Close and the address stay out from under it", () => {
    act(() => { pen().click(); });
    const stage = overlay()!.closest("[data-browser-stage]");
    expect(stage).not.toBeNull();
    for (const selector of ["[data-screen-panel-marks]", "[data-screen-panel-detach]", "[data-screen-panel-expand]", "[data-screen-panel-close]", "[aria-label='Browser address']"]) {
      expect(stage!.contains(host.querySelector(selector))).toBe(false);
    }
  });

  it("draws over the VM's picture only, not over its row", () => {
    found.places = ["browser", "vm"]; found.vm = "server";
    act(() => root.render(createElement(ScreenPanel, { bot })));
    act(() => { (host.querySelector("[data-screen-tab=vm]") as HTMLElement).click(); });
    act(() => { pen().click(); });
    const stage = overlay()!.closest("[data-screen-stage]");
    expect(stage?.querySelector("[data-pane=vm]")).not.toBeNull();
    expect(stage!.contains(pen())).toBe(false);
  });

  it("ends from the pen and from Done", () => {
    act(() => { pen().click(); });
    act(() => { pen().click(); });
    expect(overlay()).toBeNull();
    act(() => { pen().click(); });
    act(() => { (host.querySelector("[data-mark-done]") as HTMLButtonElement).click(); });
    expect(overlay()).toBeNull();
    expect(pen().getAttribute("aria-pressed")).toBe("false");
  });

  it("ends on Escape, from the panel, the note or nowhere, and leaves the panel open", () => {
    act(() => { pen().click(); });
    escape(host.querySelector("aside")!);
    expect(overlay()).toBeNull();
    expect(isScreenPanelOpen()).toBe(true);
    act(() => { pen().click(); });
    escape(host.querySelector("[data-mark-note]")!);
    expect(overlay()).toBeNull();
    act(() => { pen().click(); });
    escape(document.body);
    expect(overlay()).toBeNull();
    expect(isScreenPanelOpen()).toBe(true);
    // Marking off, Escape closes the panel as before.
    escape(host.querySelector("aside")!);
    expect(isScreenPanelOpen()).toBe(false);
  });

  it("leaves an open menu's Escape to the menu", () => {
    const menu = document.createElement("details");
    menu.open = true;
    const summary = document.createElement("summary");
    menu.append(summary);
    host.querySelector("aside")!.append(menu);
    escape(summary);
    expect(isScreenPanelOpen()).toBe(true);
  });
});

// M-20261127-180: Detach and Expand opened the browser's window whatever place was on screen.
describe("ScreenPanel windows", () => {
  it("opens the VM's window from the VM, and none for a Local VM or a remote computer it cannot drive", () => {
    found.places = ["browser", "vm"]; found.vm = "server";
    act(() => root.render(createElement(ScreenPanel, { bot })));
    act(() => { (host.querySelector("[data-screen-tab=vm]") as HTMLElement).click(); });
    act(() => { (host.querySelector("[data-screen-panel-expand]") as HTMLButtonElement).click(); });
    expect(openScreenPanelWindow).toHaveBeenLastCalledWith({ botId: "ada", mode: "expand", kind: "vm" });
    act(() => { (host.querySelector("[data-screen-panel-detach]") as HTMLButtonElement).click(); });
    expect(openScreenPanelWindow).toHaveBeenLastCalledWith({ botId: "ada", mode: "detach", kind: "vm" });
    found.vm = "local";
    setScreenPanelOpen(true);
    act(() => root.render(createElement(ScreenPanel, { bot })));
    expect(host.querySelector("[data-screen-panel-detach]")).toBeNull();
    expect(host.querySelector("[data-screen-panel-expand]")).toBeNull();
    expect(host.querySelector("[data-screen-panel-close]")).not.toBeNull();
  });

  it("opens the remote computer's own window for a session it can drive", () => {
    const remote = { id: "r2", controllable: true };
    found.places = ["browser", "remote"]; found.remote = remote;
    act(() => root.render(createElement(ScreenPanel, { bot })));
    act(() => { (host.querySelector("[data-screen-tab=remote]") as HTMLElement).click(); });
    act(() => { (host.querySelector("[data-screen-panel-expand]") as HTMLButtonElement).click(); });
    expect(openScreenPanelWindow).toHaveBeenLastCalledWith({ botId: "ada", mode: "expand", kind: "remote", remote });
  });

  it("draws no second live view while the place's own window is open", () => {
    opened.current = { botId: "ada", mode: "expand", kind: "browser" };
    act(() => root.render(createElement(ScreenPanel, { bot })));
    expect(host.querySelector("[data-browser-compact]")).toBeNull();
    expect(host.querySelector("[data-screen-in-window]")).not.toBeNull();
    expect(host.querySelector("[data-screen-panel-marks]")).toBeNull();
    expect(host.querySelector("[data-screen-panel-close]")).not.toBeNull();
    opened.current = { botId: "someone-else", mode: "expand", kind: "browser" };
    act(() => root.render(createElement(ScreenPanel, { bot })));
    expect(host.querySelector("[data-browser-compact]")).not.toBeNull();
  });
});

describe("the same buttons at the same place in every mode (M-20261127-181)", () => {
  const ORDER = ["control", "place:browser", "place:vm", "place:remote", "mark-up", "detach", "expand", "close"];

  it("puts Take control, place selector, Mark up, Detach, Expand and Close in one top row, in one order, for Browser, VM and remote", () => {
    found.places = ["browser", "vm", "remote"]; found.vm = "server"; found.remote = { id: "r1", controllable: true };
    act(() => root.render(createElement(ScreenPanel, { bot })));
    const rows: Record<string, ReturnType<typeof topRow>> = { browser: topRow() };
    act(() => { (host.querySelector("[data-screen-tab=vm]") as HTMLElement).click(); });
    expect(host.querySelector("aside")!.getAttribute("data-screen-place")).toBe("vm");
    rows.vm = topRow();
    act(() => { (host.querySelector("[data-screen-tab=remote]") as HTMLElement).click(); });
    rows.remote = topRow();
    for (const [place, row] of Object.entries(rows)) {
      expect(row.bars, place).toBe(1);
      expect(row.first, place).toBe(true);
      expect(row.buttons, place).toEqual(ORDER);
      // none outside the top row, none on its left side (page tabs, the VM's name)
      expect(row.everywhere, place).toEqual(ORDER);
      expect(row.leftSide, place).toEqual([]);
    }
  });

  it("keeps the place tabs and the tools still when a place has no Take control (a Local VM)", () => {
    found.places = ["browser", "vm"]; found.vm = "local";
    act(() => root.render(createElement(ScreenPanel, { bot })));
    expect(topRow().buttons).toEqual(["control", "place:browser", "place:vm", "mark-up", "detach", "expand", "close"]);
    act(() => { (host.querySelector("[data-screen-tab=vm]") as HTMLElement).click(); });
    const vm = topRow();
    // Local VM: no Take control, and no Detach / Expand (main #5491).
    expect(vm.buttons).toEqual(["place:browser", "place:vm", "mark-up", "close"]);
    const bar = host.querySelector("[data-screen-panel-bar]")!;
    expect(bar.querySelector("[data-screen-place-select]")).not.toBeNull();
    expect(bar.lastElementChild?.hasAttribute("data-screen-panel-chrome")).toBe(true);
  });

  it("keeps the browser's address row for its own tools only", () => {
    found.places = ["browser", "vm"]; found.vm = "server";
    act(() => root.render(createElement(ScreenPanel, { bot })));
    const address = host.querySelector("[data-browser-address-row]")!;
    expect(sharedButtons(address)).toEqual([]);
    expect(host.querySelector("[data-screen-bar-leading] [data-browser-tabs]")?.textContent).toContain("Tickets");
  });

  it("draws Take control the same in both modes and names it the same while the person drives", () => {
    found.places = ["browser", "vm"]; found.vm = "server";
    act(() => root.render(createElement(ScreenPanel, { bot })));
    const browserTake = host.querySelector<HTMLElement>("[data-screen-control]")!;
    const browserLook = { text: browserTake.textContent, className: browserTake.className, pressed: browserTake.getAttribute("aria-pressed") };
    act(() => { (host.querySelector("[data-screen-tab=vm]") as HTMLElement).click(); });
    const vmTake = host.querySelector<HTMLElement>("[data-screen-control]")!;
    expect({ text: vmTake.textContent, className: vmTake.className, pressed: vmTake.getAttribute("aria-pressed") }).toEqual(browserLook);
    act(() => { vmTake.click(); });
    expect(host.querySelector("[data-screen-control]")!.getAttribute("aria-pressed")).toBe("true");
    expect(host.querySelector("[data-screen-control]")!.textContent).toBe("You have control");
  });
});
