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
    expect(isHideable("conversationHeader", "close")).toBe(false);
    expect(isHideable("botPage", "close")).toBe(false);
    expect(isHideable("botPage", "panelGear")).toBe(false);
    expect(isHideable("botPage", "panelClose")).toBe(false);
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

  it("conversationHeader move, hide, restore, and keyboard nudge", () => {
    const start = defaultUiLayout();
    expect(start.zones.conversationHeader.order[0]).toBe("title");
    const moved = moveInZone(start, "conversationHeader", "botPanel", 0);
    expect(moved.zones.conversationHeader.order[0]).toBe("botPanel");
    const nudged = nudgeInZone(moved, "conversationHeader", "exportMenu", -1);
    expect(nudged.zones.conversationHeader.order.indexOf("exportMenu"))
      .toBeLessThan(nudged.zones.conversationHeader.order.indexOf("liveCall"));
    const hidden = hideInZone(nudged, "conversationHeader", "title");
    expect(hidden.zones.conversationHeader.hidden).toContain("title");
    expect(hidden.zones.conversationHeader.order).not.toContain("title");
    expect(restoreInZone(hidden, "conversationHeader", "title").zones.conversationHeader.hidden).not.toContain("title");
  });

  it("botPage move, hide, restore, and keyboard nudge", () => {
    const start = defaultUiLayout();
    expect(start.zones.botPage.order).toContain("tab:general");
    expect(start.zones.botPage.order).toContain("card:settings");
    expect(start.zones.botPage.order).toContain("panel:activity");
    const moved = moveInZone(start, "botPage", "card:channels", 0);
    expect(moved.zones.botPage.order[0]).toBe("card:channels");
    const nudged = nudgeInZone(moved, "botPage", "tab:outcomes", 1);
    expect(nudged.zones.botPage.order.indexOf("tab:outcomes"))
      .toBeGreaterThan(nudged.zones.botPage.order.indexOf("tab:general"));
    const hidden = hideInZone(nudged, "botPage", "panel:library");
    expect(hidden.zones.botPage.hidden).toContain("panel:library");
    expect(restoreInZone(hidden, "botPage", "panel:library").zones.botPage.order).toContain("panel:library");
  });
});
