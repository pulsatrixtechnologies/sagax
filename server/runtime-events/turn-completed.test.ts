import { afterEach, describe, expect, it } from "vitest";
import { openSafetyHold, resetSafetyReviewForTests, safetyHoldOpen } from "../safety/safety-review.ts";
import { limitKindOf } from "../usage/limit-reset-time.ts";
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

describe("handleTurnCompleted learned routing", () => {
  function hostWith(record: (facts: Record<string, unknown>) => void, extra: Record<string, unknown> = {}) {
    const noop: any = new Proxy(function () {}, {
      get: (_t, prop) => (prop === "then" || prop === Symbol.iterator ? undefined : noop),
      apply: () => undefined,
    });
    const store = {
      messagesFor: () => [],
      markTerminalAssistantMessage: () => undefined,
      patchMessage: () => undefined,
      activePath: () => [],
      suggestTaskLink: () => undefined,
      taskByThread: () => undefined,
      addTaskUsage: () => undefined,
      patchTask: () => undefined,
      bot: () => undefined,
    };
    const overrides: Record<string, unknown> = {
      store,
      recordLearnedTurn: record,
      bookTurnUsage: () => undefined,
      limitKindOf,
      turnDuration: () => ({ durationMs: 1_200 }),
      turnCounters: () => ({ queueMs: 10, firstResponseMs: 180 }),
      billsEachUse: () => false,
      limitFailoverConfig: () => undefined,
      ...extra,
    };
    return new Proxy({}, { get: (_t, prop) => (typeof prop === "string" && prop in overrides ? overrides[prop] : noop) });
  }

  const bot = { id: "bot-1", name: "Ada", modelSelection: { instanceId: "claude-1", model: "fast" } };

  it("records a settled turn on the model the person chose", () => {
    const recorded: Record<string, unknown>[] = [];
    const host = hostWith((facts) => { recorded.push(facts); });
    const ctx = { bot, speaker: undefined, pushMessage: () => {}, completedTurnId: "turn-1" };
    let failed: unknown;
    try {
      handleTurnCompleted({
        type: "turn.completed", threadId: "t-learn", turnId: "turn-1", ok: true,
        usage: { input: 40, output: 80 },
        models: [{ model: "slow", inputTokens: 1, outputTokens: 1, costUsd: null }],
      }, ctx, host);
    } catch (error) {
      failed = error;
    }
    expect(recorded, failed instanceof Error ? failed.message : "the turn did not call record").toEqual([
      expect.objectContaining({
        threadId: "t-learn",
        instanceId: "claude-1",
        model: "fast",
        promptTokens: 40,
        outputTokens: 80,
        durationMs: 1_200,
        ttftMs: 180,
        ok: true,
        stopped: false,
      }),
    ]);
    expect(recorded[0]).not.toMatchObject({ model: "slow" });
  });

  it("records a rate-limited turn as limited, still on the person's model", () => {
    const recorded: Record<string, unknown>[] = [];
    const host = hostWith((facts) => { recorded.push(facts); });
    const ctx = { bot, speaker: undefined, pushMessage: () => {}, completedTurnId: "turn-2" };
    try {
      handleTurnCompleted({
        type: "turn.completed", threadId: "t-limit", turnId: "turn-2", ok: false, stopReason: "rate_limit",
      }, ctx, host);
    } catch {
      // later steps of the handler are not under test
    }
    expect(recorded[0]).toMatchObject({ instanceId: "claude-1", model: "fast", ok: false, limited: "rate_limited", stopped: false });
  });
});
