import { afterEach, describe, expect, it } from "vitest";
import { openSafetyHold, resetSafetyReviewForTests, safetyHoldOpen } from "../safety/safety-review.ts";
import { createLimitTakeovers } from "../usage/limit-takeovers.ts";
import { handleTurnCompleted } from "./turn-completed.ts";

/** A host whose every member is a callable no-op returning undefined. */
function stubHost(): any {
  const noop: any = new Proxy(function () {}, {
    get: (_t, prop) => (prop === "then" || prop === Symbol.iterator ? undefined : noop),
    apply: () => undefined,
  });
  return noop;
}

afterEach(() => resetSafetyReviewForTests());

describe("handleTurnCompleted safety holds in a room", () => {
  it("keeps the hold of bot B when bot A ends its turn in the same room thread", () => {
    const threadId = "room-thread";
    const a = openSafetyHold(60_000, { threadId, botId: "bot-a" });
    const b = openSafetyHold(60_000, { threadId, botId: "bot-b" });
    a.answer.catch(() => {});
    b.answer.catch(() => {});
    // In a room the turn has no direct bot, only a speaker.
    const ctx = { bot: undefined, group: { id: "g" }, speaker: { botId: "bot-a" }, pushMessage: () => {}, completedTurnId: "t1" };
    try {
      handleTurnCompleted({ type: "turn.completed", threadId, turnId: "t1", ok: true }, ctx, stubHost());
    } catch {
      // later steps of the handler are not under test
    }
    expect(safetyHoldOpen(a.requestId)).toBe(false);
    expect(safetyHoldOpen(b.requestId)).toBe(true);
  });
});

// #4878: a waiter on the thread (a run_with_engine part) learns that the
// usage-limit failover took the failed turn over, before it reads the failure.
describe("handleTurnCompleted and the usage-limit failover", () => {
  it("notes a turn the failover took over for the caller waiting on its thread", () => {
    const takeovers = createLimitTakeovers();
    const noop: any = new Proxy(function () {}, {
      get: (_t, prop) => (prop === "then" || prop === Symbol.iterator ? undefined : noop),
      apply: () => undefined,
    });
    const overrides: Record<string, unknown> = {
      limitTakeovers: takeovers,
      limitKindOf: () => "quota",
      limitFailover: new Proxy({}, { get: (_t, prop) => (prop === "turnFailed" ? () => true : noop) }),
    };
    const host = new Proxy({}, { get: (_t, prop) => (typeof prop === "string" && prop in overrides ? overrides[prop] : noop) });
    const ctx = { bot: { id: "bot-1", modelSelection: { instanceId: "claude-1", model: "opus" } }, speaker: undefined, pushMessage: () => {}, completedTurnId: "turn-1" };
    try {
      handleTurnCompleted({ type: "turn.completed", threadId: "t-part", turnId: "turn-1", ok: false, stopReason: "quota" }, ctx, host);
    } catch {
      // later steps of the handler are not under test
    }
    expect(takeovers.take("t-part", "turn-1")).toBe(true);
    expect(takeovers.take("t-part", "turn-1")).toBe(false);
  });
});
