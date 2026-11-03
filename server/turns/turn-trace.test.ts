import { afterEach, describe, expect, it, vi } from "vitest";

import { clearTurnCounters, noteFirstResponse, noteTurnQueued, setTurnTimingWriter, turnCounters, turnTrace } from "./turn-trace.ts";

describe("turn trace (SAGAX_TURN_TRACE)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.SAGAX_TURN_TRACE;
    clearTurnCounters();
  });

  it("writes nothing unless switched on", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    turnTrace("0123456789abcdef", "start", true);
    expect(spy).not.toHaveBeenCalled();
  });

  it("prints the thread's first 8 characters, the step, the time and the elapsed ms", () => {
    process.env.SAGAX_TURN_TRACE = "1";
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    turnTrace("0123456789abcdef", "start", true);
    turnTrace("0123456789abcdef", "send");
    expect(spy).toHaveBeenCalledTimes(2);
    expect(String(spy.mock.calls[1]![0])).toMatch(/^\[turn-trace\] 01234567 send \d{13} \+\d+$/);
    expect(String(spy.mock.calls[1]![0])).not.toContain("hello");
  });

  it("counts queue wait and time to first answer with the trace off, and stores no words", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    let now = 5_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const thread = "abcdef0123456789";
    noteTurnQueued(thread, 5_000);
    now = 5_040;
    turnTrace(thread, "start", true);
    now = 5_090;
    turnTrace(thread, "send");
    now = 5_250;
    noteFirstResponse(thread);
    noteFirstResponse(thread);
    expect(turnCounters(thread)).toEqual({ queueMs: 90, firstResponseMs: 160 });
    expect(spy).not.toHaveBeenCalled();
  });

  it("measures each turn from its own message, not from the conversation's first one", () => {
    // 2026-10-28: a second turn kept the first turn's queued time, so its
    // "wait before send" grew with the conversation's age (421 900 ms seen
    // on a turn that started at once).
    let now = 1_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const thread = "thread-two-turns";
    turnTrace(thread, "start", true);
    noteTurnQueued(thread, 1_000);
    now = 1_030;
    turnTrace(thread, "send");
    expect(turnCounters(thread).queueMs).toBe(30);
    // seven minutes later the person writes again; the turn starts at once
    now = 422_900;
    turnTrace(thread, "start", true);
    noteTurnQueued(thread, 422_880);
    now = 422_920;
    turnTrace(thread, "send");
    expect(turnCounters(thread).queueMs).toBe(40);
  });

  it("writes the numbers for the conversation and keeps no words", () => {
    const seen: Array<{ threadId: string; timing: { queueMs?: number; firstResponseMs?: number } }> = [];
    setTurnTimingWriter((threadId, timing) => seen.push({ threadId, timing }));
    let now = 1_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    noteTurnQueued("thread-1", 1_000);
    now = 1_040;
    turnTrace("thread-1", "send");
    now = 1_200;
    noteFirstResponse("thread-1");
    expect(seen).toEqual([
      { threadId: "thread-1", timing: { queueMs: 40 } },
      { threadId: "thread-1", timing: { queueMs: 40, firstResponseMs: 160 } },
    ]);
    expect(JSON.stringify(seen)).not.toContain("hello");
  });
});
