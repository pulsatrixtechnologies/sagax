import { describe, expect, it } from "vitest";

import { accountPickChipLine, accountPickLine } from "./account-pick";
import type { AccountPick } from "../../shared/account-switch";

const NOW = Date.UTC(2026, 10, 19, 15, 0);
const pick: AccountPick = { instanceId: "claude-work", account: "Account B", why: { kind: "expiring", resetsAt: NOW + 40 * 60_000, unused: 60 }, strategy: "high-water", at: NOW };

describe("the account pick on the model chip (#5014)", () => {
  it("says the account taken and why, in one line", () => {
    expect(accountPickLine(pick, NOW)).toBe("Account B: its window resets in 40 min with 60% unused");
  });

  it("says it only while the pick names the account in use, never for Auto or a forced account", () => {
    expect(accountPickChipLine(pick, { instanceId: "claude-work" }, NOW)).toBe("Account B: its window resets in 40 min with 60% unused");
    expect(accountPickChipLine(pick, { instanceId: "claude" }, NOW)).toBe("");
    expect(accountPickChipLine(pick, { instanceId: "claude-work", auto: true }, NOW)).toBe("");
    expect(accountPickChipLine(pick, { instanceId: "claude-work", accountPinned: true }, NOW)).toBe("");
    expect(accountPickChipLine(undefined, { instanceId: "claude-work" }, NOW)).toBe("");
  });
});
