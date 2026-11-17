import { describe, expect, it } from "vitest";
import { formatAbsolute, formatClock, formatFull, formatLateness, formatRelative, isBareDay, isGuid, percentValue, sameText } from "./record-card-format";

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

describe("a calendar day (a date with no time) is the same day in every zone", () => {
  // 2026-11-05 as a bare day. Read as midnight UTC it is the evening of the 4th
  // in Toronto (UTC-5), and the 5th in Auckland (UTC+13) already at 13:00.
  const DAY = "2026-11-05";
  const ZONES = ["America/Toronto", "America/Los_Angeles", "Pacific/Auckland", "Asia/Tokyo", "UTC"];
  it("is told from an instant", () => {
    expect(isBareDay(DAY)).toBe(true);
    expect(isBareDay("2026-11-05T00:00:00Z")).toBe(false);
  });
  it.each(ZONES)("writes the 5th as the 5th in %s", (tz) => {
    // a long time before, so it reads as a date and not as "yesterday"
    const now = Date.parse("2026-03-01T12:00:00Z");
    expect(formatAbsolute(DAY, now, "en", tz)).toMatch(/Nov 5/);
    expect(formatAbsolute(DAY, now, "fr", tz)).toMatch(/5 nov/);
    expect(formatFull(DAY, "en", tz)).toMatch(/November 5, 2026/);
  });
  it("does not turn late five hours early in a zone behind UTC", () => {
    // 2026-11-05 22:00 in Toronto is 2026-11-06 03:00Z: the 5th is still going on in Toronto
    const eveningOfThe5th = Date.parse("2026-11-06T03:00:00Z");
    expect(formatLateness(DAY, eveningOfThe5th, "en", "America/Toronto")).toBeNull();
    // the whole of the 6th later, it is one day late
    const morningOfThe6th = Date.parse("2026-11-06T13:00:00Z");
    expect(formatLateness(DAY, morningOfThe6th, "en", "America/Toronto")).toMatch(/^1\s+day$/);
    // the old reading (midnight UTC) said "late" at 03:00Z already
    expect(Date.parse(DAY)).toBeLessThan(eveningOfThe5th);
  });
  it("does not turn late early nor stay on time late in a zone ahead of UTC", () => {
    // 2026-11-05 20:00 in Auckland (UTC+13) is 2026-11-05 07:00Z: still the 5th there
    expect(formatLateness(DAY, Date.parse("2026-11-05T07:00:00Z"), "en", "Pacific/Auckland")).toBeNull();
    // 2026-11-06 00:30 in Auckland is 2026-11-05 11:30Z: the 5th is over there, one day late
    expect(formatLateness(DAY, Date.parse("2026-11-05T11:30:00Z"), "en", "Pacific/Auckland")).toMatch(/^1\s+day$/);
    // while at the same instant it is still the 5th in Toronto
    expect(formatLateness(DAY, Date.parse("2026-11-05T11:30:00Z"), "en", "America/Toronto")).toBeNull();
  });
  it("says today, tomorrow and yesterday by the zone's own calendar", () => {
    const onThe5thInToronto = Date.parse("2026-11-05T21:00:00-05:00");
    expect(formatAbsolute(DAY, onThe5thInToronto, "en", "America/Toronto")).toBe("today");
    expect(formatAbsolute("2026-11-06", onThe5thInToronto, "en", "America/Toronto")).toBe("tomorrow");
    expect(formatAbsolute("2026-11-04", onThe5thInToronto, "en", "America/Toronto")).toBe("yesterday");
    // the same instant is already the 6th in Auckland
    expect(formatAbsolute(DAY, onThe5thInToronto, "en", "Pacific/Auckland")).toBe("yesterday");
  });
  it("words a bare day relatively by whole calendar days of the zone, never as hours since midnight UTC", () => {
    // 2026-11-17 14:34 in Toronto is already 2026-11-18 08:34 in Auckland
    expect(formatRelative("2026-11-17", NOW, "en", "America/Toronto")).toBe("today");
    expect(formatRelative("2026-11-16", NOW, "en", "America/Toronto")).toBe("yesterday");
    expect(formatRelative("2026-11-10", NOW, "en", "America/Toronto")).toBe("7 days ago");
    expect(formatRelative("2026-11-18", NOW, "en", "America/Toronto")).toBe("tomorrow");
    expect(formatRelative("2026-11-18", NOW, "en", "Pacific/Auckland")).toBe("today");
    expect(formatRelative("2026-11-17", NOW, "en", "Pacific/Auckland")).toBe("yesterday");
    expect(formatRelative("2026-11-17", NOW, "fr", "America/Toronto")).toMatch(/aujourd/);
  });
  it("says the year of a fact of the record even in this year, and of any day in another", () => {
    const now = Date.parse("2026-11-17T14:34:00-05:00");
    expect(formatAbsolute("2026-12-31", now, "en", "America/Toronto", { year: true })).toBe("Thu, Dec 31, 2026");
    expect(formatAbsolute("2026-12-31", now, "en", "America/Toronto")).toBe("Thu, Dec 31");
    expect(formatAbsolute("2027-01-01", now, "en", "America/Toronto")).toMatch(/2027/);
  });
  it("leaves an instant as it was", () => {
    expect(formatLateness("2026-11-15T14:34:00-05:00", NOW, "fr", "America/Toronto")).toMatch(/^2\s+jours$/);
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
