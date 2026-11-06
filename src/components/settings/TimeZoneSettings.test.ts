// #2080 L2: Account > Language and region keeps one time-zone row whose
// first option is Automatic (this computer's zone).
import { describe, expect, it } from "vitest";
import { detectedTimeZone, isTimeZone, timeZoneChoices } from "./TimeZoneSettings";
import { t } from "@/lib/i18n";

describe("TimeZoneSettings helpers", () => {
  it("offers Automatic with the detected zone", () => {
    const zone = detectedTimeZone();
    expect(isTimeZone(zone)).toBe(true);
    expect(t("settings.timeZone.autoOption", { zone })).toBe(`Automatic (${zone})`);
    expect(timeZoneChoices()[0]).toBe("UTC");
    expect(timeZoneChoices()).toContain(zone);
  });
});
