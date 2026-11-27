import { afterEach, describe, expect, it } from "vitest";

import {
  hideInZone,
  moveInZone,
  nudgeInZone,
  restoreInZone,
  cloneLayout,
} from "./draft";
import {
  defaultUiLayout,
  getUiLayout,
  resetUiLayoutStoreForTests,
  setUiLayout,
} from "./preference";
import { isHideable, isFixedComponent } from "./registry";

describe("ui customize mode behaviors (D-20261127-004)", () => {
  afterEach(() => {
    resetUiLayoutStoreForTests();
  });

  it("save persists draft; cancel discards it", () => {
    const start = defaultUiLayout();
    const draft = hideInZone(moveInZone(start, "composerBar", "voice", 0), "sidebar", "search");
    // Save
    setUiLayout(draft);
    expect(getUiLayout().zones.composerBar.order[0]).toBe("voice");
    expect(getUiLayout().zones.sidebar.hidden).toContain("search");
    // Cancel path: leave draft aside and reload store
    const discarded = hideInZone(cloneLayout(getUiLayout()), "composerBar", "plus");
    expect(discarded.zones.composerBar.hidden).toContain("plus");
    expect(getUiLayout().zones.composerBar.hidden).not.toContain("plus");
  });

  it("reset-to-default restores every zone", () => {
    setUiLayout(hideInZone(defaultUiLayout(), "composerBar", "model"));
    setUiLayout(defaultUiLayout());
    expect(getUiLayout()).toEqual(defaultUiLayout());
  });

  it("fixed components are not hideable", () => {
    expect(isHideable("composerBar", "plus")).toBe(true);
    expect(isHideable("composerBar", "send")).toBe(false);
    expect(isHideable("sidebar", "accountMenu")).toBe(false);
    expect(isFixedComponent("composerBar", "plus")).toBe(false);
  });

  it("keyboard nudge moves within the zone", () => {
    const start = defaultUiLayout();
    const nudged = nudgeInZone(start, "sidebar", "search", 1);
    const searchAt = nudged.zones.sidebar.order.indexOf("search");
    const collapseAt = nudged.zones.sidebar.order.indexOf("collapse");
    expect(searchAt).toBeGreaterThan(collapseAt);
  });

  it("restore undoes hide", () => {
    const hidden = hideInZone(defaultUiLayout(), "composerBar", "usage");
    expect(restoreInZone(hidden, "composerBar", "usage").zones.composerBar.hidden).toEqual([]);
  });
});
