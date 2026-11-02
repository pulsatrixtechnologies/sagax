import { describe, expect, it } from "vitest";

import {
  allowanceRefusal,
  botMayPay,
  merchantAllowed,
  mergePaymentsSettings,
  methodKey,
  parsePaymentsSettings,
  sumAmounts,
  utcMonthKey,
} from "./payments-settings.ts";

describe("payments-settings", () => {
  it("parses a default card and a bot allowance", () => {
    const parsed = parsePaymentsSettings({
      defaultMethod: { type: "card", cardId: "abcd1234" },
      bots: {
        "bot-nova": {
          enabled: true,
          perPurchaseLimit: "50",
          perMonthLimit: "200.5",
          merchants: ["Shop.Example.TEST", "shop.example.test"],
        },
      },
    });
    expect(parsed).toEqual({
      defaultMethod: { type: "card", cardId: "abcd1234" },
      bots: {
        "bot-nova": {
          enabled: true,
          perPurchaseLimit: "50.00",
          perMonthLimit: "200.50",
          merchants: ["shop.example.test"],
        },
      },
    });
  });

  it("refuses a bad wallet default and a bad merchant host", () => {
    expect(parsePaymentsSettings({ defaultMethod: { type: "wallet", wallet: "venmo" } })).toMatch(/shop_pay or link/);
    expect(parsePaymentsSettings({ bots: { "bot-a": { merchants: ["not a host"] } } })).toMatch(/hostname/);
  });

  it("merges patches and clears a default with null", () => {
    const merged = mergePaymentsSettings(
      { defaultMethod: { type: "wallet", wallet: "link" }, bots: { "bot-a": { enabled: true } } },
      { defaultMethod: null, bots: { "bot-a": { perPurchaseLimit: "10.00" }, "bot-b": { enabled: false } } },
    );
    expect(merged).toEqual({
      bots: {
        "bot-a": { enabled: true, perPurchaseLimit: "10.00" },
        "bot-b": { enabled: false },
      },
    });
  });

  it("lets every bot pay until the person turns one off", () => {
    expect(botMayPay(undefined, "bot-a")).toBe(true);
    expect(botMayPay({ bots: { "bot-a": { enabled: false } } }, "bot-a")).toBe(false);
    expect(botMayPay({ bots: { "bot-a": { enabled: false } } }, "bot-b")).toBe(true);
  });

  it("matches merchant hosts by exact name or suffix", () => {
    expect(merchantAllowed(undefined, "shop.example.test")).toBe(true);
    expect(merchantAllowed(["example.test"], "shop.example.test")).toBe(true);
    expect(merchantAllowed(["shop.example.test"], "other.example.test")).toBe(false);
  });

  it("refuses over limit, blocked bot, and off-list merchant", () => {
    const settings = {
      bots: {
        "bot-a": {
          enabled: true,
          perPurchaseLimit: "20.00",
          perMonthLimit: "30.00",
          merchants: ["ok.example.test"],
        },
        "bot-b": { enabled: false },
      },
    };
    expect(allowanceRefusal({
      settings, botId: "bot-b", amount: "1.00", domain: "ok.example.test", monthSpent: "0.00", currency: "CAD",
    })).toMatch(/not allowed to pay/);
    expect(allowanceRefusal({
      settings, botId: "bot-a", amount: "25.00", domain: "ok.example.test", monthSpent: "0.00", currency: "CAD",
    })).toMatch(/per-purchase limit/);
    expect(allowanceRefusal({
      settings, botId: "bot-a", amount: "15.00", domain: "ok.example.test", monthSpent: "20.00", currency: "CAD",
    })).toMatch(/monthly limit/);
    expect(allowanceRefusal({
      settings, botId: "bot-a", amount: "5.00", domain: "nope.example.test", monthSpent: "0.00", currency: "CAD",
    })).toMatch(/merchant list/);
    expect(allowanceRefusal({
      settings, botId: "bot-a", amount: "5.00", domain: "ok.example.test", monthSpent: "0.00", currency: "CAD",
    })).toBeNull();
  });

  it("sums amounts and keys a UTC month", () => {
    expect(sumAmounts(["10.00", "2.50"])).toBe("12.50");
    expect(utcMonthKey(Date.UTC(2026, 10, 15))).toBe("2026-11");
    expect(methodKey({ type: "wallet", wallet: "shop_pay" })).toBe("wallet:shop_pay");
  });
});
