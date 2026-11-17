// #2080 L2: Account > Language and region keeps one time-zone row whose
// first option is Automatic (this computer's zone).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TimeZoneRows, detectedTimeZone, isTimeZone, timeZoneChoices } from "./TimeZoneSettings";
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

// The time zone is the page's plain select, like Language and Send key, and the
// row says its value once, in the control (no muted second line).
describe("TimeZoneRows", () => {
  it("draws one select with the value and no description line", () => {
    const html = renderToStaticMarkup(createElement(TimeZoneRows));
    const label = t("settings.timeZone.autoOption", { zone: detectedTimeZone() });
    expect(html).toContain('aria-haspopup="listbox"');
    const text = html.replace(/<[^>]*>/g, "|");
    expect(text.split(label).length - 1).toBe(1);
    expect(html).not.toContain("<input");
  });
});
