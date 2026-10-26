import { describe, expect, it } from "vitest";

import { checkPhoneToolResult, isPhoneRequestKind, isPhoneToolCallName, parsePhoneToolArgs, phoneToolGrantKey, phoneToolsFrameAllowed } from "./phone-tools.ts";

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
  it("never offers Toujours permettre for a shortcut, the clipboard or photos", () => {
    expect(phoneToolGrantKey("shortcut", { name: "Pay" })).toBeNull();
    expect(phoneToolGrantKey("clipboard", {})).toBeNull();
    expect(phoneToolGrantKey("photos", {})).toBeNull();
  });

  it("covers exactly what was allowed, nothing wider (review of #960)", () => {
    expect(phoneToolGrantKey("reminders", { action: "list" })).toBe("reminders:read");
    expect(phoneToolGrantKey("reminders", { action: "create", title: "x" })).toBeNull();
    expect(phoneToolGrantKey("calendar", { action: "create", title: "x", start: "a", end: "b" })).toBeNull();
    expect(phoneToolGrantKey("location", {})).toBe("location:read:approximate");
    expect(phoneToolGrantKey("location", { precise: true })).toBeNull();
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

  it("accepts only a sealed envelope, never a number in clear (JC 2026-10-21)", () => {
    const enc = "B" + "A".repeat(86);
    const sealed = { encapsulatedKey: enc, ciphertext: "A".repeat(80) };
    expect(checkPhoneToolResult("card_scan", {}, { number: "4111111111111111" }).ok).toBe(false);
    expect(checkPhoneToolResult("card_scan", {}, { ...sealed, number: "4111111111111111" })).toEqual({ ok: true, result: sealed });
  });
});
