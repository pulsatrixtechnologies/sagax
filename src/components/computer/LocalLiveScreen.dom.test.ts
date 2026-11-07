// @vitest-environment happy-dom
// #2342: the Computer card's live window showed "Capturing this computer's
// screen…" forever. It asked the desktop bridge for the Local VM's screenshot
// instead of this computer's screen, and swallowed every failure.
// "The screen is temporarily unavailable." now says the real
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
const PANE = "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture";
function screenAnswer(status: string, action: Record<string, unknown>) {
  return { platform: "darwin", permissions: [{ id: "screen", status, action }] };
}

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

  it("says Screen Recording is not allowed with the buttons that fix it (System Settings, Relaunch Sagax), instead of spinning", async () => {
    const permAct = vi.fn().mockResolvedValue(null);
    (window as { ogb?: unknown }).ogb = {
      screenFrame: vi.fn().mockResolvedValue(null),
      permStatus: vi.fn().mockResolvedValue({ mic: "granted", screen: "denied" }),
      permAll: vi.fn().mockResolvedValue(screenAnswer("denied", { kind: "settings", url: PANE, secondary: { kind: "relaunch" } })),
      permAct,
      permOpenSettings: vi.fn(),
    };
    await mount();
    expect(host.textContent).toContain("Capturing this computer's screen");
    await tick();
    expect(host.querySelector("[data-local-live-error]")?.getAttribute("data-local-live-error")).toBe("permission");
    expect(host.textContent).not.toContain("temporarily unavailable");
    const primary = host.querySelector<HTMLButtonElement>("[data-os-permission-action]")!;
    expect(primary.getAttribute("data-os-permission-action")).toBe("settings");
    expect(primary.textContent).toBe("Open System Settings");
    const secondary = host.querySelector<HTMLButtonElement>("[data-os-permission-secondary]")!;
    expect(secondary.textContent).toBe("Relaunch Sagax");
    await act(async () => { primary.click(); });
    expect(permAct).toHaveBeenLastCalledWith("screen", expect.objectContaining({ secondary: false }));
    await act(async () => { secondary.click(); });
    expect(permAct).toHaveBeenLastCalledWith("screen", expect.objectContaining({ secondary: true }));
  });

  // JC 2026-11-07 (capture 16:02): Sagax CHECKED in Screen & System Audio
  // Recording, the window still said "Sagax is not allowed ... Allow Screen
  // Recording". Allowed + refused capture: Relaunch Sagax, never that text.
  it("allowed in System Settings but the capture is refused: Relaunch Sagax, not 'not allowed'", async () => {
    const permAll = vi.fn().mockImplementation(async (context?: { captureFailed?: boolean }) =>
      screenAnswer("granted", context?.captureFailed ? { kind: "relaunch", secondary: { kind: "settings", url: PANE } } : { kind: "none" }));
    (window as { ogb?: unknown }).ogb = {
      screenFrame: vi.fn().mockRejectedValue(new Error("Error invoking remote method 'screen:frame': Error: Failed to get sources.")),
      permStatus: vi.fn().mockResolvedValue({ mic: "granted", screen: "granted" }),
      permAll,
      permAct: vi.fn().mockResolvedValue(null),
      permOpenSettings: vi.fn(),
    };
    await mount();
    await tick();
    expect(host.querySelector("[data-local-live-error]")?.getAttribute("data-local-live-error")).toBe("relaunch");
    expect(permAll).toHaveBeenLastCalledWith({ captureFailed: true });
    expect(host.textContent).not.toContain("not allowed");
    expect(host.textContent).not.toContain("Failed to get sources");
    expect(host.querySelector("[data-os-permission-action]")?.textContent).toBe("Relaunch Sagax");
  });

  it("allowed but still empty: Relaunch Sagax as a button", async () => {
    (window as { ogb?: unknown }).ogb = {
      screenFrame: vi.fn().mockResolvedValue(null),
      permStatus: vi.fn().mockResolvedValue({ mic: "granted", screen: "granted" }),
      permAll: vi.fn().mockImplementation(async (context?: { captureFailed?: boolean }) =>
        screenAnswer("granted", context?.captureFailed ? { kind: "relaunch", secondary: { kind: "settings", url: PANE } } : { kind: "none" })),
      permAct: vi.fn(),
      permOpenSettings: vi.fn(),
    };
    await mount();
    await tick();
    expect(host.querySelector("[data-local-live-error]")?.getAttribute("data-local-live-error")).toBe("empty");
    expect(host.querySelector("[data-os-permission-action]")?.textContent).toBe("Relaunch Sagax");
  });

  it("an older app without the permission actions still gets the System Settings button", async () => {
    const permOpenSettings = vi.fn();
    (window as { ogb?: unknown }).ogb = {
      screenFrame: vi.fn().mockResolvedValue(null),
      permStatus: vi.fn().mockResolvedValue({ mic: "granted", screen: "denied" }),
      permOpenSettings,
    };
    await mount();
    await tick();
    const button = host.querySelector<HTMLButtonElement>("[data-local-live-settings]")!;
    expect(button.textContent).toBe("Open System Settings");
    act(() => button.click());
    expect(permOpenSettings).toHaveBeenCalledWith("screen");
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

  it("on a Mac, a capture macOS refuses says how to allow Screen Recording, never the raw IPC error", async () => {
    (window as { ogb?: unknown }).ogb = {
      screenFrame: vi.fn().mockRejectedValue(new Error("Error invoking remote method 'screen:frame': Error: Failed to get sources.")),
      permStatus: vi.fn().mockResolvedValue({ mic: "granted", screen: "denied" }),
      permOpenSettings: vi.fn(),
    };
    await mount();
    await tick();
    expect(host.querySelector("[data-local-live-error]")?.getAttribute("data-local-live-error")).toBe("permission");
    expect(host.querySelector("[data-local-live-failure]")).toBeNull();
    expect(host.textContent).not.toContain("Failed to get sources");
    expect(host.textContent).toContain("Screen Recording");
    expect(host.querySelector("[data-local-live-settings]")).not.toBeNull();
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
