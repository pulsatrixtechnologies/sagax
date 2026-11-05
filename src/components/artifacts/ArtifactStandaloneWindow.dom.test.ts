// @vitest-environment happy-dom
// #1495: Full screen did nothing in an artifact's own window, because the
// full-screen layer was only drawn by the main app's ArtifactsHost.
// #2043: the control sat on the page content; OS fullscreen must use
// setFullScreen (Electron) or the Fullscreen API (browser), with the label
// following the real window state.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const artifact = {
  id: "a1", botId: "b1", title: "Sales dashboard", favorite: false, popped: true, createdAt: 1, updatedAt: 2, rev: 1,
  refresh: { state: "idle", failures: 0 },
  html: "<body><p>Orders: 128</p></body>",
};

vi.mock("@/lib/artifacts", () => ({
  useArtifact: () => ({ artifact, error: null }),
  useArtifactWatch: () => {},
  refreshArtifact: async () => {},
}));

import { ArtifactWindowBody } from "./ArtifactStandaloneWindow";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("artifact's own window: Full screen (#1495, #2043)", () => {
  let root: Root | null = null;
  let requestFullscreen: ReturnType<typeof vi.fn>;
  let exitFullscreen: ReturnType<typeof vi.fn>;
  let fullscreenElement: Element | null = null;

  beforeEach(() => {
    fullscreenElement = null;
    requestFullscreen = vi.fn(async function (this: Element) {
      fullscreenElement = document.documentElement;
      document.dispatchEvent(new Event("fullscreenchange"));
    });
    exitFullscreen = vi.fn(async () => {
      fullscreenElement = null;
      document.dispatchEvent(new Event("fullscreenchange"));
    });
    Object.defineProperty(document.documentElement, "requestFullscreen", { configurable: true, value: requestFullscreen });
    Object.defineProperty(document, "exitFullscreen", { configurable: true, value: exitFullscreen });
    Object.defineProperty(document, "fullscreenElement", { configurable: true, get: () => fullscreenElement });
    delete (window as { ogb?: unknown }).ogb;
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    document.body.innerHTML = "";
    delete (window as { ogb?: unknown }).ogb;
  });

  async function mount() {
    const host = document.createElement("div");
    document.body.append(host);
    await act(async () => {
      root = createRoot(host);
      root.render(createElement(ArtifactWindowBody, { data: { botId: "b1", artifactId: "a1" } }));
    });
  }

  it("keeps Full screen in the window chrome, off the page content (#2043)", async () => {
    await mount();
    const button = document.querySelector<HTMLButtonElement>("[data-artifact-fullscreen]");
    const chrome = document.querySelector("[data-artifact-window-chrome]");
    const frame = document.querySelector("[data-artifact-frame]");
    expect(button).not.toBeNull();
    expect(chrome).not.toBeNull();
    expect(chrome!.contains(button)).toBe(true);
    expect(frame?.contains(button) ?? false).toBe(false);
  });

  it("asks the OS for full screen during the click (user gesture) (#2043)", async () => {
    await mount();
    let duringClick = false;
    let requestedDuringClick = false;
    requestFullscreen.mockImplementation(async function (this: Element) {
      if (duringClick) requestedDuringClick = true;
      fullscreenElement = document.documentElement;
      document.dispatchEvent(new Event("fullscreenchange"));
    });
    await act(async () => {
      duringClick = true;
      document.querySelector<HTMLButtonElement>("[data-artifact-fullscreen]")!.click();
      duringClick = false;
    });
    expect(requestedDuringClick).toBe(true);
    expect(requestFullscreen).toHaveBeenCalledTimes(1);
  });

  it("toggles the label from the real fullscreen state", async () => {
    await mount();
    const button = () => document.querySelector<HTMLButtonElement>("[data-artifact-fullscreen]")!;
    expect(button().getAttribute("aria-pressed")).toBe("false");
    await act(async () => { button().click(); });
    expect(button().getAttribute("aria-pressed")).toBe("true");
    await act(async () => {
      fullscreenElement = null;
      document.dispatchEvent(new Event("fullscreenchange"));
    });
    expect(button().getAttribute("aria-pressed")).toBe("false");
  });

  it("Exit full screen leaves the system full screen too", async () => {
    await mount();
    await act(async () => { document.querySelector<HTMLButtonElement>("[data-artifact-fullscreen]")!.click(); });
    expect(fullscreenElement).toBe(document.documentElement);
    await act(async () => { document.querySelector<HTMLButtonElement>("[data-artifact-fullscreen]")!.click(); });
    expect(exitFullscreen).toHaveBeenCalled();
    expect(fullscreenElement).toBeNull();
  });

  it("uses Electron setFullScreen when the preload bridge is present (#2043)", async () => {
    const set = vi.fn(async () => true);
    const listeners = new Set<(fullscreen: boolean) => void>();
    window.ogb = {
      windowFullscreen: {
        set,
        state: async () => ({ fullscreen: false }),
        onChanged: (cb: (fullscreen: boolean) => void) => {
          listeners.add(cb);
          return () => { listeners.delete(cb); };
        },
      },
    } as unknown as Window["ogb"];
    await mount();
    await act(async () => { document.querySelector<HTMLButtonElement>("[data-artifact-fullscreen]")!.click(); });
    expect(set).toHaveBeenCalledWith(true);
    expect(requestFullscreen).not.toHaveBeenCalled();
    await act(async () => { for (const listener of listeners) listener(true); });
    expect(document.querySelector<HTMLButtonElement>("[data-artifact-fullscreen]")!.getAttribute("aria-pressed")).toBe("true");
  });
});
