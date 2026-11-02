// @vitest-environment happy-dom
// Large computer window: calm chrome, Watching | Take control segments,
// one full screen button (no Play / Pause / Stop), one collapse that closes.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

  it("shows no Play / Pause / Stop, only one full screen button with a tooltip", () => {
    mount();
    expect(document.querySelector("[data-takeover-power]")).toBeNull();
    expect(document.querySelector("[data-takeover-more]")).toBeNull();
    expect(document.querySelector("[role=menu]")).toBeNull();
    const full = document.querySelector<HTMLButtonElement>("[data-takeover-fullscreen]")!;
    expect(full.getAttribute("aria-label")).toBe("Full screen");
    expect(full.getAttribute("title")).toBe("Full screen");
    const request = vi.fn(() => Promise.resolve());
    (document.querySelector("[role=dialog]") as HTMLElement).requestFullscreen = request;
    act(() => full.click());
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("closes with the one collapse button (no red close dot) and with Escape", () => {
    const { onClose } = mount();
    expect(document.querySelectorAll("[data-takeover-close]")).toHaveLength(1);
    const collapse = document.querySelector<HTMLButtonElement>("[data-takeover-collapse]")!;
    expect(collapse.hasAttribute("data-takeover-close")).toBe(true);
    expect(collapse.getAttribute("aria-label")).toMatch(/^Close and release control/);
    act(() => collapse.click());
    expect(onClose).toHaveBeenCalledTimes(1);
    act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("omits the control segments for the browser window", () => {
    mount({ kind: "browser" });
    expect(document.querySelector("[data-takeover-segments]")).toBeNull();
    expect(document.querySelector("[data-takeover-control]")).toBeNull();
    expect(document.querySelector("[data-takeover-fullscreen]")).not.toBeNull();
    expect(document.querySelector("[data-takeover-close]")).not.toBeNull();
  });
});
