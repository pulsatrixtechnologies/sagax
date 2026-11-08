import { describe, expect, it } from "vitest";
import { directFiltersPass, directWakeVerdict, mailIsCalendarInvite, normalizeDirectTriggers, parseDirectFilters } from "./direct-triggers.ts";

describe("direct triggers (#2691)", () => {
  it("normalizes and refuses bad shapes", () => {
    expect(normalizeDirectTriggers({ mail: { on: true, filters: "  from:*@client.com ,  facture " } })).toEqual({ ok: true, value: { mail: { on: true, filters: "from:*@client.com , facture" } } });
    expect(normalizeDirectTriggers({})).toEqual({ ok: true, value: null });
    expect(normalizeDirectTriggers(null)).toEqual({ ok: true, value: null });
    expect(normalizeDirectTriggers({ fax: { on: true } }).ok).toBe(false);
    expect(normalizeDirectTriggers({ sms: { on: "yes" } }).ok).toBe(false);
    expect(normalizeDirectTriggers({ sms: { on: true, filters: "x".repeat(501) } }).ok).toBe(false);
  });

  it("parses senders, words and exclusions", () => {
    expect(parseDirectFilters("from:*@client.com, de:boss@x.ca, -from:noreply@*, facture, -infolettre")).toEqual({
      from: ["*@client.com", "boss@x.ca"], notFrom: ["noreply@*"], words: ["facture"], notWords: ["infolettre"],
    });
  });

  it("filters: exclusions win, includes must match", () => {
    const line = "from:*@client.com, -from:noreply@*, -infolettre";
    expect(directFiltersPass(line, { from: "Alex@Client.com", text: "Facture 12" })).toBe(true);
    expect(directFiltersPass(line, { from: "alex@other.com", text: "Facture 12" })).toBe(false);
    expect(directFiltersPass(line, { from: "alex@client.com", text: "Notre infolettre" })).toBe(false);
    expect(directFiltersPass("facture", { from: "a@b.c", text: "rien" })).toBe(false);
    expect(directFiltersPass("", { text: "anything" })).toBe(true);
  });

  it("matches phone numbers by digits", () => {
    expect(directFiltersPass("from:*5550101", { from: "+1 819 555 0101", text: "allo" })).toBe(true);
    expect(directFiltersPass("-from:+1 819 555 0101", { from: "+18195550101", text: "allo" })).toBe(false);
  });

  it("a channel follows the switch until set, then its own setting", () => {
    expect(directWakeVerdict({}, true, "mail", { text: "x" })).toBe("wake");
    expect(directWakeVerdict({}, false, "mail", { text: "x" })).toBe("off");
    expect(directWakeVerdict({ directTriggers: { mail: { on: true } } }, false, "mail", { text: "x" })).toBe("wake");
    expect(directWakeVerdict({ directTriggers: { mail: { on: false } } }, true, "mail", { text: "x" })).toBe("off");
    expect(directWakeVerdict({ directTriggers: { sms: { on: true, filters: "urgent" } } }, true, "sms", { text: "allo" })).toBe("filtered");
    // other sources ignore the direct triggers
    expect(directWakeVerdict({ directTriggers: { mail: { on: true } } }, false, "run", { text: "x" })).toBe("off");
  });

  it("recognizes calendar invitations", () => {
    expect(mailIsCalendarInvite([{ name: "invite.ics", type: "application/octet-stream" }])).toBe(true);
    expect(mailIsCalendarInvite([{ name: "x", type: "text/calendar; method=REQUEST" }])).toBe(true);
    expect(mailIsCalendarInvite([{ name: "facture.pdf", type: "application/pdf" }])).toBe(false);
  });
});
