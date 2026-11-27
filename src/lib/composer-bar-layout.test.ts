import { afterEach, describe, expect, it } from "vitest";
import { SETTINGS } from "../../shared/settings-actions";
import { USER_PREFERENCE_KEYS } from "../../shared/user-preferences";
import {
  COMPOSER_BAR_LAYOUT_KEY,
  COMPOSER_BAR_ITEMS,
  composerBarSlots,
  DEFAULT_COMPOSER_BAR_LAYOUT,
  getComposerBarLayout,
  moveComposerBarItem,
  nudgeComposerBarItem,
  parseComposerBarLayout,
  resetComposerBarLayout,
  resetComposerBarLayoutStoreForTests,
  serializeComposerBarLayout,
  setComposerBarLayout,
  setComposerBarSide,
} from "./composer-bar-layout";
import {
  parseUsagePillPlacement,
  USAGE_PILL_PLACEMENTS,
  usagePillInBar,
  usagePillPlacement,
} from "./usage-pill-preferences";

describe("usage pill placement (D-20261127-001)", () => {
  afterEach(() => {
    usagePillInBar.set("on");
    usagePillPlacement.set("inBar");
  });

  it("is a synced appearance key a bot can change, default inBar", () => {
    expect(USER_PREFERENCE_KEYS).toContain(usagePillPlacement.key);
    const spec = SETTINGS.find((setting) => setting.key === "appearance.usagePillPlacement");
    expect(spec?.value).toBe("enum:inBar|above|below");
    expect(usagePillPlacement.get()).toBe("inBar");
    expect(USAGE_PILL_PLACEMENTS).toEqual(["inBar", "above", "below"]);
    for (const place of USAGE_PILL_PLACEMENTS) {
      usagePillPlacement.set(place);
      expect(usagePillPlacement.get()).toBe(place);
    }
    expect(parseUsagePillPlacement("nope")).toBe("inBar");
    expect(parseUsagePillPlacement(null)).toBe("inBar");
  });

  it("keeps the existing show/hide switch intact beside placement", () => {
    usagePillInBar.set("off");
    usagePillPlacement.set("above");
    expect(usagePillInBar.get()).toBe("off");
    expect(usagePillPlacement.get()).toBe("above");
    usagePillInBar.set("on");
    expect(usagePillInBar.get()).toBe("on");
  });
});

describe("composer bar layout (D-20261126-014)", () => {
  afterEach(() => {
    resetComposerBarLayoutStoreForTests();
  });

  it("is a synced appearance key with the default order (+, model, usage, voice) and + on the left", () => {
    expect(USER_PREFERENCE_KEYS).toContain(COMPOSER_BAR_LAYOUT_KEY);
    const spec = SETTINGS.find((setting) => setting.key === "appearance.composerBarLayout");
    expect(spec?.value).toBe("object");
    expect(COMPOSER_BAR_ITEMS).toEqual(["plus", "model", "usage", "voice"]);
    expect(DEFAULT_COMPOSER_BAR_LAYOUT).toEqual({ order: ["plus", "model", "usage", "voice"], left: 1 });
    expect(getComposerBarLayout()).toEqual(DEFAULT_COMPOSER_BAR_LAYOUT);
  });

  it("parses, serializes, and fills missing items; broken JSON becomes the default", () => {
    expect(parseComposerBarLayout(null)).toEqual(DEFAULT_COMPOSER_BAR_LAYOUT);
    expect(parseComposerBarLayout("{")).toEqual(DEFAULT_COMPOSER_BAR_LAYOUT);
    expect(parseComposerBarLayout(JSON.stringify({ order: ["voice", "plus"], left: 2 }))).toEqual({
      order: ["voice", "plus", "model", "usage"],
      left: 2,
    });
    expect(serializeComposerBarLayout({ order: ["voice", "plus", "model", "usage"], left: 99 })).toBe(
      JSON.stringify({ order: ["voice", "plus", "model", "usage"], left: 4 }),
    );
  });

  it("keeps an order the person set and restores the default", () => {
    setComposerBarLayout({ order: ["model", "plus", "voice", "usage"], left: 2 });
    expect(getComposerBarLayout()).toEqual({ order: ["model", "plus", "voice", "usage"], left: 2 });
    setComposerBarLayout(resetComposerBarLayout());
    expect(getComposerBarLayout()).toEqual(DEFAULT_COMPOSER_BAR_LAYOUT);
  });

  it("moves a button with drag index and with arrow nudges", () => {
    const start = resetComposerBarLayout();
    expect(moveComposerBarItem(start, "usage", 1).order).toEqual(["plus", "usage", "model", "voice"]);
    expect(nudgeComposerBarItem(start, "plus", 1).order).toEqual(["model", "plus", "usage", "voice"]);
    expect(nudgeComposerBarItem(start, "plus", -1)).toEqual(start);
    expect(nudgeComposerBarItem(start, "voice", 1)).toEqual(start);
  });

  it("can put a button left or right of the fixed text field", () => {
    const start = resetComposerBarLayout();
    expect(setComposerBarSide(start, "model", "left")).toEqual({
      order: ["plus", "model", "usage", "voice"],
      left: 2,
    });
    expect(setComposerBarSide(start, "plus", "right")).toEqual({
      order: ["plus", "model", "usage", "voice"],
      left: 0,
    });
  });

  it("hides usage from the bar slots when placement is above or below", () => {
    const layout = resetComposerBarLayout();
    expect(composerBarSlots(layout, "inBar")).toEqual({
      left: ["plus"],
      right: ["model", "usage", "voice"],
    });
    expect(composerBarSlots(layout, "above")).toEqual({
      left: ["plus"],
      right: ["model", "voice"],
    });
    expect(composerBarSlots(layout, "below")).toEqual({
      left: ["plus"],
      right: ["model", "voice"],
    });
  });
});
