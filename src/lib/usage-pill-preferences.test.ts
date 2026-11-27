import { afterEach, describe, expect, it } from "vitest";
import { SETTINGS } from "../../shared/settings-actions";
import { USER_PREFERENCE_KEYS } from "../../shared/user-preferences";
import {
  contextIndicator,
  parseUsagePillPlacement,
  parseUsagePillShape,
  setUsagePillShapeFor,
  USAGE_PILL_PLACES,
  USAGE_PILL_PLACEMENTS,
  USAGE_PILL_SHAPES,
  usagePillInBar,
  usagePillPlacement,
  usagePillShape,
  usagePillShapeAccountMenu,
  usagePillShapeChoice,
  usagePillShapeFor,
  usagePillShapeMenuBar,
} from "./usage-pill-preferences";

// The owner, 2026-11-26 (M-20261126-106, M-20261126-108, #5406) and
// 2026-11-27 (D-20261127-001): the usage pill in the message bar, where it
// sits, its shape per place and the context indicator are the person's own
// choices in Settings > Appearance.
describe("the usage pill's preferences", () => {
  afterEach(() => {
    usagePillInBar.set("on");
    usagePillPlacement.set("inBar");
    usagePillShape.set("circles");
    usagePillShapeAccountMenu.set("circles");
    usagePillShapeMenuBar.set("bars");
    contextIndicator.set("on");
    for (const key of [usagePillShapeAccountMenu.key, usagePillShapeMenuBar.key]) {
      try { localStorage.removeItem(key); } catch { /* ignore */ }
    }
  });

  it("are the person's synced appearance keys, and settings a bot can change", () => {
    for (const [choice, key, value] of [
      [usagePillInBar, "appearance.usagePillInBar", "enum:on|off"],
      [usagePillPlacement, "appearance.usagePillPlacement", "enum:inBar|above|below"],
      [usagePillShape, "appearance.usagePillShape", "enum:bars|circles|battery|dots|text"],
      [usagePillShapeAccountMenu, "appearance.usagePillShapeAccountMenu", "enum:bars|circles|battery|dots|text"],
      [usagePillShapeMenuBar, "appearance.usagePillShapeMenuBar", "enum:bars|circles|battery|dots|text"],
      [contextIndicator, "appearance.contextIndicator", "enum:on|off"],
    ] as const) {
      expect(USER_PREFERENCE_KEYS).toContain(choice.key);
      const spec = SETTINGS.find((setting) => setting.key === key);
      expect(spec?.value).toBe(value);
      expect(spec?.where).toContain("Conversation");
    }
  });

  it("default to the pill shown in the bar, three circles and the context shown, and keep each choice", () => {
    expect(usagePillInBar.get()).toBe("on");
    expect(usagePillPlacement.get()).toBe("inBar");
    expect(usagePillShape.get()).toBe("circles");
    expect(usagePillShapeAccountMenu.get()).toBe("circles");
    expect(usagePillShapeMenuBar.get()).toBe("bars");
    expect(contextIndicator.get()).toBe("on");
    expect(USAGE_PILL_SHAPES).toEqual(["bars", "circles", "battery", "dots", "text"]);
    expect(USAGE_PILL_PLACES).toEqual(["messageBar", "accountMenu", "menuBar"]);
    expect(USAGE_PILL_PLACEMENTS).toEqual(["inBar", "above", "below"]);
    for (const shape of USAGE_PILL_SHAPES) {
      usagePillShape.set(shape);
      expect(usagePillShape.get()).toBe(shape);
    }
    for (const place of USAGE_PILL_PLACEMENTS) {
      usagePillPlacement.set(place);
      expect(usagePillPlacement.get()).toBe(place);
    }
    usagePillInBar.set("off");
    contextIndicator.set("off");
    expect([usagePillInBar.get(), contextIndicator.get()]).toEqual(["off", "off"]);
    expect(parseUsagePillShape("nope")).toBe("circles");
    expect(parseUsagePillShape(null)).toBe("circles");
    expect(parseUsagePillShape("battery")).toBe("battery");
    expect(parseUsagePillPlacement("nope")).toBe("inBar");
    expect(parseUsagePillPlacement("below")).toBe("below");
  });

  it("M-20261126-108: keeps a shape per place, and the message bar keeps the original key", () => {
    expect(usagePillShapeChoice("messageBar").key).toBe("sagax.usagePillShape.v1");
    expect(usagePillShapeChoice("accountMenu").key).toBe("sagax.usagePillShape.accountMenu.v1");
    expect(usagePillShapeChoice("menuBar").key).toBe("sagax.usagePillShape.menuBar.v1");
    setUsagePillShapeFor("messageBar", "battery");
    setUsagePillShapeFor("accountMenu", "dots");
    setUsagePillShapeFor("menuBar", "text");
    expect(usagePillShapeFor("messageBar")).toBe("battery");
    expect(usagePillShapeFor("accountMenu")).toBe("dots");
    expect(usagePillShapeFor("menuBar")).toBe("text");
  });

  it("M-20261126-108: the message bar keeps sagax.usagePillShape.v1 so a saved shape still applies there", () => {
    setUsagePillShapeFor("messageBar", "battery");
    expect(usagePillShape.key).toBe("sagax.usagePillShape.v1");
    expect(usagePillShape.get()).toBe("battery");
    expect(usagePillShapeFor("messageBar")).toBe("battery");
    // other places keep their own values
    expect(usagePillShapeFor("menuBar")).toBe("bars");
  });
});
