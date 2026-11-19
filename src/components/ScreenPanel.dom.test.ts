// @vitest-environment happy-dom
// The screen side panel (#4452): a docked column beside the chat with the
// bot's live browser (not the Computer tab's preview square), closed by its
// X or Escape, and resizable from its left edge.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot } from "@/state/store";
import { isScreenPanelOpen, setScreenPanelOpen } from "@/lib/screen-panel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const seen = vi.hoisted(() => ({ live: undefined as boolean | undefined, botId: "" }));
vi.mock("./BrowserPanel", () => ({
  BrowserPanel: ({ bot, live }: { bot: { id: string }; live?: boolean }) => {
    seen.live = live; seen.botId = bot.id;
    return null;
  },
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
  seen.live = undefined; seen.botId = "";
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  setScreenPanelOpen(true);
  act(() => root.render(createElement(ScreenPanel, { bot })));
});
afterEach(() => { act(() => root.unmount()); host.remove(); setScreenPanelOpen(false); });

describe("ScreenPanel", () => {
  it("is a labelled column that hosts the bot's live browser", () => {
    const aside = host.querySelector("aside[data-screen-panel]")!;
    expect(aside.getAttribute("aria-label")).toBe("Ada’s screen");
    expect(host.textContent).toContain("Ada’s browser");
    expect(seen).toEqual({ live: true, botId: "ada" });
    expect(host.querySelector("[role=separator]")?.getAttribute("aria-label")).toBe("Resize the screen panel");
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

  it("closes on Escape, but not from inside a field", () => {
    const aside = host.querySelector("aside")!;
    const input = document.createElement("input");
    aside.append(input);
    act(() => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(isScreenPanelOpen()).toBe(true);
    act(() => { aside.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(isScreenPanelOpen()).toBe(false);
  });

  it("shows no tabs while the bot has one place, and tabs for each place when it has several", () => {
    expect(host.querySelector("[role=tablist]")).toBeNull();
    found.places = ["browser", "vm", "remote"]; found.vm = "server"; found.remote = { id: "r1" };
    act(() => root.render(createElement(ScreenPanel, { bot })));
    const tabs = [...host.querySelectorAll<HTMLElement>("[role=tab]")];
    expect(tabs.map((tab) => tab.textContent)).toEqual(["Browser", "VM", "Remote computer"]);
    expect(host.querySelector("[data-screen-pane]")).toBeNull();
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
    // the marks tools are the same ones as the browser's
    act(() => { (host.querySelector("[data-screen-panel-marks]") as HTMLElement).click(); });
    expect(host.querySelector("[data-screen-marks-bar]")).not.toBeNull();
    act(() => { (host.querySelector("[data-screen-tab=remote]") as HTMLElement).click(); });
    expect(host.querySelector("[data-pane=remote]")).not.toBeNull();
    expect(host.textContent).toContain("Ada’s remote computer");
    // a new place starts watching again with the marks tools closed
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
});
