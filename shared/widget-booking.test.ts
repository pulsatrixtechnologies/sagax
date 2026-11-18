import { describe, expect, it } from "vitest";

import { bookingDays, bookingDayKey, bookingDayKind, bookingInstant, bookingMoment, bookingSlotLabel, bookingTime, bookingZone } from "./widget-booking.ts";
import { WIDGET_SAMPLES } from "./widget-samples.ts";
import { parseWidgetInput, resolveWidgetAction, widgetActions, widgetToText, type WidgetRoot } from "./widget.ts";

const ZONE = "America/Toronto";

function parsed(input: unknown): WidgetRoot {
  const result = parseWidgetInput(input);
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

const booking = (more: Record<string, unknown> = {}, slots: unknown[] = ["2026-11-09T15:30:00-05:00"]) =>
  ({ type: "Card", children: [{ type: "Booking", timeZone: ZONE, slots, ...more }] });

describe("booking times", () => {
  it("reads only ISO instants that carry an offset", () => {
    expect(bookingInstant("2026-11-09T15:30:00-05:00")).toBe("2026-11-09T20:30:00.000Z");
    expect(bookingInstant("2026-11-09T20:30Z")).toBe("2026-11-09T20:30:00.000Z");
    // no offset: it would be read in the server's zone, so it is refused
    expect(bookingInstant("2026-11-09T15:30:00")).toBeUndefined();
    expect(bookingInstant("tomorrow at 3")).toBeUndefined();
    expect(bookingZone("America/Toronto")).toBe("America/Toronto");
    expect(bookingZone("Mars/Base")).toBeUndefined();
  });

  it("words a time in the person's zone, whatever zone the instant came in", () => {
    // 20:30Z is 15:30 in Toronto in November
    expect(bookingTime("2026-11-09T20:30:00Z", ZONE, "en")).toMatch(/^3:30\sPM$/);
    expect(bookingTime("2026-11-09T20:30:00Z", "Asia/Tokyo", "en")).toMatch(/^5:30\sAM$/);
    expect(bookingTime("2026-11-09T20:30:00Z", ZONE, "fr")).toBe("15 h 30");
    expect(bookingMoment("2026-11-09T20:30:00Z", ZONE, "en")).toContain("Nov 9");
    expect(bookingSlotLabel("Book", "2026-11-09T20:30:00Z", ZONE, "en")).toMatch(/^Book Mon, Nov 9, 3:30\sPM$/);
  });

  it("groups slots by the person's day, not the UTC day", () => {
    // 23:30 Toronto on the 9th is already the 10th in UTC
    const days = bookingDays(["2026-11-10T04:30:00Z", "2026-11-09T20:30:00Z", "2026-11-10T15:00:00Z"], ZONE);
    expect(days.map((day) => [day.key, day.slots.length])).toEqual([["2026-11-09", 2], ["2026-11-10", 1]]);
    expect(bookingDayKey("2026-11-10T04:30:00Z", ZONE)).toBe("2026-11-09");
  });

  it("says Today and Tomorrow from the zone's own date", () => {
    const now = Date.parse("2026-11-10T02:00:00Z"); // 21:00 on the 9th in Toronto
    expect(bookingDayKind("2026-11-09", now, ZONE)).toBe("today");
    expect(bookingDayKind("2026-11-10", now, ZONE)).toBe("tomorrow");
    expect(bookingDayKind("2026-11-12", now, ZONE)).toBe("other");
  });
});

describe("the Booking node", () => {
  it("makes one settling Button per slot, earliest first, with the slot in its payload", () => {
    const root = parsed(booking({ durationMinutes: 30, meetingType: "Quick sync" }, ["2026-11-10T09:00:00-05:00", "2026-11-09T15:30:00-05:00", "2026-11-09T20:30:00Z"]));
    const node = root.children![0]!;
    expect(node.type).toBe("Booking");
    // the same instant twice is one slot
    expect(node.children!.map((child) => child.label)).toEqual([expect.stringMatching(/^Book Mon, Nov 9, 3:30\sPM$/), expect.stringMatching(/^Book Tue, Nov 10, 9:00\sAM$/)]);
    expect(node.children![0]!.onClickAction).toEqual({
      type: "book_slot",
      payload: { start: "2026-11-09T20:30:00.000Z", end: "2026-11-09T21:00:00.000Z", durationMinutes: 30, timeZone: ZONE, meetingType: "Quick sync" },
    });
    expect(widgetActions(root).map((entry) => entry.tone)).toEqual(["submit", "submit"]);
  });

  it("answers a time press with the slot, and settles the card once", () => {
    const root = parsed(booking({ durationMinutes: 30 }, ["2026-11-09T15:30:00-05:00"]));
    const [entry] = widgetActions(root);
    const done = resolveWidgetAction({ v: 1, root }, entry!.ref, {});
    expect(done).toMatchObject({ ok: true, tone: "submit", action: { type: "book_slot" } });
    expect(resolveWidgetAction({ v: 1, root, settled: { ref: entry!.ref, label: entry!.label, tone: "submit", at: 1 } }, entry!.ref, {})).toMatchObject({ ok: false, status: 409 });
  });

  it("refuses what would book the wrong time", () => {
    const refuse = (input: unknown) => { const result = parseWidgetInput(input); if (result.ok) throw new Error("expected a refusal"); return result.error; };
    expect(refuse(booking({}, []))).toContain("1 to 48 slots");
    expect(refuse(booking({}, ["2026-11-09T15:30:00"]))).toContain("offset");
    expect(refuse(booking({ timeZone: "Mars/Base" }))).toContain("IANA");
    expect(refuse(booking({}, Array.from({ length: 49 }, (_, index) => `2026-11-${String(10 + Math.floor(index / 24)).padStart(2, "0")}T${String(index % 24).padStart(2, "0")}:00:00Z`)))).toContain("1 to 48 slots");
    expect(refuse(booking({ upcoming: [{ name: "Jordan Lee", start: "soon" }] }))).toContain("upcoming");
  });

  it("keeps the upcoming bookings it was given and reads as one line of text", () => {
    const root = parsed(WIDGET_SAMPLES.bookingCard);
    const node = root.children![0]!;
    expect(node.upcoming).toHaveLength(4);
    expect(node.upcomingMore).toBe(1);
    const text = widgetToText(root);
    expect(text).toContain("Book a call");
    expect(text).toContain("Quick sync");
    expect(text).toContain("Jordan Lee");
  });
});
