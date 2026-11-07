// @vitest-environment happy-dom
// #2342: the Computer card's live window showed "Capturing this computer's
// screen…" forever. It asked the desktop bridge for the Local VM's screenshot
// instead of this computer's screen, and swallowed every failure.
// JC 2026-11-07: "The screen is temporarily unavailable." now says the real
// reason in every known case.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const bridge = vi.hoisted(() => ({ desktopLocalVm: vi.fn() }));
vi.mock("@/lib/desktop-local-vm", () => bridge);
vi.mock("@/lib/is-mac-platform", () => ({ isMacPlatform: () => true }));

import { setLocale } from "@/lib/i18n";
import { LOCAL_LIVE_INTERVAL_MS, LocalLiveScreen } from "./LocalLiveScreen";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
const FRAME = "data:image/png;base64,iVBORw0KGgo=";

beforeEach(() => {
  vi.useFakeTimers();
  setLocale("en");
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  bridge.desktopLocalVm.mockReset();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  delete (window as { ogb?: unknown }).ogb;
  vi.useRealTimers();
});

async function mount() {
  await act(async () => { root.render(createElement(LocalLiveScreen, { desktopId: "mac-1", control: false })); });
}
async function tick() {
  await act(async () => { await vi.advanceTimersByTimeAsync(LOCAL_LIVE_INTERVAL_MS); });
}

describe("LocalLiveScreen", () => {
  it("shows this computer's screen from the desktop app capture, not the Local VM", async () => {
    const screenFrame = vi.fn().mockResolvedValue(FRAME);
    (window as { ogb?: unknown }).ogb = { screenFrame, permOpenSettings: vi.fn() };
    bridge.desktopLocalVm.mockRejectedValue(new Error("no local VM"));
    await mount();
    expect(screenFrame).toHaveBeenCalled();
    expect(bridge.desktopLocalVm).not.toHaveBeenCalled();
    expect(host.querySelector<HTMLImageElement>("[data-local-live-frame]")?.getAttribute("src")).toBe(FRAME);
    expect(host.textContent).not.toContain("Capturing this computer's screen");
    await tick();
    expect(screenFrame).toHaveBeenCalledTimes(2);
  });

  it("says Screen Recording is not allowed, with the button to System Settings, instead of spinning", async () => {
    const permOpenSettings = vi.fn();
    (window as { ogb?: unknown }).ogb = {
      screenFrame: vi.fn().mockResolvedValue(null),
      permStatus: vi.fn().mockResolvedValue({ mic: "granted", screen: "denied" }),
      permOpenSettings,
    };
    await mount();
    expect(host.textContent).toContain("Capturing this computer's screen");
    await tick();
    const alert = host.querySelector("[data-local-live-error]");
    expect(alert?.getAttribute("data-local-live-error")).toBe("permission");
    expect(host.textContent).toContain("Allow Screen Recording for Sagax in System Settings");
    expect(host.textContent).not.toContain("temporarily unavailable");
    const button = host.querySelector<HTMLButtonElement>("[data-local-live-settings]")!;
    expect(button.textContent).toBe("Allow Screen Recording");
    act(() => button.click());
    expect(permOpenSettings).toHaveBeenCalledWith("screen");
  });

  it("allowed but still empty: says to relaunch, no Settings button", async () => {
    (window as { ogb?: unknown }).ogb = {
      screenFrame: vi.fn().mockResolvedValue(null),
      permStatus: vi.fn().mockResolvedValue({ mic: "granted", screen: "granted" }),
      permOpenSettings: vi.fn(),
    };
    await mount();
    await tick();
    expect(host.querySelector("[data-local-live-error]")?.getAttribute("data-local-live-error")).toBe("empty");
    expect(host.textContent).toContain("Relaunch Sagax");
    expect(host.querySelector("[data-local-live-settings]")).toBeNull();
  });

  it("shows the capture's own error when it fails", async () => {
    (window as { ogb?: unknown }).ogb = {
      screenFrame: vi.fn().mockRejectedValue(new Error("screen:frame refused for this page")),
      permStatus: vi.fn().mockResolvedValue({ mic: "granted", screen: "granted" }),
    };
    await mount();
    await tick();
    expect(host.querySelector("[data-local-live-error]")?.getAttribute("data-local-live-error")).toBe("capture-failed");
    expect(host.querySelector("[data-local-live-failure]")?.textContent).toBe("screen:frame refused for this page");
  });

  it("outside the desktop app, says so at once and never asks the Local VM", async () => {
    bridge.desktopLocalVm.mockResolvedValue({ image: FRAME });
    await mount();
    expect(bridge.desktopLocalVm).not.toHaveBeenCalled();
    expect(host.querySelector("[data-local-live-error]")?.getAttribute("data-local-live-error")).toBe("desktop-app-only");
    expect(host.textContent).toContain("Open the Sagax desktop app");
    expect(host.textContent).not.toContain("Capturing this computer's screen");
    expect(host.textContent).not.toContain("temporarily unavailable");
  });
});
