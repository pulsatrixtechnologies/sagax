// @vitest-environment happy-dom
// Large computer window: calm chrome, Watching | Take control segments,
// power in the "..." menu, close and collapse back to the panel.
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
  const controls = props.controls ?? { play: vi.fn(), pause: vi.fn(), stop: vi.fn() };
  act(() => root.render(createElement(SandboxDesktopModal, {
    title: "Luna's screen",
    state: "running",
    controls,
    onClose,
    screen: () => createElement("div", { "data-fake-screen": "", "data-control": "1" }),
    ...props,
  })));
  return { onClose, controls };
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

  it("keeps power reachable in the more menu, not in the header", () => {
    const pause = vi.fn();
    const stop = vi.fn();
    mount({ controls: { pause, stop } });
    expect(document.querySelector("[data-takeover-power]")).toBeNull();
    act(() => (document.querySelector("[data-takeover-more]") as HTMLButtonElement).click());
    expect(document.querySelector("[data-takeover-power='pause']")).not.toBeNull();
    expect(document.querySelector("[data-takeover-power='stop']")).not.toBeNull();
    expect(document.querySelector("[data-takeover-fullscreen]")).not.toBeNull();
    act(() => (document.querySelector("[data-takeover-power='pause']") as HTMLButtonElement).click());
    expect(pause).toHaveBeenCalledTimes(1);
    expect(document.querySelector("[data-takeover-power]")).toBeNull();
  });

  it("closes and collapses back to the panel", () => {
    const { onClose } = mount();
    act(() => (document.querySelector("[data-takeover-close]") as HTMLButtonElement).click());
    expect(onClose).toHaveBeenCalledTimes(1);
    act(() => (document.querySelector("[data-takeover-collapse]") as HTMLButtonElement).click());
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("omits the control segments for the browser window", () => {
    mount({ kind: "browser", controls: undefined });
    expect(document.querySelector("[data-takeover-segments]")).toBeNull();
    expect(document.querySelector("[data-takeover-control]")).toBeNull();
    expect(document.querySelector("[data-takeover-more]")).not.toBeNull();
    expect(document.querySelector("[data-takeover-close]")).not.toBeNull();
  });
});
