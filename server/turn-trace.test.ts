import { afterEach, describe, expect, it, vi } from "vitest";

import { turnTrace } from "./turn-trace.ts";

describe("turn trace (SAGAX_TURN_TRACE)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.SAGAX_TURN_TRACE;
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
  });
});
