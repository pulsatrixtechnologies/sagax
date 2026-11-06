// @vitest-environment happy-dom
// #2342: the Computer card's live window showed "Capturing this computer's
// screen…" forever. It asked the desktop bridge for the Local VM's screenshot
// instead of this computer's screen, and swallowed every failure.
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

  it("says Screen Recording is missing, with the Settings path, instead of spinning", async () => {
    const permOpenSettings = vi.fn();
    (window as { ogb?: unknown }).ogb = { screenFrame: vi.fn().mockResolvedValue(null), permOpenSettings };
    await mount();
    expect(host.textContent).toContain("Capturing this computer's screen");
    await tick();
    const alert = host.querySelector("[data-local-live-error]");
    expect(alert?.getAttribute("data-local-live-error")).toBe("screen-permission");
    expect(host.textContent).toContain("Screen Recording permission");
    act(() => host.querySelector<HTMLButtonElement>("[data-local-live-settings]")!.click());
    expect(permOpenSettings).toHaveBeenCalledWith("screen");
  });

  it("outside the app, reads the bridge and ends on a clear error when it fails", async () => {
    bridge.desktopLocalVm.mockRejectedValue(new Error("not connected"));
    await mount();
    expect(bridge.desktopLocalVm).toHaveBeenCalledWith("screenshot", { desktopId: "mac-1" });
    await tick();
    expect(host.querySelector("[data-local-live-error]")?.getAttribute("data-local-live-error")).toBe("unavailable");
    expect(host.textContent).not.toContain("Capturing this computer's screen");
  });
});
