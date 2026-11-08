import { describe, expect, it } from "vitest";
import {
  CLAUDE_NEEDS_RECONNECTING,
  CLAUDE_RECONNECT_AHEAD_DETAIL,
  CLAUDE_SIGN_IN_EXPIRED,
  ENGINE_RECONNECT_AHEAD_MS,
  engineNeedsReconnecting,
  engineReconnectAhead,
  engineReconnectAheadDetail,
  engineNameFromReconnectFailure,
  isEngineReconnectAttention,
  isEngineReconnectCondition,
} from "./engine-reconnect-ahead.ts";
import { CODEX_SIGN_IN_EXPIRED, codexSignInExpired } from "../drivers/codex-errors.ts";
import { claudeSignInExpired } from "../drivers/claude-errors.ts";

const NOW = new Date(2026, 10, 17, 6, 0, 0).getTime();
const HOUR = 3_600_000;

describe("engineReconnectAhead", () => {
  it("notifies once per person and engine when a login engine is already expired ahead of due routines", () => {
    const result = engineReconnectAhead({
      now: NOW,
      routines: [
        { id: "r1", name: "Morning brief", botId: "claude-bot", enabled: true, nextRunAt: NOW + 2 * HOUR },
        { id: "r2", name: "Inbox", botId: "claude-bot", enabled: true, nextRunAt: NOW + 3 * HOUR },
        { id: "r3", name: "Codex digest", botId: "codex-bot", enabled: true, nextRunAt: NOW + HOUR },
        { id: "r4", name: "Far away", botId: "claude-bot", enabled: true, nextRunAt: NOW + ENGINE_RECONNECT_AHEAD_MS + HOUR },
        { id: "r5", name: "Paused", botId: "claude-bot", enabled: false, nextRunAt: NOW + HOUR },
        { id: "r6", name: "Grok ok", botId: "bot-grok", enabled: true, nextRunAt: NOW + HOUR },
      ],
      botDriver: (botId) => {
        if (botId === "claude-bot") return "claudeAgent";
        if (botId === "codex-bot") return "codex";
        if (botId === "bot-grok") return "grokAgent";
        return null;
      },
      botPayer: () => "pr_alice",
      expired: (_person, driver) => driver === "claudeAgent" || driver === "codex",
    });
    expect(result.pauseBotIds).toEqual(new Set(["claude-bot", "codex-bot"]));
    expect(result.pauseEngineByBot.get("claude-bot")).toBe("Claude");
    expect(result.pauseEngineByBot.get("codex-bot")).toBe("Codex");
    expect(result.notify).toEqual(expect.arrayContaining([
      expect.objectContaining({
        principalId: "pr_alice",
        engineName: "Claude",
        routineNames: ["Morning brief", "Inbox"],
      }),
      expect.objectContaining({
        principalId: "pr_alice",
        engineName: "Codex",
        routineNames: ["Codex digest"],
      }),
    ]));
    expect(result.notify).toHaveLength(2);
    expect(CLAUDE_RECONNECT_AHEAD_DETAIL).toContain(CLAUDE_SIGN_IN_EXPIRED);
    expect(engineReconnectAheadDetail("Codex")).toContain(CODEX_SIGN_IN_EXPIRED);
    expect(CLAUDE_NEEDS_RECONNECTING).toBe("Claude needs reconnecting");
    expect(engineNeedsReconnecting("Codex")).toBe("Codex needs reconnecting");
  });

  it("skips people already notified for this expired spell of that engine", () => {
    const result = engineReconnectAhead({
      now: NOW,
      routines: [
        { id: "r1", name: "Morning brief", botId: "claude-bot", enabled: true, nextRunAt: NOW + HOUR },
        { id: "r2", name: "Codex dig", botId: "codex-bot", enabled: true, nextRunAt: NOW + HOUR },
      ],
      botDriver: (botId) => (botId === "claude-bot" ? "claudeAgent" : "codex"),
      botPayer: () => "pr_alice",
      expired: () => true,
      alreadyNotified: new Set(["pr_alice\0Claude"]),
    });
    expect(result.pauseBotIds).toEqual(new Set(["claude-bot", "codex-bot"]));
    expect(result.notify).toEqual([expect.objectContaining({ engineName: "Codex" })]);
  });

  it("ignores bots whose engine is not expired and non-login engines", () => {
    const result = engineReconnectAhead({
      now: NOW,
      routines: [
        { id: "r1", name: "Morning", botId: "claude-ok", enabled: true, nextRunAt: NOW + HOUR },
        { id: "r2", name: "API", botId: "api-bot", enabled: true, nextRunAt: NOW + HOUR },
      ],
      botDriver: (botId) => (botId === "claude-ok" ? "claudeAgent" : null),
      botPayer: () => "pr_alice",
      expired: () => false,
    });
    expect(result.pauseBotIds.size).toBe(0);
    expect(result.notify).toEqual([]);
  });
});

describe("isEngineReconnectCondition", () => {
  it("covers Claude, Codex, Grok and the generic signed-out owner line", () => {
    expect(isEngineReconnectCondition(claudeSignInExpired("OAuth session expired"))).toBe(true);
    expect(isEngineReconnectCondition(codexSignInExpired("workspace routing discovery unauthorized"))).toBe(true);
    expect(isEngineReconnectCondition("Grok refused this turn: the Grok sign-in or xAI key it runs on was rejected. Reconnect Grok in Settings → Model providers and accounts.")).toBe(true);
    expect(isEngineReconnectCondition("This bot's engine is signed out. Sign in again in Settings → Model providers.")).toBe(true);
    expect(isEngineReconnectCondition(engineNeedsReconnecting("Codex"))).toBe(true);
    expect(isEngineReconnectAttention("Grok needs reconnecting")).toBe(true);
    expect(isEngineReconnectCondition("401 Unauthorized from the CRM")).toBe(false);
    expect(engineNameFromReconnectFailure(codexSignInExpired("x"))).toBe("Codex");
    expect(engineNameFromReconnectFailure("Reconnect Grok now")).toBe("Grok");
  });
});

// #2384: two bots of one person on two accounts of one provider: only the
// bot whose own account is expired waits.
describe("engineReconnectAhead per account (#2384)", () => {
  it("asks about the routine's own bot, so the other account's bot runs", () => {
    const asked: Array<string | undefined> = [];
    const result = engineReconnectAhead({
      now: NOW,
      routines: [
        { id: "r1", name: "On A", botId: "bot-a", enabled: true, nextRunAt: NOW + HOUR },
        { id: "r2", name: "On B", botId: "bot-b", enabled: true, nextRunAt: NOW + HOUR },
      ],
      botDriver: () => "claudeAgent",
      botPayer: () => "pr_alice",
      expired: (_person, _driver, botId) => { asked.push(botId); return botId === "bot-b"; },
    });
    expect(asked).toEqual(["bot-a", "bot-b"]);
    expect(result.pauseBotIds).toEqual(new Set(["bot-b"]));
    expect(result.notify).toEqual([expect.objectContaining({ routineNames: ["On B"] })]);
  });
});
