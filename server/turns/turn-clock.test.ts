import { describe, expect, it } from "vitest";

import { TURN_CLOCK_MARKER, clockAtHandoff, turnClockEnabled, turnClockIn, turnClockNote, turnTimeZone, withTurnClock, zonedNow } from "./turn-clock.ts";
import { withoutTurnClock } from "../testing/turn-clock-text.ts";

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

  // #3511, #3516: the note is the turn's start, read again when the minute
  // matters, and no longer tells the bot to give the time.
  it("is the turn's start, read again when the minute matters, and never asks for the time unasked", () => {
    const note = turnClockNote(at, "America/Toronto");
    expect(note).toContain("(UTC-04:00), when this turn started.");
    expect(note).toContain("A turn can run for minutes: when the person asks the time or the answer depends on the minute, read the clock again (a shell `date`) instead of repeating this one.");
    expect(note).toContain("Say the time only when asked or needed.");
    expect(note).not.toContain("answer the date, the time");
    expect(note).not.toContain("This clock is exact");
    expect(note).not.toMatch(/Give dates and times/);
    expect(note).toContain("Times you show are in America/Toronto unless the user asks for another zone");
  });

  it("is stripped from an echoed turn", () => {
    const echoed = withTurnClock("Bonjour", at, "America/Toronto");
    expect(withoutTurnClock(echoed)).toBe("Bonjour");
    expect(withoutTurnClock(`avant\n\n${echoed}`)).toBe("avant\n\nBonjour");
  });

  it("is read again at the engine hand-off, and nowhere else in the text", () => {
    const zone = "America/Toronto";
    const later = new Date("2026-10-12T01:43:00Z");
    const clock = { timeZone: zone, note: turnClockNote(at, zone) };
    const text = `recalled\n\n${withTurnClock("Bonjour", at, zone)}`;
    const handed = clockAtHandoff({ text, recoveryText: text, turnClock: clock }, later);
    expect(handed.text).toBe(`recalled\n\n${turnClockNote(later, zone)}\n\nBonjour`);
    expect(handed.recoveryText).toBe(handed.text);
    expect(handed.turnClock).toEqual({ timeZone: zone, note: turnClockNote(later, zone) });
    // no note to read again: the input is left as it is
    const plain = { text: "Bonjour" };
    expect(clockAtHandoff(plain, later)).toBe(plain);
    expect(turnClockIn(text, zone)).toEqual(clock);
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
