import { describe, expect, it, vi } from "vitest";
import type { RuntimeEvent } from "../shared/runtime-events.ts";
import {
  DEFAULT_LOOP_THRESHOLDS, LoopDetector, POLL_CYCLE_BUDGET, POLL_REPEAT_BUDGET, TRANSIENT_RETRY_BUDGET,
  canonicalJson, digest, dispatchLoopStop, loopDetectorConfigSchema, loopStopRoute, loopThresholds, makeLoopStopSubscriber,
  toolCallIdentity, type LoopDetectorConfig, type ToolCallObservation,
} from "./loop-detector.ts";

const detector = (config?: LoopDetectorConfig) => new LoopDetector(loopThresholds(config)!);
const feed = (d: LoopDetector, calls: ToolCallObservation[]) => calls.map((call) => d.observe(call));

describe("LoopDetector", () => {
  it("trips on the same call at the threshold, not before", () => {
    const d = detector();
    const calls = Array.from({ length: DEFAULT_LOOP_THRESHOLDS.identicalCall },
      (_, i) => ({ tool: "Bash", input: { command: "make" }, result: `run ${i}` }));
    const verdicts = feed(d, calls);
    expect(verdicts.slice(0, -1).every((v) => v === null)).toBe(true);
    expect(verdicts.at(-1)).toMatchObject({ stuck: true, kind: "identical-call", count: 5 });
    expect(verdicts.at(-1)!.reason).toBe("the same Bash call with the same input ran 5 times in a row");
  });

  it("does not trip when inputs vary", () => {
    const d = detector();
    const verdicts = feed(d, Array.from({ length: 30 }, (_, i) => ({ tool: "Read", input: { path: `f${i}` }, result: "same" })));
    expect(verdicts.every((v) => v === null)).toBe(true);
  });

  it("normalises strings inside nested objects and arrays", () => {
    const spaced = { path: " a.txt ", edits: [{ old: "x  y", next: [" z "] }] };
    const tight = { path: "a.txt", edits: [{ old: "x y", next: ["z"] }] };
    expect(digest("a b")).toBe(digest("a  b"));
    expect(digest(spaced)).toBe(digest(tight));
    expect(digest({ command: '  { "a" : "x  y" } ' })).toBe(digest({ command: { a: "x y" } }));
    const d = detector();
    const verdicts = feed(d, [spaced, tight, tight].map((input) => ({ tool: "Edit", input, result: "no" })));
    expect(verdicts.at(-1)).toMatchObject({ kind: "identical-result", count: 3 });
  });

  it("treats key-order differences as the same input", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(canonicalJson({ a: { c: 3, d: 2 }, b: 1 }));
    const d = detector();
    const verdicts = feed(d, [
      { tool: "Grep", input: { pattern: "x", path: "src" }, result: "r" },
      { tool: "Grep", input: '{"path":"src","pattern":"x"}', result: "r" },
      { tool: "Grep", input: { path: "src", pattern: "x" }, result: "r" },
    ]);
    expect(verdicts.at(-1)).toMatchObject({ kind: "identical-result", count: 3 });
    expect(verdicts.at(-1)!.reason).toBe("Grep returned the same result 3 times in a row for the same input");
  });

  it("trips on the same error for the same input", () => {
    const d = detector();
    const call = { tool: "Fetch", input: { url: "http://example.test/item" }, result: "403 Forbidden", error: true };
    const verdicts = feed(d, [call, call, call]);
    expect(verdicts.slice(0, 2)).toEqual([null, null]);
    expect(verdicts[2]).toMatchObject({ kind: "same-error", count: 3, reason: "Fetch failed with the same error 3 times in a row" });
  });

  it("trips when the same edit fails the same way", () => {
    const d = detector();
    const call = { tool: "Edit", input: { path: "a.txt", old: "x", next: "y" }, result: "Permission denied", error: true };
    const verdicts = feed(d, [call, call, call]);
    expect(verdicts[2]).toMatchObject({ kind: "same-error", count: 3 });
  });

  it("trips on an A/B ping-pong with unchanged results", () => {
    const d = detector();
    const round = [
      { tool: "Read", input: { path: "a" }, result: "A" },
      { tool: "Edit", input: { path: "a", text: "x" }, result: "ok" },
    ];
    const verdicts = feed(d, Array.from({ length: 6 }, () => round).flat());
    expect(verdicts.slice(0, -1).every((v) => v === null)).toBe(true);
    expect(verdicts.at(-1)).toMatchObject({ kind: "cycle", count: 6 });
    expect(verdicts.at(-1)!.reason).toBe("the calls Read → Edit repeated 6 times with no change in their results");
  });

  it("does not trip on a ping-pong whose results change", () => {
    const d = detector();
    const verdicts = feed(d, Array.from({ length: 20 }, (_, i) => [
      { tool: "Read", input: { path: "a" }, result: `content ${i}` },
      { tool: "Edit", input: { path: "a", text: "x" }, result: "ok" },
    ]).flat());
    expect(verdicts.every((v) => v === null)).toBe(true);
  });

  it("respects custom thresholds", () => {
    const d = detector({ identicalResult: 5 });
    const verdicts = feed(d, Array.from({ length: 5 }, () => ({ tool: "Bash", input: "ls", result: "x" })));
    expect(verdicts.slice(0, 4).every((v) => v === null)).toBe(true);
    expect(verdicts[4]).toMatchObject({ kind: "identical-result", count: 5 });
  });

  it("is off when disabled", () => {
    expect(loopThresholds({ enabled: false })).toBeNull();
  });

  it("answers once per run", () => {
    const d = detector();
    feed(d, Array.from({ length: 3 }, () => ({ tool: "Bash", input: "ls", result: "x" })));
    expect(d.stuck).not.toBeNull();
    expect(d.observe({ tool: "Bash", input: "ls", result: "x" })).toBeNull();
  });

  it("validates the config block", () => {
    expect(loopDetectorConfigSchema.safeParse({ enabled: false, cycles: 4 }).success).toBe(true);
    expect(loopDetectorConfigSchema.safeParse({ identicalCall: 1 }).success).toBe(false);
    expect(loopDetectorConfigSchema.safeParse({ unknown: 1 }).success).toBe(false);
  });
});

describe("makeLoopStopSubscriber", () => {
  const base = { eventId: "e", provider: "fake", threadId: "t1", createdAt: "" } as const;
  const start = (itemId: string, input?: string, title = "Bash") =>
    ({ ...base, itemId, type: "item.started", itemType: "tool", title, input }) as unknown as RuntimeEvent;
  const done = (itemId: string, output: string, ok = true) =>
    ({ ...base, itemId, type: "item.completed", itemType: "tool", ok, output }) as unknown as RuntimeEvent;

  it("stops the run with a stuck-loop reason, once", () => {
    const stop = vi.fn();
    const sub = makeLoopStopSubscriber({ config: () => undefined, stop });
    for (let i = 0; i < 4; i++) {
      sub(start(`i${i}`, '{"command":"ls"}'));
      sub(done(`i${i}`, "same"));
    }
    expect(stop).toHaveBeenCalledTimes(1);
    expect(stop.mock.calls[0]![0]).toBe("t1");
    expect(stop.mock.calls[0]![1]).toBe("stuck-loop: Bash returned the same result 3 times in a row for the same input");
  });

  it("never stops when disabled, and does not count bare tool names", () => {
    const stop = vi.fn();
    const off = makeLoopStopSubscriber({ config: () => ({ enabled: false }), stop });
    const on = makeLoopStopSubscriber({ config: () => undefined, stop });
    for (let i = 0; i < 10; i++) {
      off(start(`a${i}`, "ls"));
      off(done(`a${i}`, "same"));
      on(start(`b${i}`));
      on(done(`b${i}`, "same"));
    }
    expect(stop).not.toHaveBeenCalled();
  });

  it("starts over on each turn", () => {
    const stop = vi.fn();
    const sub = makeLoopStopSubscriber({ config: () => undefined, stop });
    for (let i = 0; i < 2; i++) { sub(start(`x${i}`, "ls")); sub(done(`x${i}`, "same")); }
    sub({ ...base, type: "turn.completed", ok: true } as unknown as RuntimeEvent);
    for (let i = 0; i < 2; i++) { sub(start(`y${i}`, "ls")); sub(done(`y${i}`, "same")); }
    expect(stop).not.toHaveBeenCalled();
  });

  it("keys a call on the tool name and the full title, not the title's first word", () => {
    expect(toolCallIdentity({ title: "Read a.txt" })).toEqual({ tool: "Read a.txt", input: "Read a.txt" });
    expect(toolCallIdentity({ title: "Read b.txt" })?.tool).toBe("Read b.txt");
    expect(toolCallIdentity({ tool: "Read", title: "Read a.txt", input: "a.txt" })).toEqual({ tool: "Read", input: "a.txt" });
    expect(toolCallIdentity({ title: "Bash" })).toBeNull();
  });

  it("does not stop when different files fail the same way", () => {
    const stop = vi.fn();
    const sub = makeLoopStopSubscriber({ config: () => undefined, stop });
    for (const file of ["a.txt", "b.txt", "c.txt"]) {
      sub(start(file, undefined, `Read ${file}`));
      sub(done(file, "File does not exist.", false));
    }
    expect(stop).not.toHaveBeenCalled();
  });

  it("stops when the same file fails the same way", () => {
    const stop = vi.fn();
    const sub = makeLoopStopSubscriber({ config: () => undefined, stop });
    for (let i = 0; i < 3; i++) {
      sub(start(`same${i}`, undefined, "Read a.txt"));
      sub(done(`same${i}`, "File does not exist.", false));
    }
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("resets a latched detector when the turn's completion is ignored", () => {
    const stop = vi.fn();
    const sub = makeLoopStopSubscriber({
      config: () => undefined,
      stop,
      ignore: (event) => event.type === "turn.completed" || event.type === "session.exited",
    });
    const burst = (prefix: string, turnId: string) => {
      for (let i = 0; i < 3; i++) {
        sub({ ...start(`${prefix}${i}`, '{"command":"ls"}'), turnId } as RuntimeEvent);
        sub({ ...done(`${prefix}${i}`, "same"), turnId } as RuntimeEvent);
      }
    };
    burst("a", "turn-a");
    expect(stop).toHaveBeenCalledTimes(1);
    sub({ ...base, type: "turn.completed", ok: false, turnId: "turn-a" } as unknown as RuntimeEvent);
    burst("b", "turn-b");
    expect(stop).toHaveBeenCalledTimes(2);
  });

  it("resets when a new turn starts and the previous completion never arrived", () => {
    const stop = vi.fn();
    const sub = makeLoopStopSubscriber({ config: () => undefined, stop });
    for (let i = 0; i < 3; i++) {
      sub({ ...start(`a${i}`, '{"command":"ls"}'), turnId: "turn-a" } as RuntimeEvent);
      sub({ ...done(`a${i}`, "same"), turnId: "turn-a" } as RuntimeEvent);
    }
    expect(stop).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 2; i++) {
      sub({ ...start(`b${i}`, '{"command":"ls"}'), turnId: "turn-b" } as RuntimeEvent);
      sub({ ...done(`b${i}`, "same"), turnId: "turn-b" } as RuntimeEvent);
    }
    expect(stop).toHaveBeenCalledTimes(1);
    sub({ ...start("b2", '{"command":"ls"}'), turnId: "turn-b" } as RuntimeEvent);
    sub({ ...done("b2", "same"), turnId: "turn-b" } as RuntimeEvent);
    expect(stop).toHaveBeenCalledTimes(2);
  });

  it("does not let a filtered event from an older turn reset the running turn", () => {
    const stop = vi.fn();
    let quarantineOld = false;
    const sub = makeLoopStopSubscriber({
      config: () => undefined,
      stop,
      ignore: (event) => quarantineOld && event.turnId === "turn-old" && event.type !== "turn.completed",
    });
    sub({ ...start("old0", '{"command":"pwd"}'), turnId: "turn-old" } as RuntimeEvent);
    sub({ ...done("old0", "first"), turnId: "turn-old" } as RuntimeEvent);
    sub({ ...base, type: "turn.completed", ok: true, turnId: "turn-old" } as unknown as RuntimeEvent);
    quarantineOld = true;
    for (let i = 0; i < 10; i++) {
      sub({ ...start(`late${i}`, '{"command":"pwd"}'), turnId: "turn-old" } as RuntimeEvent);
      sub({ ...done(`late${i}`, `late ${i}`), turnId: "turn-old" } as RuntimeEvent);
      sub({ ...start(`cur${i}`, '{"command":"ls"}'), turnId: "turn-current" } as RuntimeEvent);
      sub({ ...done(`cur${i}`, "same"), turnId: "turn-current" } as RuntimeEvent);
    }
    expect(stop).toHaveBeenCalledTimes(1);
    expect(stop.mock.calls[0]![1]).toBe("stuck-loop: Bash returned the same result 3 times in a row for the same input");
  });

  it("keeps a newer turn when an older completion arrives late", () => {
    const stop = vi.fn();
    const sub = makeLoopStopSubscriber({ config: () => undefined, stop });
    sub({ ...start("b0", '{"command":"ls"}'), turnId: "turn-b" } as RuntimeEvent);
    sub({ ...done("b0", "same"), turnId: "turn-b" } as RuntimeEvent);
    sub({ ...base, type: "turn.completed", ok: false, turnId: "turn-a" } as unknown as RuntimeEvent);
    for (let i = 1; i < 3; i++) {
      sub({ ...start(`b${i}`, '{"command":"ls"}'), turnId: "turn-b" } as RuntimeEvent);
      sub({ ...done(`b${i}`, "same"), turnId: "turn-b" } as RuntimeEvent);
    }
    expect(stop).toHaveBeenCalledTimes(1);
  });
});

describe("waits, polls and retries", () => {
  const times = (n: number, call: ToolCallObservation) => Array.from({ length: n }, () => call);

  it("does not stop a status poll that is still pending", () => {
    const d = detector();
    const verdicts = feed(d, times(8, { tool: "Bash", input: "runner pr checks 7", result: "pending" }));
    expect(verdicts.every((v) => v === null)).toBe(true);
  });

  it("does not stop a repeated sleep", () => {
    const d = detector();
    const verdicts = feed(d, times(8, { tool: "Bash", input: "sleep 60", result: "" }));
    expect(verdicts.every((v) => v === null)).toBe(true);
  });

  it("does not stop a status poll whose output keeps changing", () => {
    const d = detector();
    const verdicts = feed(d, Array.from({ length: 8 }, (_, i) => ({
      tool: "Bash", input: "runner get pod app", result: `phase ${i}`,
    })));
    expect(verdicts.every((v) => v === null)).toBe(true);
  });

  it("does not treat a line number or an expected timeout as a transient error", () => {
    for (const result of [
      "line 503", "at line 503", "expected timeout", "expected timeout of 30s",
      "see issue (503) for details", "upstream branch was reset",
    ]) {
      const d = detector();
      const verdicts = feed(d, times(3, {
        tool: "Bash", input: "cat src/app.ts", result, error: true,
      }));
      expect(verdicts.slice(0, 2).every((v) => v === null)).toBe(true);
      expect(verdicts[2]).toMatchObject({ kind: "same-error", count: 3 });
    }
  });

  it.each([
    ["a status field", '{"status":503}'],
    ["a status_code field", '{"status_code":503}'],
    ["a hung socket", "socket hang up"],
    ["an aborted operation", "The operation was aborted due to timeout"],
    ["a rate limit", "Rate limit exceeded (429)"],
    ["a returned status", "returned 503"],
    ["an upstream reset", "upstream connect error or disconnect/reset before headers"],
  ])("does not stop five retries after %s", (_name, result) => {
    const d = detector();
    const verdicts = feed(d, times(5, {
      tool: "Fetch", input: { url: "http://example.test/item" }, result, error: true,
    }));
    expect(verdicts.every((v) => v === null)).toBe(true);
  });

  it("does not stop retries of one call after a transient error", () => {
    for (const result of ["ETIMEDOUT", "timed out", "429", "503 Service Unavailable", "ECONNRESET"]) {
      const d = detector();
      const verdicts = feed(d, times(5, {
        tool: "Fetch", input: { url: "http://example.test/item" }, result, error: true,
      }));
      expect(verdicts.every((v) => v === null)).toBe(true);
    }
  });

  it("does not stop when different inputs fail with the same error", () => {
    const timeouts = detector();
    const timedOut = feed(timeouts, [1, 2, 3].map((i) => ({
      tool: "Fetch", input: { url: `http://example.test/${i}` }, result: "Request timed out", error: true,
    })));
    expect(timedOut.every((v) => v === null)).toBe(true);
    const denied = detector();
    const files = feed(denied, ["a.txt", "b.txt", "c.txt"].map((path) => ({
      tool: "Write", input: { path }, result: "Permission denied", error: true,
    })));
    expect(files.every((v) => v === null)).toBe(true);
  });

  it("does not stop a sleep and status-check cycle", () => {
    const d = detector();
    const round = [
      { tool: "Bash", input: "sleep 60", result: "" },
      { tool: "Bash", input: "curl -sf http://example.test/health", result: "pending" },
    ];
    const verdicts = feed(d, Array.from({ length: 6 }, () => round).flat());
    expect(verdicts.every((v) => v === null)).toBe(true);
  });

  it("still stops a wait or a status poll that never ends", () => {
    const sleep = detector();
    const sleeps = feed(sleep, times(POLL_REPEAT_BUDGET, { tool: "Bash", input: "sleep 60", result: "" }));
    expect(sleeps.slice(0, -1).every((v) => v === null)).toBe(true);
    expect(sleeps.at(-1)).toMatchObject({ kind: "identical-result", count: POLL_REPEAT_BUDGET });

    const poll = detector();
    const polls = feed(poll, Array.from({ length: POLL_REPEAT_BUDGET }, (_, i) => ({
      tool: "Bash", input: "runner get pod app", result: `phase ${i}`,
    })));
    expect(polls.at(-1)).toMatchObject({ kind: "identical-call", count: POLL_REPEAT_BUDGET });
  });

  it("gives a status_code field the transient retry budget", () => {
    const d = detector();
    const verdicts = feed(d, times(TRANSIENT_RETRY_BUDGET, {
      tool: "Fetch", input: { url: "http://example.test/item" }, result: '{"status_code":503}', error: true,
    }));
    expect(verdicts.slice(0, -1).every((v) => v === null)).toBe(true);
    expect(verdicts.at(-1)).toMatchObject({ kind: "same-error", count: TRANSIENT_RETRY_BUDGET });
  });

  it("still stops a transient retry that never succeeds", () => {
    const d = detector();
    const verdicts = feed(d, times(TRANSIENT_RETRY_BUDGET, {
      tool: "Fetch", input: { url: "http://example.test/item" }, result: "ETIMEDOUT", error: true,
    }));
    expect(verdicts.at(-1)).toMatchObject({ kind: "same-error", count: TRANSIENT_RETRY_BUDGET });
  });

  it("still stops a poll cycle that never changes", () => {
    const d = detector();
    const round = [
      { tool: "Bash", input: "sleep 60", result: "" },
      { tool: "Bash", input: "curl -sf http://example.test/health", result: "pending" },
    ];
    const verdicts = feed(d, Array.from({ length: POLL_CYCLE_BUDGET }, () => round).flat());
    expect(verdicts.slice(0, -1).every((v) => v === null)).toBe(true);
    expect(verdicts.at(-1)).toMatchObject({ kind: "cycle", count: POLL_CYCLE_BUDGET });
  });
});

describe("loop stop routing", () => {
  it("sends a direct thread through the direct stop and a room through the room stop", () => {
    expect(loopStopRoute({ botId: "bot-1" })).toEqual({ kind: "direct", botId: "bot-1" });
    expect(loopStopRoute({ groupId: "room-1" })).toEqual({ kind: "room", groupId: "room-1" });
    expect(loopStopRoute({ botId: "bot-1", groupId: "room-1" })).toEqual({ kind: "room", groupId: "room-1" });
    expect(loopStopRoute({})).toEqual({ kind: "unowned" });

    const stopDirect = vi.fn();
    const stopRoom = vi.fn();
    const onUnowned = vi.fn();
    const seen = new Set<string>();
    const actions = { stopDirect, stopRoom, onUnowned };
    dispatchLoopStop("thread-direct", { botId: "bot-1" }, actions, seen);
    dispatchLoopStop("thread-room", { groupId: "room-1" }, actions, seen);
    dispatchLoopStop("thread-none", {}, actions, seen);
    dispatchLoopStop("thread-none", {}, actions, seen);
    expect(stopDirect).toHaveBeenCalledTimes(1);
    expect(stopDirect).toHaveBeenCalledWith("bot-1", "thread-direct");
    expect(stopRoom).toHaveBeenCalledTimes(1);
    expect(stopRoom).toHaveBeenCalledWith("room-1", "thread-room");
    expect(onUnowned).toHaveBeenCalledTimes(1);
    expect(onUnowned).toHaveBeenCalledWith("thread-none");
  });
});
