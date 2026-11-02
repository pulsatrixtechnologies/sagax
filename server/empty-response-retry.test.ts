import { describe, expect, it } from "vitest";

import { createEmptyResponseRetry, shouldEmptyResponseRetry } from "./empty-response-retry.ts";

describe("createEmptyResponseRetry", () => {
  it("allows one take per thread, then blocks until clear", () => {
    const retry = createEmptyResponseRetry();
    expect(retry.take("t1")).toBe(true);
    expect(retry.has("t1")).toBe(true);
    expect(retry.take("t1")).toBe(false);
    expect(retry.take("t2")).toBe(true);
    retry.clear("t1");
    expect(retry.has("t1")).toBe(false);
    expect(retry.take("t1")).toBe(true);
  });
});

describe("shouldEmptyResponseRetry", () => {
  it("retries only empty chat failures that are not already handled", () => {
    const take = () => true;
    expect(shouldEmptyResponseRetry({
      ok: false, stopped: false, limitTaken: false, isRoutine: false, empty: true, take,
    })).toBe(true);
    expect(shouldEmptyResponseRetry({
      ok: true, stopped: false, limitTaken: false, isRoutine: false, empty: true, take,
    })).toBe(false);
    expect(shouldEmptyResponseRetry({
      ok: false, stopped: true, limitTaken: false, isRoutine: false, empty: true, take,
    })).toBe(false);
    expect(shouldEmptyResponseRetry({
      ok: false, stopped: false, limitTaken: true, isRoutine: false, empty: true, take,
    })).toBe(false);
    expect(shouldEmptyResponseRetry({
      ok: false, stopped: false, limitTaken: false, isRoutine: true, empty: true, take,
    })).toBe(false);
    expect(shouldEmptyResponseRetry({
      ok: false, stopped: false, limitTaken: false, isRoutine: false, empty: false, take,
    })).toBe(false);
    expect(shouldEmptyResponseRetry({
      ok: false, stopped: false, limitTaken: false, alreadyReported: true, isRoutine: false, empty: true, take,
    })).toBe(false);
  });

  // R5 scorecard: 5 reasoning_only routine-shaped failures + chat empties.
  // Before: all became incidents / final failures. After: chat empties retry
  // once; a second empty on the same thread does not loop.
  it("avoids a loop on N synthetic empty cases (R5 before/after)", () => {
    const retry = createEmptyResponseRetry();
    const N = 5;
    let retried = 0;
    let blocked = 0;
    let incidents = 0;
    for (let i = 0; i < N; i++) {
      const threadId = `chat-${i}`;
      // First empty: harness retries.
      if (shouldEmptyResponseRetry({
        ok: false, stopped: false, limitTaken: false, isRoutine: false, empty: true,
        take: () => retry.take(threadId),
      })) retried += 1;
      else incidents += 1;
      // Second empty on same thread: no loop, falls through to incident.
      if (shouldEmptyResponseRetry({
        ok: false, stopped: false, limitTaken: false, isRoutine: false, empty: true,
        take: () => retry.take(threadId),
      })) retried += 1;
      else {
        blocked += 1;
        incidents += 1;
      }
    }
    // Before R5: retried=0, incidents=2N. After: one retry per thread, then incident.
    expect({ retried, blocked, incidents, N }).toEqual({ retried: N, blocked: N, incidents: N, N });
  });
});
