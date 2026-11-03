import { describe, expect, it } from "vitest";

import { TURN_CLOCK_MARKER, turnClockEnabled, turnClockNote, turnTimeZone, withTurnClock, zonedNow } from "./turn-clock.ts";

describe("turn clock", () => {
  // 2026-10-12T01:40:00Z is Sunday Oct 11, 9:40 PM in Toronto (EDT)
  const at = new Date("2026-10-12T01:40:00Z");

  it("says the speaker's local time and offset, not the container's UTC", () => {
    expect(zonedNow(at, "America/Toronto")).toEqual({ text: "Sunday, October 11, 2026 at 9:40 PM", offset: "UTC-04:00" });
    expect(zonedNow(at, "UTC").offset).toBe("UTC+00:00");
    // winter: EST
    expect(zonedNow(new Date("2026-12-01T15:00:00Z"), "America/Toronto")).toEqual({ text: "Tuesday, December 1, 2026 at 10:00 AM", offset: "UTC-05:00" });
    const note = turnClockNote(at, "America/Toronto");
    expect(note.startsWith(TURN_CLOCK_MARKER)).toBe(true);
    expect(note).toContain("Sunday, October 11, 2026 at 9:40 PM, America/Toronto (UTC-04:00)");
    expect(note).toContain("convert UTC");
  });

  it("picks the speaker's zone, then the owner's, then the server's; none set means no note", () => {
    expect(turnTimeZone({ speaker: "America/Toronto", owner: "Europe/Paris", server: "Asia/Tokyo" })).toBe("America/Toronto");
    expect(turnTimeZone({ speaker: null, owner: "Europe/Paris", server: "Asia/Tokyo" })).toBe("Europe/Paris");
    expect(turnTimeZone({ speaker: "Not/AZone", owner: null, server: "Asia/Tokyo" })).toBe("Asia/Tokyo");
    expect(turnTimeZone({ speaker: "Not/AZone", owner: null, server: null })).toBeNull();
    expect(turnTimeZone({})).toBeNull();
  });

  it("is put once before the turn's text", () => {
    const once = withTurnClock("Bonjour", at, "America/Toronto");
    expect(once.endsWith("\n\nBonjour")).toBe(true);
    expect(withTurnClock(once, at, "America/Toronto")).toBe(once);
  });

  it("is on unless SAGAX_TURN_CLOCK=off", () => {
    expect(turnClockEnabled({})).toBe(true);
    expect(turnClockEnabled({ SAGAX_TURN_CLOCK: "on" })).toBe(true);
    expect(turnClockEnabled({ SAGAX_TURN_CLOCK: " OFF " })).toBe(false);
  });
});
