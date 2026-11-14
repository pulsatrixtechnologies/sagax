import { describe, expect, it } from "vitest";

import { maskNumber, normalizePhone, parseReachMe, readReachDecision, splitReachReply } from "./reach-me.ts";

describe("Reach me settings", () => {
  it("parses channels, the number and hours; refuses an unknown channel", () => {
    const parsed = parseReachMe({ channels: ["sms", "push", "sms"], smsNumber: "514 555 0123", hours: { always: false, timeZone: "America/Toronto", ranges: [{ days: [5, 1, 1], start: "08:00", end: "18:00" }] } });
    expect(parsed).toEqual({ ok: true, settings: { channels: ["sms", "push"], smsNumber: "+15145550123", hours: { always: false, timeZone: "America/Toronto", ranges: [{ days: [1, 5], start: "08:00", end: "18:00" }] } } });
    expect(parseReachMe({ channels: ["pigeon"] })).toMatchObject({ ok: false, field: "channels" });
  });
  it("text messages need the person's own number", () => {
    expect(parseReachMe({ channels: ["sms"] })).toMatchObject({ ok: false, field: "smsNumber" });
    expect(parseReachMe({ channels: ["push"], smsNumber: "12" })).toMatchObject({ ok: false, field: "smsNumber" });
  });
  it("refuses a bad time zone or time", () => {
    expect(parseReachMe({ channels: [], hours: { always: false, timeZone: "Mars/Base", ranges: [{ days: [1], start: "08:00", end: "09:00" }] } })).toMatchObject({ ok: false, field: "hours" });
    expect(parseReachMe({ channels: [], hours: { always: false, timeZone: "UTC", ranges: [{ days: [1], start: "8h", end: "09:00" }] } })).toMatchObject({ ok: false, field: "hours" });
  });
  it("masks a number like Perspicax does", () => {
    expect(maskNumber("+15145550123")).toBe("***0123");
    expect(normalizePhone("+1 (514) 555-0123")).toBe("+15145550123");
  });
});

describe("Reach me hours (#4250 S2: one quiet-hours setting per person)", () => {
  it("per-bot hours a previous version saved are still read and kept, so that version reads them back", () => {
    const hours = { always: false, timeZone: "America/Toronto", ranges: [{ days: [1, 2, 3, 4, 5], start: "08:00", end: "18:00" }] };
    const parsed = parseReachMe({ channels: ["push"], hours });
    expect(parsed.ok && parsed.settings.hours).toEqual(hours);
  });
});

describe("Reach me replies", () => {
  it("the code comes first, any case, then the words", () => {
    expect(splitReachReply("k7q2 oui")).toBeNull(); // 2 and Q are not in the alphabet
    expect(splitReachReply("KM3X oui")).toEqual({ code: "KM3X", rest: "oui" });
    expect(splitReachReply(" km3x: Mardi 10 h")).toEqual({ code: "KM3X", rest: "Mardi 10 h" });
    expect(splitReachReply("oui KM3X")).toBeNull();
    expect(splitReachReply("KM3XY oui")).toBeNull();
  });
  it("reads one word: yes or no, in French or English", () => {
    expect(readReachDecision("Oui merci")).toBe("allow");
    expect(readReachDecision("no")).toBe("deny");
    expect(readReachDecision("non, pas ça")).toBe("deny");
    expect(readReachDecision("peut-être")).toBeNull();
  });
});
