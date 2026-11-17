import { describe, expect, it } from "vitest";
import { formatAbsolute, formatClock, formatLateness, formatRelative, isGuid, percentValue, sameText } from "./record-card-format";

const NOW = Date.parse("2026-11-17T14:34:00-05:00");
const flat = (value: string) => value.replace(/\s/g, " ");

describe("record card times", () => {
  it("words the age relatively, in the language", () => {
    expect(flat(formatRelative("2026-11-17T14:05:00-05:00", NOW, "fr"))).toBe("il y a 29 min");
    expect(formatRelative("2026-11-14T14:34:00-05:00", NOW, "fr")).toBe("il y a 3 jours");
    expect(formatRelative("2026-11-14T14:34:00-05:00", NOW, "en")).toBe("3 days ago");
  });
  it("writes a clock time in the card's zone, never the device's", () => {
    const instant = "2026-11-17T19:34:00Z";
    expect(formatClock(instant, "en", "America/Toronto")).toMatch(/2:34/);
    expect(formatClock(instant, "en", "Asia/Tokyo")).toMatch(/4:34/);
    expect(flat(formatClock(instant, "fr", "America/Toronto"))).toBe("14 h 34");
  });
  it("says today and yesterday by the zone's own calendar", () => {
    // 23:30 in Toronto is already the next day in UTC
    expect(formatAbsolute("2026-11-17T04:30:00Z", NOW, "fr", "America/Toronto")).toMatch(/^hier/);
    expect(flat(formatAbsolute("2026-11-17T19:05:00Z", NOW, "fr", "America/Toronto"))).toBe("aujourd’hui 14 h 05");
  });
  it("drops the minutes of a whole hour and the year of this year", () => {
    expect(flat(formatAbsolute("2026-11-19T22:00:00Z", NOW, "fr", "America/Toronto"))).toMatch(/^jeu\. 19 nov\., 17 h$/);
    expect(formatAbsolute("2025-03-02T15:00:00Z", NOW, "en", "America/Toronto")).toMatch(/2025/);
  });
  it("measures lateness only for a past date", () => {
    expect(formatLateness("2026-11-15T14:34:00-05:00", NOW, "fr")).toMatch(/^2\s+jours$/);
    expect(formatLateness("2026-11-19T14:34:00-05:00", NOW, "fr")).toBeNull();
  });
});

describe("record card text", () => {
  it("knows a GUID", () => {
    expect(isGuid("6f1c2a52-3b7e-4f0a-9d51-0c7a8e1b2d34")).toBe(true);
    expect(isGuid("#481516")).toBe(false);
  });
  it("sees a description and the note it was taken from as one text", () => {
    expect(sameText("The counter printer has not answered a ping since Monday morning.", "The counter printer has not answered a ping since Monday morning. Restarted twice…")).toBe(true);
    expect(sameText("Driver reinstalled", "Still nothing this morning")).toBe(false);
  });
  it("reads a percent field only when it is written as one", () => {
    expect(percentValue("52 %")).toBe(52);
    expect(percentValue("52,5%")).toBe(52.5);
    expect(percentValue("31 / 60")).toBeNull();
    expect(percentValue("140 %")).toBeNull();
  });
});
