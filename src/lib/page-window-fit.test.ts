// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  PAGE_WINDOW_FIT_DEFAULT_WIDTH,
  PAGE_WINDOW_FIT_MIN,
  clampPageWindowSize,
  contentHeightFromSizeMessage,
  fitPageWindowBounds,
  pageWindowOuterSize,
  readPageWindowFitBridge,
  startPageWindowFit,
} from "./page-window-fit";

describe("page window fit helpers (#2051)", () => {
  const workArea = { x: 0, y: 25, width: 1440, height: 875 };

  it("builds an outer size from content height and a default width", () => {
    expect(pageWindowOuterSize({ contentHeight: 320 })).toEqual({
      width: PAGE_WINDOW_FIT_DEFAULT_WIDTH,
      height: 320,
    });
    expect(pageWindowOuterSize({ contentHeight: 200, width: 500, chromeHeight: 0 })).toEqual({
      width: 500,
      height: 200,
    });
  });

  it("clamps to the fit minimum and the work area", () => {
    expect(clampPageWindowSize({ width: 100, height: 50 }, workArea)).toEqual({
      width: PAGE_WINDOW_FIT_MIN.width,
      height: PAGE_WINDOW_FIT_MIN.height,
    });
    expect(clampPageWindowSize({ width: 2000, height: 2000 }, workArea)).toEqual({
      width: workArea.width,
      height: workArea.height,
    });
    expect(clampPageWindowSize({ width: 640, height: 400 }, workArea)).toEqual({
      width: 640,
      height: 400,
    });
  });

  it("keeps the top-left when fitting and pulls the window back into the work area", () => {
    expect(fitPageWindowBounds(
      { x: 100, y: 80, width: 960, height: 720 },
      { width: 640, height: 360 },
      workArea,
    )).toEqual({ x: 100, y: 80, width: 640, height: 360 });
    expect(fitPageWindowBounds(
      { x: 1200, y: 700, width: 960, height: 720 },
      { width: 800, height: 500 },
      workArea,
    )).toEqual({ x: 640, y: 400, width: 800, height: 500 });
  });

  it("reads a content height only from a valid page size message", () => {
    expect(contentHeightFromSizeMessage({ type: "sagax-page-size", v: 1, h: 420, vh: 800 })).toBe(420);
    expect(contentHeightFromSizeMessage({ type: "other", v: 1, h: 420, vh: 800 })).toBeNull();
  });

  it("exposes the desktop fit bridge only when fitContent is present", () => {
    expect(readPageWindowFitBridge({})).toBeNull();
    const fitContent = vi.fn();
    expect(readPageWindowFitBridge({ artifactWindowSelf: { fitContent } })?.fitContent).toBe(fitContent);
  });
});

describe("startPageWindowFit (#2051)", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.useRealTimers();
  });

  it("sizes the frame from the page message and asks the bridge to fit", () => {
    const root = document.createElement("main");
    const frame = document.createElement("iframe");
    const source = { postMessage: vi.fn() } as unknown as Window;
    Object.defineProperty(frame, "contentWindow", { configurable: true, value: source });
    root.append(frame);
    const fitContent = vi.fn(() => ({ width: 720, height: 420 }));
    const heights: number[] = [];
    const stop = startPageWindowFit({
      root,
      getFrame: () => frame,
      bridge: { fitContent },
      onContentHeight: (height) => heights.push(height),
    });
    window.dispatchEvent(Object.assign(new Event("message"), {
      data: { type: "sagax-page-size", v: 1, h: 420, vh: 800 },
      source,
    }));
    expect(heights).toEqual([420]);
    expect(frame.style.height).toBe("420px");
    expect(fitContent).toHaveBeenCalledWith({ width: PAGE_WINDOW_FIT_DEFAULT_WIDTH, height: 420 });
    stop();
  });
});
