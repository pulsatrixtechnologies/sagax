import { describe, expect, it } from "vitest";

import { callTwiml, canadianNumber, createCallArgs, formatPhone, maskPhone, parseOutboundCall } from "./outbound-call.ts";

const good = { to: "514-555-0142", from: "+1 438 555 0100", purpose: "Confirmer le rendez-vous", message: "Jean confirme le rendez-vous de mardi à 10 h." };

describe("outbound call", () => {
  it("parses a Canadian call and refuses elsewhere", () => {
    expect(parseOutboundCall(good)).toEqual({ to: "+15145550142", from: "+14385550100", purpose: good.purpose, message: good.message, language: "fr" });
    expect(parseOutboundCall({ ...good, to: "+1 212 555 0142" })).toMatch(/Only Canadian/);
    expect(parseOutboundCall({ ...good, to: "+1 800 555 0142" })).toMatch(/Only Canadian/);
    expect(parseOutboundCall({ ...good, to: "+33 1 23 45 67 89" })).toMatch(/Only Canadian/);
    expect(parseOutboundCall({ ...good, from: "nope" })).toMatch(/from must/);
    expect(parseOutboundCall({ ...good, message: "x".repeat(601) })).toMatch(/message/);
    expect(parseOutboundCall({ ...good, account: "bad" })).toMatch(/account/);
    expect(parseOutboundCall(null)).toMatch(/needs/);
    expect(canadianNumber("+15145550142")).toBe(true);
    // N11, 0/1 exchanges and 976 premium are not callable (review)
    for (const bad of ["+15149110000", "+15144111234", "+15140551234", "+15141551234", "+15149761234"]) expect(canadianNumber(bad), bad).toBe(false);
    expect(parseOutboundCall({ ...good, purpose: "Confirmer\u202E le rendez-vous" })).toMatchObject({ purpose: "Confirmer le rendez-vous" });
  });

  it("masks and formats", () => {
    expect(maskPhone("+15145550142")).toBe("+1 514 ••• •• 42");
    expect(formatPhone("+15145550142")).toBe("+1 514 555 0142");
  });

  it("builds TwiML: disclosure, on whose behalf, callback number and how to stop, escaped (ÉFVP 2026-10-22)", () => {
    const twiml = callTwiml({ purpose: "Test <Play>", message: "a & b", language: "fr" }, { botName: "Rocket", personName: "Jean", callback: "+14385550100" });
    expect(twiml).toContain("intelligence artificielle, au nom de Jean");
    expect(twiml).toContain("Pour nous joindre, composez le 4 3 8, 5 5 5, 0 1 0 0");
    expect(twiml).toContain("Pour ne plus recevoir d&apos;appels, dites-le au 4 3 8, 5 5 5, 0 1 0 0");
    expect(twiml).not.toContain("ne prend pas de réponse");
    expect(twiml).toContain("Test &lt;Play&gt;");
    expect(twiml).toContain("a &amp; b");
    expect(twiml).not.toContain("<Play>");
    expect(twiml).toMatch(/<Hangup\/><\/Response>$/);
    const en = callTwiml({ purpose: "p", message: "m", language: "en" }, { botName: "Rocket", personName: "Jean", callback: "+14385550100" });
    expect(en).toContain("calling on behalf of Jean");
    expect(en).toContain("To stop receiving these calls, say so at 4 3 8, 5 5 5, 0 1 0 0");
  });

  it("builds the Perspicax write, dry run first", () => {
    const request = parseOutboundCall(good);
    if (typeof request === "string") throw new Error(request);
    const args = createCallArgs(request, "<Response/>", true);
    expect(args).toMatchObject({ resource: "Calls", action: "create", _dry_run: true, set: { To: "+15145550142", From: "+14385550100", Twiml: "<Response/>" } });
    expect(createCallArgs(request, "<Response/>", false)).not.toHaveProperty("_dry_run");
  });
});
