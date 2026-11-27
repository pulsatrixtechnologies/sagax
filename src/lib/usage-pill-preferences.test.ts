import { afterEach, describe, expect, it } from "vitest";
import { SETTINGS } from "../../shared/settings-actions";
import { USER_PREFERENCE_KEYS } from "../../shared/user-preferences";
import { contextIndicator, parseUsagePillShape, USAGE_PILL_SHAPES, usagePillInBar, usagePillShape } from "./usage-pill-preferences";

// The owner, 2026-11-26 (M-20261126-106, M-20261126-108, #5406): the usage
// pill in the message bar, its shape and the context indicator are the
// person's own choices in Settings > Appearance.
describe("the usage pill's preferences", () => {
  afterEach(() => {
    usagePillInBar.set("on");
    usagePillShape.set("circles");
    contextIndicator.set("on");
  });

  it("are the person's synced appearance keys, and settings a bot can change", () => {
    for (const [choice, key, value] of [
      [usagePillInBar, "appearance.usagePillInBar", "enum:on|off"],
      [usagePillShape, "appearance.usagePillShape", "enum:bars|circles|battery|dots|text"],
      [contextIndicator, "appearance.contextIndicator", "enum:on|off"],
    ] as const) {
      expect(USER_PREFERENCE_KEYS).toContain(choice.key);
      const spec = SETTINGS.find((setting) => setting.key === key);
      expect(spec?.value).toBe(value);
      expect(spec?.where).toContain("Conversation");
    }
  });

  it("default to the pill shown, three circles and the context shown, and keep each choice", () => {
    expect(usagePillInBar.get()).toBe("on");
    expect(usagePillShape.get()).toBe("circles");
    expect(contextIndicator.get()).toBe("on");
    expect(USAGE_PILL_SHAPES).toEqual(["bars", "circles", "battery", "dots", "text"]);
    for (const shape of USAGE_PILL_SHAPES) {
      usagePillShape.set(shape);
      expect(usagePillShape.get()).toBe(shape);
    }
    usagePillInBar.set("off");
    contextIndicator.set("off");
    expect([usagePillInBar.get(), contextIndicator.get()]).toEqual(["off", "off"]);
    expect(parseUsagePillShape("nope")).toBe("circles");
    expect(parseUsagePillShape(null)).toBe("circles");
    expect(parseUsagePillShape("battery")).toBe("battery");
  });
});
