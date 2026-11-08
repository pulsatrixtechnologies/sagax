import { afterEach, describe, expect, it } from "vitest";
import { openSafetyHold, resetSafetyReviewForTests, safetyHoldOpen } from "../safety/safety-review.ts";
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
