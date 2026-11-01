import { describe, expect, it } from "vitest";
import {
  CLAUDE_NEEDS_RECONNECTING,
  CLAUDE_RECONNECT_AHEAD_DETAIL,
  CLAUDE_RECONNECT_AHEAD_MS,
  claudeReconnectAhead,
} from "./claude-reconnect-ahead.ts";
import { CLAUDE_SIGN_IN_EXPIRED } from "./drivers/claude-errors.ts";

const NOW = new Date(2026, 10, 17, 6, 0, 0).getTime();
const HOUR = 3_600_000;

describe("claudeReconnectAhead", () => {
  it("notifies once per person when Claude is already expired ahead of due Claude routines", () => {
    const result = claudeReconnectAhead({
      now: NOW,
      routines: [
        { id: "r1", name: "Morning brief", botId: "claude-bot", enabled: true, nextRunAt: NOW + 2 * HOUR },
        { id: "r2", name: "Inbox", botId: "claude-bot", enabled: true, nextRunAt: NOW + 3 * HOUR },
        { id: "r3", name: "Grok digest", botId: "grok-bot", enabled: true, nextRunAt: NOW + HOUR },
        { id: "r4", name: "Far away", botId: "claude-bot", enabled: true, nextRunAt: NOW + CLAUDE_RECONNECT_AHEAD_MS + HOUR },
        { id: "r5", name: "Paused", botId: "claude-bot", enabled: false, nextRunAt: NOW + HOUR },
      ],
      botUsesClaude: (botId) => botId === "claude-bot",
      botPayer: () => "pr_alice",
      claudeExpired: (person) => person === "pr_alice",
    });
    expect(result.pauseBotIds).toEqual(new Set(["claude-bot"]));
    expect(result.notify).toEqual([{
      principalId: "pr_alice",
      routineNames: ["Morning brief", "Inbox"],
    }]);
    expect(CLAUDE_RECONNECT_AHEAD_DETAIL).toContain(CLAUDE_SIGN_IN_EXPIRED);
    expect(CLAUDE_NEEDS_RECONNECTING).toBe("Claude needs reconnecting");
  });

  it("skips people already notified for this expired spell", () => {
    const result = claudeReconnectAhead({
      now: NOW,
      routines: [{ id: "r1", name: "Morning brief", botId: "claude-bot", enabled: true, nextRunAt: NOW + HOUR }],
      botUsesClaude: () => true,
      botPayer: () => "pr_alice",
      claudeExpired: () => true,
      alreadyNotified: new Set(["pr_alice"]),
    });
    expect(result.pauseBotIds).toEqual(new Set(["claude-bot"]));
    expect(result.notify).toEqual([]);
  });

  it("ignores bots whose Claude is not expired and non-Claude engines", () => {
    const result = claudeReconnectAhead({
      now: NOW,
      routines: [
        { id: "r1", name: "Morning", botId: "claude-ok", enabled: true, nextRunAt: NOW + HOUR },
        { id: "r2", name: "Other", botId: "codex-bot", enabled: true, nextRunAt: NOW + HOUR },
      ],
      botUsesClaude: (botId) => botId === "claude-ok",
      botPayer: (botId) => (botId === "claude-ok" ? "pr_alice" : "pr_bob"),
      claudeExpired: () => false,
    });
    expect(result.pauseBotIds.size).toBe(0);
    expect(result.notify).toEqual([]);
  });
});
