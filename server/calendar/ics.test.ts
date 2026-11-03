// The calendar poller's iCalendar reader: time zones, recurrences,
// exceptions and overrides.
import { describe, expect, it } from "vitest";

import { instancesBetween, parseIcs, wallToUtc, zoneFor } from "./ics.ts";

const cal = (...lines: string[]) => ["BEGIN:VCALENDAR", ...lines, "END:VCALENDAR"].join("\r\n");
const at = (iso: string) => Date.parse(iso);

describe("ics", () => {
  it("converts zoned wall-clock times across daylight saving time", () => {
    expect(new Date(wallToUtc({ year: 2026, month: 10, day: 30, hour: 9, minute: 0, second: 0 }, "America/Toronto")).toISOString()).toBe("2026-10-30T13:00:00.000Z");
    expect(new Date(wallToUtc({ year: 2026, month: 11, day: 2, hour: 9, minute: 0, second: 0 }, "America/Toronto")).toISOString()).toBe("2026-11-02T14:00:00.000Z");
    expect(zoneFor("Eastern Standard Time")).toBe("America/New_York");
    expect(zoneFor("Not/AZone")).toBe("UTC");
  });

  it("expands a weekly series in local time, minus exceptions and moved instances", () => {
    const events = parseIcs(cal(
      "BEGIN:VEVENT", "UID:s1", "DTSTART;TZID=America/Toronto:20261026T090000", "RRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=6", "EXDATE;TZID=America/Toronto:20261028T090000", "SUMMARY:Sync", "END:VEVENT",
      "BEGIN:VEVENT", "UID:s1", "RECURRENCE-ID;TZID=America/Toronto:20261102T090000", "DTSTART;TZID=America/Toronto:20261102T113000", "SUMMARY:Sync (moved)", "END:VEVENT",
    ));
    const starts = instancesBetween(events, at("2026-10-20T00:00:00Z"), at("2026-11-30T00:00:00Z")).map((instance) => `${new Date(instance.start).toISOString()} ${instance.event.summary}`);
    expect(starts).toEqual([
      "2026-10-26T13:00:00.000Z Sync",
      "2026-11-02T16:30:00.000Z Sync (moved)",
      "2026-11-04T14:00:00.000Z Sync",
      "2026-11-09T14:00:00.000Z Sync",
      "2026-11-11T14:00:00.000Z Sync",
    ]);
  });

  it("handles daily, monthly, UNTIL, cancelled and all-day events", () => {
    const events = parseIcs(cal(
      "BEGIN:VEVENT", "UID:d", "DTSTART:20261014T120000Z", "RRULE:FREQ=DAILY;INTERVAL=2;UNTIL=20261020T000000Z", "SUMMARY:Every other day", "END:VEVENT",
      "BEGIN:VEVENT", "UID:m", "DTSTART:20260131T150000Z", "RRULE:FREQ=MONTHLY", "SUMMARY:Month end", "END:VEVENT",
      "BEGIN:VEVENT", "UID:c", "DTSTART:20261016T150000Z", "STATUS:CANCELLED", "SUMMARY:Cancelled", "END:VEVENT",
      "BEGIN:VEVENT", "UID:a", "DTSTART;VALUE=DATE:20261016", "SUMMARY:Holiday", "END:VEVENT",
    ));
    const list = instancesBetween(events, at("2026-10-01T00:00:00Z"), at("2026-12-31T23:59:59Z")).map((instance) => `${instance.event.uid}@${new Date(instance.start).toISOString().slice(0, 10)}`);
    expect(list).toEqual(["d@2026-10-14", "d@2026-10-16", "d@2026-10-18", "m@2026-10-31", "m@2026-12-31"]);
  });

  it("reads escaped text and folded lines, and ignores alarms", () => {
    const [event] = parseIcs(cal("BEGIN:VEVENT", "UID:x", "DTSTART:20261016T150000Z", "SUMMARY:Plan\\, review\\; ship", "DESCRIPTION:line one\\nline", " two", "BEGIN:VALARM", "SUMMARY:alarm", "END:VALARM", "END:VEVENT"));
    expect(event).toMatchObject({ summary: "Plan, review; ship", description: "line one\nlinetwo" });
  });
});
