// @vitest-environment happy-dom
// Large computer window: calm chrome, Watching | Take control segments,
// one full screen button (no Play / Pause / Stop), one collapse that closes.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CIRCLE_CLOSE_BUTTON } from "@/lib/circle-button";
import { setLocale } from "@/lib/i18n";
import { SandboxDesktopModal } from "./SandboxDesktopModal";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  setLocale("en");
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function mount(props: Partial<Parameters<typeof SandboxDesktopModal>[0]> = {}) {
  const onClose = props.onClose ?? vi.fn();
  act(() => root.render(createElement(SandboxDesktopModal, {
    title: "Luna's screen",
    state: "running",
    onClose,
    screen: () => createElement("div", { "data-fake-screen": "", "data-control": "1" }),
    ...props,
  })));
  return { onClose };
}

describe("SandboxDesktopModal calm window", () => {
  it("toggles control with the segmented Watching | Take control control", () => {
    mount();
    const takeover = document.querySelector("[data-sandbox-takeover]")!;
    expect(takeover.querySelector("[data-takeover-segments]")).not.toBeNull();
    expect(takeover.textContent).toContain("Watching");
    expect(takeover.textContent).toContain("You have control");
    expect(document.querySelector("[data-takeover-control='release']")).not.toBeNull();
    expect(document.querySelector("[data-takeover-control='drive']")).not.toBeNull();

    act(() => (document.querySelector("[data-takeover-control='release']") as HTMLButtonElement).click());
    expect(document.querySelector("[data-takeover-control='watch']")).not.toBeNull();
    expect(document.querySelector("[data-takeover-control='take']")).not.toBeNull();
    expect(takeover.textContent).toContain("Take control");
    expect(takeover.textContent).not.toContain("You have control");

    act(() => (document.querySelector("[data-takeover-control='take']") as HTMLButtonElement).click());
    expect(document.querySelector("[data-takeover-control='release']")).not.toBeNull();
    expect(takeover.textContent).toContain("You have control");
  });

  it("shows no Play / Pause / Stop and no full screen button", () => {
    mount();
    expect(document.querySelector("[data-takeover-power]")).toBeNull();
    expect(document.querySelector("[data-takeover-more]")).toBeNull();
    expect(document.querySelector("[role=menu]")).toBeNull();
    // 2026-11-03 (the owner): the full screen button did not work in the app; removed.
    expect(document.querySelector("[data-takeover-fullscreen]")).toBeNull();
  });

  it("closes with the one round X button (no red close dot) and with Escape", () => {
    const { onClose } = mount();
    expect(document.querySelectorAll("[data-takeover-close]")).toHaveLength(1);
    const collapse = document.querySelector<HTMLButtonElement>("[data-takeover-collapse]")!;
    expect(collapse.hasAttribute("data-takeover-close")).toBe(true);
    expect(collapse.getAttribute("aria-label")).toMatch(/^Close and release control/);
    // the owner 2026-11-06: an X on the standard round button, not the shrink arrows.
    expect(collapse.className).toContain(CIRCLE_CLOSE_BUTTON);
    expect(collapse.querySelector("svg.lucide-x")).not.toBeNull();
    expect(collapse.querySelector("svg.lucide-minimize-2")).toBeNull();
    act(() => collapse.click());
    expect(onClose).toHaveBeenCalledTimes(1);
    act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("omits the control segments for the browser window", () => {
    mount({ kind: "browser" });
    expect(document.querySelector("[data-takeover-segments]")).toBeNull();
    expect(document.querySelector("[data-takeover-control]")).toBeNull();
    expect(document.querySelector("[data-takeover-fullscreen]")).toBeNull();
    expect(document.querySelector("[data-takeover-close]")).not.toBeNull();
  });
});

// #3386: the desktop view fills the whole app window (no dimmed backdrop, no
// modal frame) and, while the desktop is not ready, shows the app's activity
// dots above "Starting desktop" instead of a still black area.
describe("SandboxDesktopModal full window (#3386)", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("fills the app window with no dimmed backdrop and no modal frame", () => {
    mount();
    const takeover = document.querySelector<HTMLElement>("[data-sandbox-takeover]")!;
    // the window itself is the dialog, over the whole app window
    expect(takeover.getAttribute("role")).toBe("dialog");
    expect(takeover.getAttribute("data-takeover-layout")).toBe("full-window");
    expect(takeover.className).toContain("inset-0");
    for (const node of [takeover, ...takeover.querySelectorAll<HTMLElement>("*")]) {
      const classes = String(node.getAttribute("class") ?? "");
      expect(classes).not.toMatch(/bg-black\/60|backdrop-blur|h-\[88vh\]|w-\[92vw\]|rounded-2xl/);
    }
    // one control at the top right, the switch at the bottom center, last
    expect(takeover.querySelectorAll("[data-takeover-close]")).toHaveLength(1);
    const segments = takeover.querySelector("[data-takeover-segments]")!;
    expect(takeover.lastElementChild?.contains(segments)).toBe(true);
    expect(segments.parentElement?.className).toContain("justify-center");
  });

  it("shows the activity dots and Starting desktop while the desktop starts", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
    act(() => root.render(createElement(SandboxDesktopModal, { title: "Luna's screen", state: "running", onClose: vi.fn() })));
    const starting = document.querySelector("[data-sandbox-takeover] [data-desktop-starting]");
    expect(starting).not.toBeNull();
    expect(starting!.textContent).toBe("Starting desktop");
    expect(starting!.querySelectorAll(".animate-status-pulse")).toHaveLength(3);
    expect(document.querySelector("[data-sandbox-takeover] .animate-spin")).toBeNull();
    // the switch stays while the desktop starts
    expect(document.querySelector("[data-takeover-segments]")).not.toBeNull();
  });

  it("says Démarrage du bureau in French", () => {
    setLocale("fr");
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
    act(() => root.render(createElement(SandboxDesktopModal, { title: "Écran de Luna", state: "running", onClose: vi.fn() })));
    expect(document.querySelector("[data-desktop-starting]")?.textContent).toBe("Démarrage du bureau");
  });
});
