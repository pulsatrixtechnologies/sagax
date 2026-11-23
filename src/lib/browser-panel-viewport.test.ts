import { describe, expect, it } from "vitest";
import { BROWSER_STANDARD_VIEWPORT, panelBrowserViewport, viewportResizeNeeded } from "./browser-panel-viewport";

describe("panel browser viewport (#5021)", () => {
  it("keeps a tall narrow stage as a tall narrow page", () => {
    expect(panelBrowserViewport({ width: 380, height: 720 })).toEqual({ width: 380, height: 720 });
  });

  it("leaves a desktop-sized stage at the standard page", () => {
    expect(panelBrowserViewport({ width: 1280, height: 720 })).toEqual(BROWSER_STANDARD_VIEWPORT);
  });

  it("lifts a short side up to a readable page and keeps the stage's aspect", () => {
    expect(panelBrowserViewport({ width: 200, height: 640 })).toEqual({ width: 320, height: 1024 });
  });

  it("caps a long side so the capture stays a page, not a poster", () => {
    expect(panelBrowserViewport({ width: 900, height: 1600 })).toEqual({ width: 810, height: 1440 });
  });

  it("ignores a stage that has not been laid out", () => {
    expect(panelBrowserViewport({ width: 80, height: 40 })).toBeNull();
    expect(panelBrowserViewport({ width: Number.NaN, height: 400 })).toBeNull();
  });

  it("skips a resize that is only a few pixels", () => {
    expect(viewportResizeNeeded(null, { width: 400, height: 700 })).toBe(true);
    expect(viewportResizeNeeded({ width: 400, height: 700 }, { width: 410, height: 708 })).toBe(false);
    expect(viewportResizeNeeded({ width: 400, height: 700 }, { width: 460, height: 700 })).toBe(true);
  });
});
