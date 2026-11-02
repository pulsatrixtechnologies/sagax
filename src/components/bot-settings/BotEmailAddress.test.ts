// The bot's own email address on its profile (B21, contract C of
// 2026-10-21): the address with a Copy button, the one-line rule, the
// admin's off state, and nothing at all when no address is available.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { botInboundMailFrom } from "@/lib/bot-inbound-mail";
import { BotEmailAddressCard, BotEmailAddressForm, localPartError } from "./BotEmailAddress";

const render = (mail: Parameters<typeof BotEmailAddressCard>[0]["mail"], onChange?: Parameters<typeof BotEmailAddressCard>[0]["onChange"]) =>
  renderToStaticMarkup(createElement(BotEmailAddressCard, { mail, ...(onChange ? { onChange } : {}) }));

describe("Bot email address", () => {
  it("shows the address, a Copy button and the rule", () => {
    const html = render({ available: true, address: "cryptic@bots.example.org", enabled: true });
    expect(html).toContain("Email address");
    expect(html).toContain("cryptic@bots.example.org");
    expect(html).toContain('aria-label="Copy email address"');
    expect(html).toContain("Mail to this address wakes a Bot email trigger.");
    expect(html).toContain("tagged address");
    expect(html).not.toContain("Waiting for the administrator to turn it on");
    expect(html).toContain('data-bot-email-address=""');
    expect(html).toContain("data-bot-email-tags-empty");
  });

  it("lists tag routing rows without another bot's routines", () => {
    const html = renderToStaticMarkup(createElement(BotEmailAddressCard, {
      mail: { available: true, address: "cryptic@bots.example.org", enabled: true },
      tags: [
        { tag: "reports", address: "cryptic+reports@bots.example.org", routineId: "r1", routineName: "Reports", enabled: true },
        { tag: "shop", address: "cryptic+shop@bots.example.org", routineId: "r2", routineName: "Shop", enabled: false },
      ],
    }));
    expect(html).toContain("data-bot-email-tags=");
    expect(html).toContain("cryptic+reports@bots.example.org");
    expect(html).toContain("Reports");
    expect(html).toContain("Shop");
    expect(html).toContain("paused");
    expect(html).not.toContain("data-bot-email-tags-empty");
  });

  it("greys an address the administrator has not turned on yet (off by default, Owner decision 1)", () => {
    const html = render({ available: true, address: "ember@bots.example.org", enabled: false });
    expect(html).toContain("ember@bots.example.org");
    expect(html).toContain("Waiting for the administrator to turn it on");
    expect(html).toContain("data-bot-email-pending");
    expect(html).toContain("text-ink-tertiary");
  });

  it("offers Change to the owner only (Owner decision 4)", () => {
    const onChange = async () => ({ ok: true as const });
    expect(render({ available: true, address: "a@b.example", enabled: true, canChange: true }, onChange)).toContain(">Change<");
    expect(render({ available: true, address: "a@b.example", enabled: true, canChange: false }, onChange)).not.toContain(">Change<");
    expect(render({ available: true, address: "a@b.example", enabled: true, canChange: true })).not.toContain(">Change<");
  });

  it("the change form: the part before @, the domain kept, Save off while the format is wrong, the reason shown", () => {
    const form = (value: string, error?: string) => renderToStaticMarkup(createElement(BotEmailAddressForm, { domain: "bots.example.org", value, error, busy: false, onValue: () => {}, onSave: () => {}, onCancel: () => {} }));
    const good = form("factures");
    expect(good).toContain('value="factures"');
    expect(good).toContain("@bots.example.org");
    expect(good).toContain("Lowercase letters, digits, dots or dashes (40 at most).");
    expect(good).not.toMatch(/<button[^>]*data-bot-email-save=""[^>]*disabled=""|<button[^>]*disabled=""[^>]*data-bot-email-save=""/);
    expect(form("Factures")).toMatch(/<button[^>]*data-bot-email-save=""[^>]*disabled=""|<button[^>]*disabled=""[^>]*data-bot-email-save=""/);
    expect(form("factures", localPartError("taken"))).toContain("This address is already taken. Pick another one.");
  });

  it("names every refusal in words", () => {
    for (const code of ["invalid", "taken", "not_owner", "no_bot", "rate_limited", "unavailable", "something-else"]) {
      expect(localPartError(code)).not.toMatch(/^botPanel\./);
    }
    expect(localPartError("something-else")).toBe(localPartError("unavailable"));
    expect(localPartError("rate_limited")).toBe("Too many address changes. Wait a minute, then try again.");
  });

  it("renders nothing when unavailable, loading or empty", () => {
    expect(render({ available: false, address: null, enabled: false })).toBe("");
    expect(render(null)).toBe("");
    expect(render({ available: true, address: null, enabled: true })).toBe("");
  });

  it("reads only the contract's answer", () => {
    expect(botInboundMailFrom({ available: true, address: "a@b.example", enabled: true })).toEqual({ available: true, address: "a@b.example", enabled: true, canChange: false });
    expect(botInboundMailFrom({ available: true, address: "a@b.example", enabled: false, canChange: true })).toEqual({ available: true, address: "a@b.example", enabled: false, canChange: true });
    for (const bad of [null, undefined, "x", [], { available: "true", address: "a@b.example", enabled: true }, { available: true, address: 7, enabled: true }, { available: true, address: "not an address", enabled: true }, { available: false, address: "a@b.example", enabled: true }]) {
      expect(botInboundMailFrom(bad), JSON.stringify(bad)).toEqual({ available: false, address: null, enabled: false });
    }
  });
});
