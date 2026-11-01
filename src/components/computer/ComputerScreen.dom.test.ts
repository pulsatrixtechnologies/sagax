// @vitest-environment happy-dom
// Calm Computer screen states (2026-11-01): asleep, waking, running, error;
// click / Enter / Space wake an asleep screen; Open pill on a running one.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";
import { ComputerScreen } from "./ComputerScreen";

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

const bot = {
  id: "luna",
  name: "Luna",
  color: "#6b8afd",
  mascotExpression: "neutral",
  mascotBody: "default",
  mascotSkin: "default",
  mascotLook: "default",
} as const;

function mount(props: Partial<Parameters<typeof ComputerScreen>[0]> & { state: Parameters<typeof ComputerScreen>[0]["state"] }) {
  act(() => root.render(createElement(ComputerScreen, {
    source: "server",
    caption: "Luna's screen",
    computerName: "Cloud",
    bot: bot as never,
    ...props,
  })));
}

describe("ComputerScreen calm states", () => {
  it("asleep: mascot sleep pose, z Z glyphs, one plain line, no transport bar", () => {
    const play = vi.fn();
    mount({ state: "off", controls: { play } });
    expect(host.querySelector('[data-screen-calm="asleep"]')).not.toBeNull();
    expect(host.querySelector('[data-computer-mascot="asleep"]')).not.toBeNull();
    expect(host.querySelector("[data-sleep-glyphs]")).not.toBeNull();
    expect(host.textContent).toContain("Cloud is asleep");
    expect(host.textContent).not.toMatch(/starts by itself|press Start|Off/i);
    expect(host.querySelector("[data-screen-controls]")).toBeNull();
    expect(host.querySelector("[data-power]")).toBeNull();
  });

  it("wakes on click and on Enter / Space when focused", () => {
    const play = vi.fn();
    mount({ state: "off", controls: { play } });
    const empty = host.querySelector<HTMLElement>('[data-screen-calm="asleep"]')!;
    act(() => empty.click());
    expect(play).toHaveBeenCalledTimes(1);
    act(() => {
      empty.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    });
    expect(play).toHaveBeenCalledTimes(2);
    act(() => {
      empty.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true }));
    });
    expect(play).toHaveBeenCalledTimes(3);
  });

  it("waking: awake mascot, Waking up…, no z glyphs, no transport bar", () => {
    mount({ state: "starting" });
    expect(host.querySelector('[data-screen-calm="waking"]')).not.toBeNull();
    expect(host.querySelector('[data-computer-mascot="waking"]')).not.toBeNull();
    expect(host.querySelector("[data-sleep-glyphs]")).toBeNull();
    expect(host.querySelector("[data-waking-shimmer]")).not.toBeNull();
    expect(host.textContent).toContain("Waking up");
    expect(host.querySelector("[data-screen-controls]")).toBeNull();
  });

  it("running: live edge to edge, Open pill, caption, no badge overlay", () => {
    const onOpen = vi.fn();
    mount({
      state: "running",
      onOpen,
      live: createElement("div", { "data-live": "" }, "frame"),
      controls: { pause: () => {}, stop: () => {} },
    });
    expect(host.querySelector("[data-live]")).not.toBeNull();
    expect(host.querySelector("[data-screen-empty]")).toBeNull();
    expect(host.querySelector("[data-power]")).toBeNull();
    expect(host.querySelector("[data-computer-open]")).not.toBeNull();
    expect(host.querySelector("[data-computer-open]")!.textContent).toContain("Open");
    expect(host.textContent).toContain("Luna's screen");
    const frame = host.querySelector<HTMLElement>("[data-controls]")!;
    act(() => {
      frame.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    });
    expect(onOpen).toHaveBeenCalledTimes(1);
    act(() => host.querySelector<HTMLButtonElement>("[data-computer-open]")!.click());
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it("error: state chip and retry action, no calm asleep", () => {
    mount({
      state: "error",
      message: "cannot be reached",
      actions: [{ label: "Try again", onClick: () => {} }],
    });
    expect(host.querySelector("[data-screen-calm]")).toBeNull();
    expect(host.querySelector('[data-power="error"]')).not.toBeNull();
    expect(host.textContent).toContain("cannot be reached");
    expect(host.textContent).toContain("Try again");
  });

  it("speaks French for asleep and waking", () => {
    setLocale("fr");
    mount({ state: "off", computerName: "Nuage", controls: { play: () => {} } });
    expect(host.textContent).toContain("Nuage dort");
    mount({ state: "starting", computerName: "Nuage" });
    expect(host.textContent).toMatch(/Réveil/);
  });
});
