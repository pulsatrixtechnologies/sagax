import { describe, expect, it } from "vitest";
import {
  claudeContextFull,
  claudeLimitRefusal,
  claudeUsageLimit,
  parseClaudeCliVersion,
} from "../claude.ts";

// withVolatileNote / volatileTurnMessage are not exported yet; characterization
// for those lands with the messages extract (claude/messages.ts).

describe("claudeContextFull", () => {
  it("treats autocompact_thrashing as context full", () => {
    expect(claudeContextFull({ api_error: "autocompact_thrashing" }, "")).toBe(true);
  });

  it("treats terminal_reason rapid_refill_breaker as context full", () => {
    expect(claudeContextFull({ terminal_reason: "rapid_refill_breaker" }, "")).toBe(true);
  });

  it("treats an api-error frame whose text looks context-full as full", () => {
    // phrase that isContextFullText accepts (server/context-renewal.ts)
    const text =
      "Autocompact is thrashing: the context refilled to the limit within 3 turns of the previous compact, 3 times in a row.";
    expect(claudeContextFull({ is_api_error_message: true }, text)).toBe(true);
  });

  it("returns false when is_api_error_message is false and error is not a string", () => {
    expect(claudeContextFull({ is_api_error_message: false, error: 400 }, "prompt is too long")).toBe(false);
    expect(claudeContextFull({}, "prompt is too long")).toBe(false);
  });

  it("treats a string error plus context-full text as full", () => {
    expect(
      claudeContextFull(
        { error: "invalid_request" },
        'API Error: 400 {"type":"error","error":{"type":"invalid_request_error","message":"prompt is too long: 215000 tokens > 200000 maximum"}}',
      ),
    ).toBe(true);
  });

  it("returns false for non-context-full text even on an api-error frame", () => {
    expect(
      claudeContextFull({ is_api_error_message: true }, "The context of this ticket is long, so here is a summary."),
    ).toBe(false);
  });
});

describe("claudeLimitRefusal (quick)", () => {
  it("reads a rejected weekly window and ignores a non-refusal", () => {
    expect(
      claudeLimitRefusal({
        status: "rejected",
        resetsAt: 1791795600,
        rateLimitType: "seven_day",
        isUsingOverage: false,
      }),
    ).toEqual({ window: "seven_day", resetsAt: 1791795600 });
    expect(claudeLimitRefusal({ status: "allowed_warning", rateLimitType: "seven_day" })).toBeNull();
  });
});

describe("claudeUsageLimit (quick)", () => {
  it("gates on the api-error flag and the usage_limit_reached code", () => {
    expect(claudeUsageLimit({ error: "rate_limit", is_api_error_message: true, api_error: "usage_limit_reached" }, "")).toBe(true);
    expect(claudeUsageLimit({}, "You've hit your weekly limit · resets Oct 12")).toBe(false);
  });
});

describe("parseClaudeCliVersion (quick)", () => {
  it("parses a CLI banner line and rejects empty input", () => {
    expect(parseClaudeCliVersion("2.1.232 (Claude Code)")).toEqual([2, 1, 232]);
    expect(parseClaudeCliVersion("")).toBeNull();
  });
});
