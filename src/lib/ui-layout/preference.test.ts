import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { USER_PREFERENCE_KEYS } from "../../../shared/user-preferences";
import { SETTINGS } from "../../../shared/settings-actions";
import {
  getComposerBarLayout,
  resetComposerBarLayout,
  resetComposerBarLayoutStoreForTests,
  setComposerBarLayout,
  COMPOSER_BAR_LAYOUT_KEY,
} from "../composer-bar-layout";
import { usagePillPlacement } from "../usage-pill-preferences";
import {
  COMPOSER_BAR_LAYOUT_LEGACY_KEY,
  defaultUiLayout,
  getUiLayout,
  migrateFromLegacy,
  parseUiLayout,
  resetUiLayoutStoreForTests,
  resetUiLayoutToDefaults,
  serializeUiLayout,
  setUiLayout,
  USAGE_PILL_PLACEMENT_LEGACY_KEY,
} from "./preference";
import { UI_LAYOUT_KEY } from "./types";

function installMemoryStorage(): void {
  const map = new Map<string, string>();
  const memory = {
    get length() { return map.size; },
    clear() { map.clear(); },
    getItem(key: string) { return map.has(key) ? map.get(key)! : null; },
    setItem(key: string, value: string) { map.set(key, String(value)); },
    removeItem(key: string) { map.delete(key); },
    key(index: number) { return [...map.keys()][index] ?? null; },
  } satisfies Storage;
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: memory });
}

describe("sagax.uiLayout.v1 (D-20261127-004)", () => {
  beforeEach(() => {
    installMemoryStorage();
    resetUiLayoutStoreForTests();
    resetComposerBarLayoutStoreForTests();
  });

  afterEach(() => {
    resetUiLayoutStoreForTests();
    resetComposerBarLayoutStoreForTests();
  });

  it("is a synced appearance key a bot can change", () => {
    expect(USER_PREFERENCE_KEYS).toContain(UI_LAYOUT_KEY);
    const spec = SETTINGS.find((setting) => setting.key === "appearance.uiLayout");
    expect(spec?.value).toBe("object");
  });

  it("parses, serializes, and defaults broken JSON", () => {
    expect(parseUiLayout(null)).toEqual(defaultUiLayout());
    expect(parseUiLayout("{")).toEqual(defaultUiLayout());
    const raw = serializeUiLayout({
      version: 1,
      zones: {
        ...defaultUiLayout().zones,
        composerBar: {
          order: ["voice", "plus"],
          hidden: ["usage"],
          left: 1,
          usagePlacement: "below",
        },
      },
    });
    const parsed = parseUiLayout(raw);
    expect(parsed.zones.composerBar.order).toEqual(["voice", "plus", "model"]);
    expect(parsed.zones.composerBar.hidden).toEqual(["usage"]);
    expect(parsed.zones.composerBar.usagePlacement).toBe("below");
  });

  it("migrates from composerBarLayout and usagePillPlacement legacy keys", () => {
    localStorage.setItem(
      COMPOSER_BAR_LAYOUT_LEGACY_KEY,
      JSON.stringify({ order: ["voice", "model", "plus", "usage"], left: 2 }),
    );
    localStorage.setItem(USAGE_PILL_PLACEMENT_LEGACY_KEY, "above");
    const migrated = migrateFromLegacy();
    expect(migrated.zones.composerBar.order).toEqual(["voice", "model", "plus", "usage"]);
    expect(migrated.zones.composerBar.left).toBe(2);
    expect(migrated.zones.composerBar.usagePlacement).toBe("above");
    // First read persists uiLayout
    expect(getUiLayout().zones.composerBar.usagePlacement).toBe("above");
    expect(localStorage.getItem(UI_LAYOUT_KEY)).toBeTruthy();
  });

  it("mirrors legacy keys when uiLayout is saved", () => {
    const next = defaultUiLayout();
    next.zones.composerBar.order = ["model", "plus", "voice", "usage"];
    next.zones.composerBar.left = 2;
    next.zones.composerBar.usagePlacement = "below";
    setUiLayout(next);
    expect(JSON.parse(localStorage.getItem(COMPOSER_BAR_LAYOUT_LEGACY_KEY) ?? "{}")).toEqual({
      order: ["model", "plus", "voice", "usage"],
      left: 2,
    });
    expect(localStorage.getItem(USAGE_PILL_PLACEMENT_LEGACY_KEY)).toBe("below");
  });

  it("resets the whole interface to defaults", () => {
    setUiLayout({
      ...defaultUiLayout(),
      zones: {
        ...defaultUiLayout().zones,
        composerBar: {
          order: ["voice"],
          hidden: ["plus", "model", "usage"],
          left: 0,
          usagePlacement: "above",
        },
      },
    });
    const reset = resetUiLayoutToDefaults();
    expect(reset).toEqual(defaultUiLayout());
    expect(getUiLayout()).toEqual(defaultUiLayout());
  });

  it("keeps composer-bar-layout and usagePillPlacement facades working", () => {
    expect(USER_PREFERENCE_KEYS).toContain(COMPOSER_BAR_LAYOUT_KEY);
    expect(USER_PREFERENCE_KEYS).toContain(usagePillPlacement.key);
    setComposerBarLayout({ order: ["model", "plus", "voice", "usage"], left: 2 });
    expect(getComposerBarLayout()).toEqual({ order: ["model", "plus", "voice", "usage"], left: 2 });
    usagePillPlacement.set("above");
    expect(usagePillPlacement.get()).toBe("above");
    expect(getUiLayout().zones.composerBar.usagePlacement).toBe("above");
    setComposerBarLayout(resetComposerBarLayout());
    expect(getComposerBarLayout().order).toEqual(["plus", "model", "usage", "voice"]);
  });
});
