// @vitest-environment happy-dom
// The screen side panel (#4452): a docked column beside the chat with the
// bot's live browser (not the Computer tab's preview square), closed by its
// X or Escape, and resizable from its left edge. Compact chrome
// (M-20261127-064): no title header; Detach / Expand / Close sit on the
// browser tab row.
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot } from "@/state/store";
import { isScreenPanelOpen, setScreenPanelOpen } from "@/lib/screen-panel";
import { openScreenPanelWindow } from "@/lib/screen-panel-window";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const seen = vi.hoisted(() => ({ live: undefined as boolean | undefined, botId: "", docked: false }));
vi.mock("./BrowserPanel", () => ({
  BrowserPanel: ({ bot, live, docked }: { bot: { id: string }; live?: boolean; docked?: { chrome?: ReactNode; placeSelector?: ReactNode } }) => {
    seen.live = live; seen.botId = bot.id; seen.docked = Boolean(docked);
    return createElement("div", { "data-mock-browser": "", "data-docked": seen.docked ? "1" : "0" },
      docked?.placeSelector ?? null,
      docked?.chrome ?? null,
    );
  },
}));
vi.mock("@/lib/screen-panel-window", () => ({
  openScreenPanelWindow: vi.fn(),
  closeScreenPanelWindow: vi.fn(),
  useScreenPanelWindow: () => null,
}));
const found = vi.hoisted(() => ({ places: ["browser"] as string[], vm: null as string | null, remote: null as unknown }));
vi.mock("./ScreenPlaces", () => ({
  useScreenPlaces: () => found,
  placeControllable: (place: string, vm: string | null) => place === "vm" && vm === "server",
  ControlSwitch: ({ control, onChange }: { control: boolean; onChange: (next: boolean) => void }) => createElement("button", { "data-screen-control": control ? "driving" : "watching", onClick: () => onChange(!control) }),
  VmPane: ({ source, control }: { source: string; control: boolean }) => createElement("div", { "data-pane": "vm", "data-source": source, "data-control": String(control) }),
  RemotePane: () => createElement("div", { "data-pane": "remote" }),
}));
vi.mock("@/state/store", () => ({ useStore: () => ({ dispatch: vi.fn(), state: {} }) }));
import { ScreenPanel } from "./ScreenPanel";

const bot = { id: "ada", name: "Ada" } as unknown as Bot;
let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  found.places = ["browser"]; found.vm = null; found.remote = null;
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
    found.places = ["browser", "vm", "remote"]; found.vm = "server"; found.remote = { id: "r1" };
    act(() => root.render(createElement(ScreenPanel, { bot })));
    const tabs = [...host.querySelectorAll<HTMLElement>("[role=tab]")];
    expect(tabs.map((tab) => tab.textContent)).toEqual(["Browser", "VM", "Remote computer"]);
    expect(seen.docked).toBe(true);
  });

  it("switches to the VM and the remote computer in the same panel, watching first", () => {
    found.places = ["browser", "vm", "remote"]; found.vm = "server"; found.remote = { id: "r1" };
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
