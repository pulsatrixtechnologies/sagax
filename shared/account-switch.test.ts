import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { ACCOUNT_PICK_ENGLISH, accountDelayText, accountPickText, accountPickWords, accountSwitchSettingOf, cleanAccountThreshold } from "./account-switch.ts";

const NOW = Date.UTC(2026, 10, 19, 15, 0);

describe("the account strategy's words (#5014)", () => {
  it("says the account taken and why, in one line", () => {
    expect(accountPickText({ account: "Account B", why: { kind: "expiring", resetsAt: NOW + 40 * 60_000, unused: 60 } }, NOW))
      .toBe("Account B: its window resets in 40 min with 60% unused");
    expect(accountPickText({ account: "Work", why: { kind: "threshold", from: "Personal", used: 82, threshold: 80 } }, NOW))
      .toBe("Work: Personal reached 82% of its 5-hour window (threshold 80%)");
  });

  it("names a key for every reason", () => {
    const kinds = [
      { kind: "keeps", used: 3, threshold: 80 }, { kind: "keeps", threshold: 80 }, { kind: "started" },
      { kind: "expiresFirst", resetsAt: NOW + 3_600_000 }, { kind: "first" }, { kind: "mostFree", remaining: 40 },
      { kind: "fillUp" }, { kind: "weekly" }, { kind: "mostRoom", threshold: 80 }, { kind: "full", from: "A" },
      { kind: "planned" }, { kind: "planned", resetsAt: NOW + 600_000, unused: 50 },
    ] as const;
    for (const why of kinds) {
      const words = accountPickWords({ account: "A", why }, NOW);
      expect(words.key.startsWith("accountSwitch.why.")).toBe(true);
      expect(accountPickText({ account: "A", why }, NOW)).not.toMatch(/[–—{}]/);
    }
  });

  it("writes a delay the same way in both languages", () => {
    expect(accountDelayText(40 * 60_000)).toBe("40 min");
    expect(accountDelayText(130 * 60_000)).toBe("2 h 10");
    expect(accountDelayText(60 * 60_000)).toBe("1 h");
  });

  it("reads a setting with High-water at 80 % by default", () => {
    expect(accountSwitchSettingOf(undefined)).toEqual({ strategy: "high-water", threshold: 80 });
    expect(accountSwitchSettingOf({ strategy: "fill-up", threshold: "70" })).toEqual({ strategy: "fill-up", threshold: 70 });
    expect(cleanAccountThreshold(101)).toBeNull();
    expect(cleanAccountThreshold(9)).toBeNull();
  });
});

describe("the English lines", () => {
  it("are the app's English source, word for word", () => {
    const en = JSON.parse(readFileSync(new URL("../src/locales/en.json", import.meta.url), "utf8")) as Record<string, string>;
    for (const [key, words] of Object.entries(ACCOUNT_PICK_ENGLISH)) expect(en[key]).toBe(words);
  });
});
