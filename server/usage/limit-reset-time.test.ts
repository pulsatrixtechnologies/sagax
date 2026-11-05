import { describe, expect, it } from "vitest";

import { limitKindOf, limitResetFromText, limitResetOrEstimate, UNKNOWN_QUOTA_RESET_MS, UNKNOWN_RATE_RESET_MS } from "./limit-reset-time.ts";

const NOW = Date.UTC(2026, 9, 19, 16, 0, 0);

describe("limitKindOf", () => {
  it("reads every engine's words for a spent limit or balance as quota", () => {
    for (const words of [
      "You've hit your weekly limit · resets Oct 12 at 2:30pm (Asia/Calcutta)",
      "You've hit your usage limit. Upgrade to Pro or try again at 5:23 PM.",
      "Grok refused this turn: the usage balance of the Grok account it runs on is used up (xAI answered 402 Payment Required).",
      "You exceeded your current quota, please check your plan and billing details.",
      "RESOURCE_EXHAUSTED: Quota exceeded for quota metric 'Generate Content API requests per day'",
      "Your credit balance is too low to access the Anthropic API.",
      "insufficient_funds: no credits left on this OpenRouter key",
      "You're out of usage credits",
    ]) expect(limitKindOf(words), words).toBe("quota");
  });

  it("reads the driver's stop token when the words say nothing", () => {
    expect(limitKindOf("This Claude account has reached its weekly limit, which resets Oct 19, 2:05 PM (America/Toronto).", "quota")).toBe("quota");
    expect(limitKindOf(undefined, "insufficient_funds")).toBe("quota");
  });

  it("reads a 429 the driver gave up on as a rate limit", () => {
    expect(limitKindOf("upstream HTTP 429: Too Many Requests")).toBe("rate_limited");
  });

  it("never reads a sign-in, a refused key, a bad request or a stop as a limit", () => {
    expect(limitKindOf("401 Unauthorized: invalid api key")).toBeNull();
    expect(limitKindOf("Not logged in · Please run /login")).toBeNull();
    expect(limitKindOf("400 invalid request: messages.0.content is empty")).toBeNull();
    expect(limitKindOf("interrupted")).toBeNull();
    expect(limitKindOf("the run ended without a result")).toBeNull();
  });

  // #1758: codexUserError's plan sentence for provider_not_configured.
  it("never reads a Codex configuration refusal as a usage limit", () => {
    const phrase =
      "provider_not_configured: ChatGPT has not enabled this model for the selected account. Refresh models or reconnect ChatGPT plan in Settings. API billing will not be used.";
    expect(limitKindOf(phrase)).toBeNull();
    expect(limitKindOf(phrase, "quota")).toBeNull();
    expect(limitKindOf("The model gpt-5.2-codex requires a Pro subscription")).toBeNull();
    expect(limitKindOf("billing")).toBeNull();
    expect(limitKindOf("subscription")).toBeNull();
  });
});

describe("limitResetFromText", () => {
  it("reads Retry-After in seconds and in milliseconds", () => {
    expect(limitResetFromText("429 Too Many Requests; Retry-After: 120", NOW)).toBe(NOW + 120_000);
    expect(limitResetFromText("retry after 30 seconds", NOW)).toBe(NOW + 30_000);
    expect(limitResetFromText("retry-after-ms: 1500", NOW)).toBe(NOW + 1_500);
  });

  it("reads a relative reset", () => {
    expect(limitResetFromText("Rate limit reached. Please try again in 2h 15m.", NOW)).toBe(NOW + 2 * 3_600_000 + 15 * 60_000);
    expect(limitResetFromText("Your limit resets in 47 minutes", NOW)).toBe(NOW + 47 * 60_000);
    expect(limitResetFromText("available again in 1 hour and 5 minutes", NOW)).toBe(NOW + 65 * 60_000);
  });

  it("reads an ISO time or an epoch after a reset key", () => {
    expect(limitResetFromText("quota exhausted, resets at 2026-10-19T18:05:00Z", NOW)).toBe(Date.UTC(2026, 9, 19, 18, 5));
    const epoch = Date.UTC(2026, 9, 19, 18, 5) / 1_000;
    expect(limitResetFromText(`{"error":"usage_limit","reset_at": ${epoch}}`, NOW)).toBe(epoch * 1_000);
    expect(limitResetFromText(`x-ratelimit-reset: ${epoch * 1_000}`, NOW)).toBe(epoch * 1_000);
  });

  it("reads Codex's local clock time, the next one to come", () => {
    const at = limitResetFromText("You've hit your usage limit. Try again at 5:23 PM.", NOW)!;
    const expected = new Date(NOW);
    expected.setHours(17, 23, 0, 0);
    if (expected.getTime() <= NOW) expected.setDate(expected.getDate() + 1);
    expect(at).toBe(expected.getTime());
  });

  it("refuses a past time, an implausibly far one, and words without a time", () => {
    expect(limitResetFromText("resets at 2026-10-18T10:00:00Z", NOW)).toBeUndefined();
    expect(limitResetFromText("resets at 2027-01-01T00:00:00Z", NOW)).toBeUndefined();
    expect(limitResetFromText("You've hit your weekly limit", NOW)).toBeUndefined();
    expect(limitResetFromText(undefined, NOW)).toBeUndefined();
  });
});

describe("limitResetOrEstimate", () => {
  it("keeps the engine's own time", () => {
    expect(limitResetOrEstimate("quota", NOW + 5_000, NOW)).toEqual({ resetsAt: NOW + 5_000, estimated: false });
  });

  it("estimates prudently without one: an hour for a spent limit, a quarter for a 429", () => {
    expect(limitResetOrEstimate("quota", undefined, NOW)).toEqual({ resetsAt: NOW + UNKNOWN_QUOTA_RESET_MS, estimated: true });
    expect(limitResetOrEstimate("rate_limited", NOW - 1, NOW)).toEqual({ resetsAt: NOW + UNKNOWN_RATE_RESET_MS, estimated: true });
  });
});

describe("limitKindOf on a local model", () => {
  it("is never a limit from a status, a stop token or a loose word", () => {
    for (const cause of ["402 Payment Required", "429 Too Many Requests", "subscription", "quota", "503 Service Unavailable", "Connection error."]) {
      expect(limitKindOf(cause, "quota", { local: true })).toBeNull();
      expect(limitKindOf(cause, "rate_limit", { local: true })).toBeNull();
    }
  });

  it("is a quota only when the server says so plainly", () => {
    expect(limitKindOf("insufficient_quota: You exceeded your current quota", null, { local: true })).toBe("quota");
    expect(limitKindOf("Quota exceeded for this key", null, { local: true })).toBe("quota");
    expect(limitKindOf("401 invalid api key, quota exceeded", null, { local: true })).toBeNull();
  });

  it("leaves hosted engines as they were", () => {
    expect(limitKindOf("402 Payment Required")).toBe("quota");
    expect(limitKindOf("429 Too Many Requests")).toBe("rate_limited");
  });
});
