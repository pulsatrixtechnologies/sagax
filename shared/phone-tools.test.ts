import { describe, expect, it } from "vitest";

import { HEALTH_TOOLS, checkPhoneToolResult, phoneToolAccess, phoneToolSelfApproved, isPhoneRequestKind, isPhoneToolCallName, parsePhoneToolArgs, phoneToolGrantKey, phoneToolsFrameAllowed } from "./phone-tools.ts";

describe("parsePhoneToolArgs", () => {
  it("refuses an unknown tool and names the known ones", () => {
    const parsed = parsePhoneToolArgs("camera_roll_all", {});
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toContain("location");
  });

  it("checks each tool's arguments", () => {
    expect(parsePhoneToolArgs("contacts", { query: "" }).ok).toBe(false);
    expect(parsePhoneToolArgs("contacts", { query: "Marie", fields: ["phone"], limit: 3 }).ok).toBe(true);
    expect(parsePhoneToolArgs("contacts", { query: "Marie", limit: 500 }).ok).toBe(false);
    expect(parsePhoneToolArgs("reminders", { action: "create" }).ok).toBe(false);
    expect(parsePhoneToolArgs("reminders", { action: "create", title: "Pain" }).ok).toBe(true);
    expect(parsePhoneToolArgs("location", { precise: true, extra: 1 }).ok).toBe(false);
  });

  it("keeps a calendar read to 31 days, forward", () => {
    expect(parsePhoneToolArgs("calendar", { action: "list", from: "2026-10-21T00:00:00Z", to: "2026-10-28T00:00:00Z" }).ok).toBe(true);
    expect(parsePhoneToolArgs("calendar", { action: "list", from: "2026-10-21T00:00:00Z", to: "2027-01-28T00:00:00Z" }).ok).toBe(false);
    expect(parsePhoneToolArgs("calendar", { action: "list", from: "2026-10-28T00:00:00Z", to: "2026-10-21T00:00:00Z" }).ok).toBe(false);
  });
});

describe("phoneToolGrantKey", () => {
  it("never offers Toujours permettre for a shortcut or photos", () => {
    expect(phoneToolGrantKey("shortcut", { name: "Pay" })).toBeNull();
    expect(phoneToolGrantKey("photos", {})).toBeNull();
  });

  it("offers it on the person's own phone for the clipboard, a reminder, an event and the precise position", () => {
    expect(phoneToolGrantKey("clipboard", {})).toBe("clipboard:read");
    expect(phoneToolGrantKey("reminders", { action: "create", title: "x" })).toBe("reminders:write:create");
    expect(phoneToolGrantKey("calendar", { action: "create", title: "x", start: "a", end: "b" })).toBe("calendar:write:create");
    expect(phoneToolGrantKey("home", { action: "list" })).toBe("home:read");
    expect(phoneToolGrantKey("home", { action: "run", scene: "Evening" })).toBe("home:write:run");
    expect(phoneToolGrantKey("alarms", { action: "list" })).toBe("alarms:read");
    expect(phoneToolGrantKey("alarms", { action: "create", label: "Wake", hour: 7, minute: 0 })).toBe("alarms:write:create");
    expect(phoneToolGrantKey("home", { action: "run", scene: "Evening" })).not.toBe(phoneToolGrantKey("home", { action: "list" }));
    expect(phoneToolGrantKey("location", { precise: true })).toBe("location:read:precise");
  });

  it("covers exactly what was allowed, nothing wider (review of #960)", () => {
    expect(phoneToolGrantKey("reminders", { action: "list" })).toBe("reminders:read");
    expect(phoneToolGrantKey("calendar", { action: "list", from: "a", to: "b" })).toBe("calendar:read");
    // A write key never covers a read, nor a read a write; precise is not approximate.
    expect(phoneToolGrantKey("reminders", { action: "create", title: "x" })).not.toBe(phoneToolGrantKey("reminders", { action: "list" }));
    expect(phoneToolGrantKey("location", {})).toBe("location:read:approximate");
    expect(phoneToolGrantKey("location", { precise: true })).not.toBe(phoneToolGrantKey("location", {}));
    expect(phoneToolGrantKey("contacts", { query: "a", fields: ["phone"] })).toBe("contacts:read:phone");
    expect(phoneToolGrantKey("contacts", { query: "a", fields: ["phone", "address"] })).toBe("contacts:read:address+phone");
    expect(phoneToolGrantKey("contacts", { query: "a" })).toBe("contacts:read:email+phone");
    expect(phoneToolGrantKey("status", {})).toBe("status:read");
  });

  it("names phone_tool as every engine calls it", () => {
    expect(isPhoneToolCallName("mcp__agents__phone_tool")).toBe(true);
    expect(isPhoneToolCallName("agents_phone_tool")).toBe(true);
    expect(isPhoneToolCallName("phone_tool")).toBe(true);
    expect(isPhoneToolCallName("microphone_tool_x")).toBe(false);
    expect(isPhoneToolCallName(undefined)).toBe(false);
  });
});

describe("checkPhoneToolResult", () => {
  it("coarsens a position the bot did not ask precise", () => {
    const checked = checkPhoneToolResult("location", {}, { latitude: 45.5016889, longitude: -73.567256, accuracyMeters: 5 });
    expect(checked).toEqual({ ok: true, result: { latitude: 45.502, longitude: -73.567, precise: false, accuracyMeters: 100 } });
  });

  it("keeps a precise position precise", () => {
    const checked = checkPhoneToolResult("location", { precise: true }, { latitude: 45.5016889, longitude: -73.567256, accuracyMeters: 5 });
    expect(checked.ok && checked.result.latitude).toBe(45.501689);
  });

  it("returns only the contact fields asked for, and no more contacts than the limit", () => {
    const raw = {
      contacts: [
        { name: "Marie Tremblay", phones: ["+1 514 555 0101"], emails: ["marie@example.com"], birthday: "1990-01-02", notes: "secret" },
        { name: "Marie Roy", phones: ["+1 514 555 0102"] },
      ],
    };
    const checked = checkPhoneToolResult("contacts", { query: "Marie", fields: ["phone"], limit: 1 }, raw);
    expect(checked).toEqual({ ok: true, result: { contacts: [{ name: "Marie Tremblay", phones: ["+1 514 555 0101"] }] } });
  });

  it("refuses an answer that does not fit the tool", () => {
    const homes = checkPhoneToolResult("home", { action: "list", limit: 1 }, {
      homes: [
        { name: "House", scenes: ["Evening"], accessories: [{ name: "Lamp", room: "Kitchen", on: true, id: "drop-me" }] },
        { name: "Other", scenes: [] },
      ],
    });
    expect(homes).toEqual({ ok: true, result: { homes: [{ name: "House", scenes: ["Evening"], accessories: [{ name: "Lamp", room: "Kitchen", on: true }] }] } });
    expect(checkPhoneToolResult("alarms", { action: "create", label: "Wake", hour: 7, minute: 30 }, { created: { label: "Wake", hour: 7, minute: 30, enabled: true } }).ok).toBe(true);
    expect(checkPhoneToolResult("alarms", { action: "create", label: "Wake", hour: 7, minute: 30 }, { created: { label: "Wake", hour: 25, minute: 0 } }).ok).toBe(false);
    expect(checkPhoneToolResult("location", {}, { latitude: 200, longitude: 0 }).ok).toBe(false);
    expect(checkPhoneToolResult("photos", {}, { images: [{ mimeType: "image/png", data: "AAAA" }] }).ok).toBe(false);
  });

  it("drops what a status answer should not carry", () => {
    const checked = checkPhoneToolResult("status", {}, { battery: { level: 0.5, state: "charging" }, wifiName: "Maison" });
    expect(checked).toEqual({ ok: true, result: { battery: { level: 0.5, state: "charging" } } });
  });
});

describe("phoneToolsFrameAllowed", () => {
  it("reaches the person's own streams only", () => {
    expect(phoneToolsFrameAllowed({ kind: "phone-tools", audience: "ann" }, "ann", "local")).toBe(true);
    expect(phoneToolsFrameAllowed({ kind: "phone-tools", audience: "ann" }, "bob", "local")).toBe(false);
    expect(phoneToolsFrameAllowed({ kind: "phone-tools", audience: "local" }, undefined, "local")).toBe(true);
    expect(phoneToolsFrameAllowed({ kind: "message" }, "bob", "local")).toBe(true);
  });
});

describe("card scan (row 84)", () => {
  it("is a request kind the phone offers, never a bot tool", () => {
    expect(isPhoneRequestKind("card_scan")).toBe(true);
    expect(parsePhoneToolArgs("card_scan", {}).ok).toBe(false);
    expect(phoneToolGrantKey("card_scan", {})).toBeNull();
  });

  it("accepts only a sealed envelope, never a number in clear(2026-10-21)", () => {
    const enc = "B" + "A".repeat(86);
    const sealed = { encapsulatedKey: enc, ciphertext: "A".repeat(80) };
    expect(checkPhoneToolResult("card_scan", {}, { number: "4111111111111111" }).ok).toBe(false);
    expect(checkPhoneToolResult("card_scan", {}, { ...sealed, number: "4111111111111111" })).toEqual({ ok: true, result: sealed });
  });
});

describe("health tools", () => {
  const from = "2026-11-01T00:00:00Z";
  it("checks a health_read window and category", () => {
    expect(parsePhoneToolArgs("health_read", { category: "steps", from, to: "2026-11-08T00:00:00Z", aggregation: "daily_sum" }).ok).toBe(true);
    expect(parsePhoneToolArgs("health_read", { category: "blood_type", from, to: "2026-11-08T00:00:00Z" }).ok).toBe(false);
    expect(parsePhoneToolArgs("health_read", { category: "steps", from, to: "2027-03-08T00:00:00Z" }).ok).toBe(false);
    expect(parsePhoneToolArgs("health_read", { category: "steps", from: "2026-11-08T00:00:00Z", to: from }).ok).toBe(false);
  });

  it("lets a bot write only the categories an app can add", () => {
    expect(parsePhoneToolArgs("health_write", { category: "water", value: 250 }).ok).toBe(true);
    expect(parsePhoneToolArgs("health_write", { category: "weight", value: 71.4 }).ok).toBe(true);
    expect(parsePhoneToolArgs("health_write", { category: "heart_rate", value: 60 }).ok).toBe(false);
    expect(parsePhoneToolArgs("health_write", { category: "water" }).ok).toBe(false);
    expect(parsePhoneToolArgs("health_write", { category: "workouts", workout_type: "yoga", start: from, end: "2026-11-01T01:00:00Z", note: "calme" }).ok).toBe(true);
    expect(parsePhoneToolArgs("health_write", { category: "workouts", workout_type: "yoga" }).ok).toBe(false);
  });

  it("is a write for health_write, never a card, never a saved grant", () => {
    expect(HEALTH_TOOLS).toEqual(["health_read", "health_write"]);
    expect(phoneToolAccess("health_write", {})).toBe("write");
    expect(phoneToolAccess("health_read", {})).toBe("read");
    expect(phoneToolGrantKey("health_read", {})).toBeNull();
    expect(phoneToolSelfApproved("health_write")).toBe(true);
    expect(phoneToolSelfApproved("location")).toBe(false);
    expect(isPhoneToolCallName("mcp__agents__health_read")).toBe(true);
    expect(isPhoneToolCallName("agents_health_write")).toBe(true);
  });

  it("keeps the daily rows the phone sent and drops anything else", () => {
    const checked = checkPhoneToolResult("health_read", {}, { category: "steps", unit: "count", aggregation: "daily_sum", days: [{ date: "2026-11-01", value: 8123, samples: 12 }], secret: "x" });
    expect(checked).toEqual({ ok: true, result: { category: "steps", unit: "count", aggregation: "daily_sum", days: [{ date: "2026-11-01", value: 8123, samples: 12 }] } });
    expect(checkPhoneToolResult("health_read", {}, { category: "steps", unit: "count", days: [{ date: "yesterday", value: 1 }] }).ok).toBe(false);
  });
});

// 2026-11-17: the phone's photo library (PhotoKit) as one more phone tool.
describe("photo_library", () => {
  it("checks each action's arguments, and every action reads", () => {
    expect(parsePhoneToolArgs("photo_library", { action: "list_albums", limit: 20 }).ok).toBe(true);
    expect(parsePhoneToolArgs("photo_library", { action: "search", album: "Trips", from: "2026-01-01", to: "2026-06-01", favorite: true, media: "photo", cursor: "30" }).ok).toBe(true);
    expect(parsePhoneToolArgs("photo_library", { action: "search", from: "2026-06-01", to: "2026-01-01" }).ok).toBe(false);
    expect(parsePhoneToolArgs("photo_library", { action: "search", cursor: "next" }).ok).toBe(false);
    expect(parsePhoneToolArgs("photo_library", { action: "read", ids: ["A/L0/001"] }).ok).toBe(true);
    expect(parsePhoneToolArgs("photo_library", { action: "export", ids: ["a", "b", "c", "d"] }).ok).toBe(false);
    expect(parsePhoneToolArgs("photo_library", { action: "export", ids: ["a"], original: true }).ok).toBe(true);
    expect(parsePhoneToolArgs("photo_library", { action: "delete", ids: ["a"] }).ok).toBe(false);
    for (const action of ["list_albums", "search", "read", "export"]) expect(phoneToolAccess("photo_library", { action })).toBe("read");
    expect(phoneToolGrantKey("photo_library", { action: "export" })).toBe("photo_library:read");
  });

  it("keeps the answer to what was asked: the limit, the ids, JPEG images only", () => {
    const photos = Array.from({ length: 40 }, (_, index) => ({ id: `P${index}`, width: 10, height: 10, favorite: false, media: "photo" }));
    const found = checkPhoneToolResult("photo_library", { action: "search", limit: 5 }, { photos, total: 40, next: "5", limited: true, extra: "dropped" });
    expect(found.ok && (found.result.photos as unknown[]).length).toBe(5);
    expect(found.ok && found.result.extra).toBeUndefined();
    expect(found.ok && found.result.limited).toBe(true);
    const sent = checkPhoneToolResult("photo_library", { action: "export", ids: ["a"] }, { images: [{ id: "a", mimeType: "image/jpeg", data: "AQID" }, { id: "b", mimeType: "image/jpeg", data: "AQID" }] });
    expect(sent.ok && (sent.result.images as unknown[]).length).toBe(1);
    expect(checkPhoneToolResult("photo_library", { action: "export", ids: ["a"] }, { images: [{ id: "a", mimeType: "image/png", data: "AQID" }] }).ok).toBe(false);
  });
});

