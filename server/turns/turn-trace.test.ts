import { afterEach, describe, expect, it, vi } from "vitest";

import { newTurnLatency, turnLatencyParts } from "../drivers/acp/turn-latency.ts";
import { clearTurnArrival, clearTurnCounters, closeTurnServing, noteEnginePrompt, noteFirstResponse, noteTurnArrival, noteTurnQueued, noteTurnSettled, noteTurnServed, noteTurnServedPart, openTurnServing, setTurnTimingWriter, turnCounters, turnProcessStarts, turnQueueBusyMs, turnQueuedAt, turnTrace, turnTraceMarks, turnTracePayloadHash } from "./turn-trace.ts";
import { noteProcessStart } from "../process/spawn-helper.ts";

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
      { threadId: "thread-1", timing: { queueMs: 40, firstResponseMs: 160, firstWordMs: 200 } },
    ]);
    expect(JSON.stringify(seen)).not.toContain("hello");
  });

  it("says where a turn's time went: send to first word, engine start, total, and nothing of the turn before (#4215)", () => {
    const seen: Array<Record<string, unknown>> = [];
    setTurnTimingWriter((_threadId, timing) => seen.push({ ...timing }));
    let now = 10_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    noteTurnQueued("thread-2", 10_000);
    turnTrace("thread-2", "start", true);
    now = 10_300;
    turnTrace("thread-2", "send");
    noteEnginePrompt("thread-2", false, 13_300);
    now = 15_300;
    noteFirstResponse("thread-2");
    now = 16_000;
    noteTurnSettled("thread-2");
    expect(seen.at(-1)).toEqual({ queueMs: 300, firstResponseMs: 5_000, firstWordMs: 5_300, engineStartMs: 3_000, engineStart: "cold", totalMs: 6_000 });
    // the next turn on a warm engine starts from its own message
    noteTurnQueued("thread-2", 20_000);
    now = 20_000;
    turnTrace("thread-2", "start", true);
    now = 20_010;
    turnTrace("thread-2", "send");
    expect(seen.at(-1)).toEqual({ queueMs: 10 });
    noteEnginePrompt("thread-2", true, 20_015);
    expect(seen.at(-1)).toEqual({ queueMs: 10, engineStartMs: 5, engineStart: "warm" });
  });

  it("prints a first-token line from noteFirstResponse when the trace is on", () => {
    process.env.SAGAX_TURN_TRACE = "1";
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    let now = 5_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const thread = "fedcba9876543210";
    turnTrace(thread, "start", true);
    now = 5_100;
    turnTrace(thread, "send");
    now = 5_700;
    noteFirstResponse(thread);
    noteFirstResponse(thread);
    const lines = spy.mock.calls.map((call) => String(call[0]));
    expect(lines.filter((line) => line.includes(" first-token "))).toHaveLength(1);
    expect(lines.at(-1)).toMatch(/^\[turn-trace\] fedcba98 first-token 5700 \+\d+$/);
    expect(lines.join("\n")).not.toContain("hello");
  });

  it("keeps first-token silent when the trace is off", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    noteFirstResponse("silent-thread-id");
    expect(spy).not.toHaveBeenCalled();
  });

  it("prints a payload hash and never the words when the trace is on", () => {
    process.env.SAGAX_TURN_TRACE = "1";
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    turnTracePayloadHash("0123456789abcdef", {
      system: "secret system words",
      systemStable: "stable",
      systemVolatile: "volatile",
      transcript: [{ role: "user", text: "hello there" }],
      text: "turn text with secrets",
      integrations: { agents: {}, browser: true },
      model: "claude-sonnet",
      effort: null,
      resumeCursor: "cur-1",
      sessionReset: false,
    });
    expect(spy).toHaveBeenCalledTimes(1);
    const line = String(spy.mock.calls[0]![0]);
    expect(line).toMatch(/^\[turn-trace\] 01234567 payload-hash [0-9a-f]{64}$/);
    expect(line).not.toContain("secret");
    expect(line).not.toContain("hello");
  });

  it("writes nothing for a payload hash unless switched on", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    turnTracePayloadHash("0123456789abcdef", { system: "x" });
    expect(spy).not.toHaveBeenCalled();
  });

  // #3561: the latency line names its parts from these marks, trace off too
  it("keeps this turn's steps with their times, trace off, and starts over with the next turn", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    let now = 1_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const thread = "feedface01234567";
    turnTrace(thread, "start", true);
    now = 1_200;
    turnTrace(thread, "compacted");
    now = 1_900;
    turnTrace(thread, "send");
    expect(turnTraceMarks(thread, 0, 2_000)).toEqual([["start", 1_000], ["compacted", 1_200], ["send", 1_900]]);
    expect(turnTraceMarks(thread, 1_100, 1_900)).toEqual([["compacted", 1_200], ["send", 1_900]]);
    now = 5_000;
    turnTrace(thread, "start", true);
    expect(turnTraceMarks(thread, 0, 9_000)).toEqual([["start", 5_000]]);
    for (let i = 0; i < 100; i += 1) turnTrace(thread, "recall");
    expect(turnTraceMarks(thread, 0, 9_000).length).toBe(64);
    expect(turnTraceMarks("unknown-thread", 0, 9_000)).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });

  // #4215: the queue says whether Sagax's own main thread was busy or the
  // turn waited on I/O
  it("counts a send that waited for its conversation's pre-warm from its arrival, and names the wait (#4215)", () => {
    let now = 10_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const thread = "thread-joined-a-warm";
    // the previous turn of the conversation, sent and answered
    turnTrace(thread, "start", true);
    turnTrace(thread, "send");
    // the send arrives at 20 000 and waits for the warm until 21 500
    noteTurnArrival(thread, 20_000, 21_500);
    now = 21_520;
    turnTrace(thread, "start", true);
    noteTurnQueued(thread, 21_510);
    now = 21_600;
    turnTrace(thread, "send");
    expect(turnQueuedAt(thread)).toBe(20_000);
    expect(turnCounters(thread).queueMs).toBe(1_600);
    const latency = newTurnLatency(21_600, turnQueuedAt(thread));
    expect(turnLatencyParts(latency, turnTraceMarks(thread, 20_000, 21_600)).queueBy).toBe("admit:20,prewarm:1500,send:80");
    // the next turn of the conversation, with no wait, counts from its message
    now = 30_000;
    turnTrace(thread, "start", true);
    noteTurnQueued(thread, 29_990);
    expect(turnQueuedAt(thread)).toBe(29_990);
    turnTrace(thread, "send");
    // a send that never started a turn leaves nothing behind
    noteTurnArrival(thread, 40_000, 40_100);
    clearTurnArrival(thread);
    now = 40_200;
    turnTrace(thread, "start", true);
    expect(turnQueuedAt(thread)).toBeUndefined();
  });

  // #3598: the turn latency line counts the process starts of the turn's
  // wait (queue and setup) and their total synchronous time.
  it("counts the process starts made from the turn's start until the engine took its prompt (#3598)", () => {
    const thread = "starts-thread-3598";
    noteProcessStart("/usr/bin/early", 50);
    turnTrace(thread, "start", true);
    expect(turnProcessStarts(thread)).toBeUndefined();
    noteProcessStart("/opt/engine/bin/engine", 120);
    turnTrace(thread, "send");
    noteProcessStart("/usr/bin/helper", 30);
    noteEnginePrompt(thread, false);
    // after the engine took the prompt: a tool's start is not the wait's
    noteProcessStart("/usr/bin/tool", 400);
    expect(turnProcessStarts(thread)).toEqual({ count: 2, ms: 150 });
    // the next turn counts from its own start
    turnTrace(thread, "start", true);
    expect(turnProcessStarts(thread)).toBeUndefined();
  });

  it("measures the main thread's busy time between the turn's start and its send", () => {
    const thread = "busy-thread-4215";
    turnTrace(thread, "start", true);
    expect(turnQueueBusyMs(thread)).toBeUndefined();
    const until = performance.now() + 60;
    while (performance.now() < until) { /* the server's own work */ }
    turnTrace(thread, "send");
    expect(turnQueueBusyMs(thread)).toBeGreaterThanOrEqual(40);
    turnTrace(thread, "start", true);
    expect(turnQueueBusyMs(thread)).toBeUndefined();
  });

  it("adds up the parts of a mount's tool list while the setup waits, and only then (#3623)", () => {
    const thread = "parts-thread-1";
    noteTurnServedPart(thread, "connector", "open", 400);
    openTurnServing(thread, 1_000);
    noteTurnServed(thread, "connector", "in", 1_570);
    noteTurnServedPart(thread, "connector", "open", 410.4);
    noteTurnServedPart(thread, "connector", "hello", 230);
    noteTurnServedPart(thread, "connector", "list", 900);
    noteTurnServedPart(thread, "connector", "list", 80);
    noteTurnServed(thread, "connector", "out", 3_511);
    noteTurnServed(thread, "data", "in", 1_738);
    noteTurnServed(thread, "data", "out", 1_740);
    expect(closeTurnServing(thread)).toEqual([
      ["connector", 570, 2_511, [["open", 410], ["hello", 230], ["list", 980]]],
      ["data", 738, 740],
    ]);
    noteTurnServedPart(thread, "connector", "open", 5);
    expect(closeTurnServing(thread)).toEqual([]);
  });
});
