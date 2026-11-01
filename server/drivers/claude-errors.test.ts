import { describe, expect, it } from "vitest";

import {
  CLAUDE_NEEDS_RECONNECTING,
  CLAUDE_SIGN_IN_EXPIRED,
  claudeCreditsExhausted,
  claudeSignInExpired,
  isClaudeReconnectCondition,
} from "./claude-errors.ts";

describe("Claude reconnect typed errors", () => {
  it("rewrites a signed-out CLI line into the canonical reconnect sentence", () => {
    const raw = "Not logged in · Please run /login";
    expect(claudeSignInExpired(raw)).toBe(`${CLAUDE_SIGN_IN_EXPIRED} Claude said: ${raw}`);
    expect(CLAUDE_SIGN_IN_EXPIRED).toContain("Reconnect Claude");
    expect(CLAUDE_NEEDS_RECONNECTING).toBe("Claude needs reconnecting");
  });

  it("detects exhausted extra-usage credits as a reconnect condition", () => {
    const credits = "Claude refused this turn because this model runs on extra usage for your account, and those credits are used up. " +
      "Your plan's own usage is not affected: switch this bot to a model your plan includes, or add extra usage in your Claude account.";
    expect(claudeCreditsExhausted(credits)).toBe(true);
    expect(isClaudeReconnectCondition(credits)).toBe(true);
    expect(isClaudeReconnectCondition(claudeSignInExpired("OAuth session expired"))).toBe(true);
    expect(isClaudeReconnectCondition("401 Unauthorized from the CRM")).toBe(false);
    expect(isClaudeReconnectCondition("This Claude account has reached its weekly limit")).toBe(false);
  });
});
