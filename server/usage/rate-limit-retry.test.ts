import { describe, expect, it } from "vitest";

import { MAX_RATE_WAIT_MS, parseRetryAfter, rateLimitGaveUpText, rateLimitRetryText, rateLimitWait, sleepUnlessAborted } from "./rate-limit-retry.ts";

describe("a connector that answers 429", () => {
  it("reads Retry-After as seconds or as a date", () => {
    expect(parseRetryAfter("7")).toBe(7000);
    expect(parseRetryAfter("Wed, 21 Oct 2026 07:28:10 GMT", Date.parse("Wed, 21 Oct 2026 07:28:00 GMT"))).toBe(10_000);
    expect(parseRetryAfter("soon")).toBeUndefined();
    expect(parseRetryAfter(null)).toBeUndefined();
  });

  it("waits the server's time, twice at most, never past the cap", () => {
    expect(rateLimitWait(3000, 0)).toBe(3000);
    expect(rateLimitWait(undefined, 0)).toBe(5000);
    expect(rateLimitWait(undefined, 1)).toBe(10_000);
    expect(rateLimitWait(0, 0)).toBe(1000);
    expect(rateLimitWait(MAX_RATE_WAIT_MS + 1, 0)).toBeNull();
    expect(rateLimitWait(3000, 2)).toBeNull();
  });

  it("says the countdown, then that nothing was sent", () => {
    expect(rateLimitRetryText("Slack", 4200)).toBe("Slack is limiting requests: trying again in 5 s.");
    expect(rateLimitGaveUpText("Slack")).toContain("nothing was sent");
    expect(rateLimitGaveUpText("Slack", 600_000)).toContain("10 min");
  });

  it("stops waiting when the call is cancelled", async () => {
    const controller = new AbortController();
    const waiting = sleepUnlessAborted(60_000, controller.signal);
    controller.abort();
    expect(await waiting).toBe(false);
    expect(await sleepUnlessAborted(1, new AbortController().signal)).toBe(true);
  });
});
