// JC 2026-11-01: "the bots talk to each other, they do not answer me, I
// have to relaunch them". A teammate's reply comes back to the conversation
// that waits for it unless the person stopped that conversation.
import { describe, expect, it } from "vitest";

import { atThreadCapacity, interruptKeepsTeammates, type DirectInterruptCause } from "./teammate-replies.ts";

describe("interruptKeepsTeammates", () => {
  it("only the person's Stop drops the teammates' replies; a cut to read their words, a park or an engine change keeps them", () => {
    const keeps: DirectInterruptCause[] = ["safe-point", "computer-park", "engine-change"];
    for (const cause of keeps) expect(interruptKeepsTeammates(cause), cause).toBe(true);
    expect(interruptKeepsTeammates("stop")).toBe(false);
  });
});

describe("atThreadCapacity", () => {
  it("the person's main conversation is never at capacity, so a teammate's reply resumes it as a message the person writes there would", () => {
    const full = { busyThreads: 2, max: 2, mainThreadId: "main" };
    expect(atThreadCapacity({ ...full, threadId: "main" })).toBe(false);
    expect(atThreadCapacity({ ...full, threadId: "side" })).toBe(true);
    // Without a thread (a slot for any new work), the count decides.
    expect(atThreadCapacity(full)).toBe(true);
    expect(atThreadCapacity({ ...full, busyThreads: 1 })).toBe(false);
  });
});
