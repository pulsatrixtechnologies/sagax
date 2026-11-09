// #2080 L2: Account > Language and region keeps one time-zone row whose
// first option is Automatic (this computer's zone).
import { describe, expect, it } from "vitest";
import { detectedTimeZone, isTimeZone, timeZoneChoices, timeZoneFieldWidth } from "./TimeZoneSettings";
import { t } from "@/lib/i18n";

describe("TimeZoneSettings helpers", () => {
  it("offers Automatic with the detected zone", () => {
    const zone = detectedTimeZone();
    expect(isTimeZone(zone)).toBe(true);
    expect(t("settings.timeZone.autoOption", { zone })).toBe(`Automatic (${zone})`);
    expect(timeZoneChoices()[0]).toBe("UTC");
    expect(timeZoneChoices()).toContain(zone);
  });

  // #3041: the field grows with its value so "Automatic (America/Toronto)"
  // is never clipped, and keeps the old 14rem floor for short zones.
  it("sizes the field to its value", () => {
    expect(timeZoneFieldWidth("UTC")).toBe("max(14rem, calc(3ch + 1.75rem))");
    const label = "Automatique (America/Argentina/ComodRivadavia)";
    expect(timeZoneFieldWidth(label)).toContain(`${label.length}ch`);
  });
});
