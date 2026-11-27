import { afterEach, describe, expect, it } from "vitest";

import {
  hideInZone,
  moveInZone,
  nudgeInZone,
  restoreInZone,
  setComposerSide,
  setUsagePlacement,
} from "./draft";
import { defaultUiLayout, resetUiLayoutStoreForTests } from "./preference";

describe("ui-layout draft helpers (D-20261127-004)", () => {
  afterEach(() => {
    resetUiLayoutStoreForTests();
  });

  it("moves a component within its zone only", () => {
    const start = defaultUiLayout();
    const moved = moveInZone(start, "composerBar", "usage", 1);
    expect(moved.zones.composerBar.order).toEqual(["plus", "usage", "model", "voice"]);
    expect(moved.zones.sidebar.order).toEqual(start.zones.sidebar.order);
  });

  it("nudges with arrow deltas and no-ops at the edges", () => {
    const start = defaultUiLayout();
    expect(nudgeInZone(start, "composerBar", "plus", 1).zones.composerBar.order)
      .toEqual(["model", "plus", "usage", "voice"]);
    expect(nudgeInZone(start, "composerBar", "plus", -1)).toEqual(start);
    expect(nudgeInZone(start, "composerBar", "voice", 1)).toEqual(start);
  });

  it("hides a hideable component and restores it", () => {
    const start = defaultUiLayout();
    const hidden = hideInZone(start, "composerBar", "usage");
    expect(hidden.zones.composerBar.order).toEqual(["plus", "model", "voice"]);
    expect(hidden.zones.composerBar.hidden).toEqual(["usage"]);
    const restored = restoreInZone(hidden, "composerBar", "usage");
    expect(restored.zones.composerBar.order).toEqual(["plus", "model", "voice", "usage"]);
    expect(restored.zones.composerBar.hidden).toEqual([]);
  });

  it("refuses to hide a non-hideable id", () => {
    const start = defaultUiLayout();
    // text/send are fixed outside the registry; accountMenu is not a zone component
    expect(hideInZone(start, "sidebar", "accountMenu")).toEqual(start);
    expect(hideInZone(start, "composerBar", "send")).toEqual(start);
  });

  it("hides and restores a personal section id in the sidebar zone", () => {
    const start = defaultUiLayout();
    start.zones.sidebar.order = [...start.zones.sidebar.order, "section:Work"];
    const hidden = hideInZone(start, "sidebar", "section:Work");
    expect(hidden.zones.sidebar.hidden).toContain("section:Work");
    expect(hidden.zones.sidebar.order).not.toContain("section:Work");
    const restored = restoreInZone(hidden, "sidebar", "section:Work", 0);
    expect(restored.zones.sidebar.order[0]).toBe("section:Work");
  });

  it("sets composer side and usage placement on the draft", () => {
    const start = defaultUiLayout();
    const right = setComposerSide(start, "plus", "right");
    // plus was alone on the left; after moving right, left count is 0 so it sits with the right group
    expect(right.zones.composerBar.left).toBe(0);
    expect(right.zones.composerBar.order.indexOf("plus")).toBeGreaterThanOrEqual(0);
    const above = setUsagePlacement(start, "above");
    expect(above.zones.composerBar.usagePlacement).toBe("above");
  });
});
