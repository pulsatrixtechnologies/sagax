// #4200 point 4: at Full access no approval card, whatever starts the turn.
// The level a turn runs at is the bot's; only the organization's policy, a
// guest's turn (isolation between people) and the engine move it. The
// organization's own Refuse / Ask first rules still hold under Full access.
import { describe, expect, it } from "vitest";

import { fullAccessActs, fullAccessDecision } from "./full-access-gate.ts";
import { turnApprovalLevel, type TurnLevelFacts } from "./turn-level.ts";

const full: TurnLevelFacts = {
  level: "full", orgDeniesFull: false, memberOwned: false, memberLevelAllowed: true,
  guest: false, mail: false, peerInitiated: false, engineRuns: () => true,
};

// What each way a turn starts brings to the judgment.
const SOURCES: Array<[string, Partial<TurnLevelFacts>]> = [
  ["the person in the chat", {}],
  ["a routine", {}],
  ["a routine woken by an email", { mail: true }],
  ["a text message", {}],
  ["a phone call", {}],
  ["the organization link (an AI client)", {}],
  ["another bot's hand-off", { peerInitiated: true }],
  ["a member's own bot on an organization server", { memberOwned: true }],
];

describe("turn level at Full access (#4200)", () => {
  it.each(SOURCES)("runs %s at Full access, with no card", (_source, facts) => {
    const level = turnApprovalLevel({ ...full, ...facts });
    expect(level).toBe("full");
    expect(fullAccessActs(level)).toBe(true);
  });

  it("keeps the organization's Refuse and Ask first rules", () => {
    expect(fullAccessDecision("full", { orgRule: "ask" })).toMatchObject({ acts: false, hold: "org-rule" });
    expect(fullAccessDecision("full", { orgRule: "deny" })).toMatchObject({ acts: false, hold: "org-rule" });
  });

  it("moves only for the organization's policy, a guest's turn or the engine", () => {
    expect(turnApprovalLevel({ ...full, orgDeniesFull: true })).toBe("ask");
    expect(turnApprovalLevel({ ...full, guest: true })).toBe("ask");
    expect(turnApprovalLevel({ ...full, engineRuns: () => false })).toBe("ask");
    // below Full access, a routine an email woke still runs at Ask
    expect(turnApprovalLevel({ ...full, level: "auto", mail: true })).toBe("ask");
  });
});
