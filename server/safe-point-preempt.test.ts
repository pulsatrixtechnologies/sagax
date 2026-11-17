import { afterEach, describe, expect, it, vi } from "vitest";

import { SafePointPreempts, stopClosesCard } from "./safe-point-preempt.ts";

describe("safe-point preemption", () => {
  afterEach(() => vi.useRealTimers());

  it("interrupts at once when no tool runs", () => {
    const fire = vi.fn();
    expect(new SafePointPreempts().request("t", 0, fire)).toBe("now");
    expect(fire).toHaveBeenCalledTimes(1);
  });

  it("waits for the running tools to end, never in the middle of one", () => {
    const preempts = new SafePointPreempts();
    const fire = vi.fn();
    expect(preempts.request("t", 2, fire)).toBe("at-safe-point");
    preempts.toolEnded("t", 1);
    expect(fire).not.toHaveBeenCalled();
    // a second message joins the first request
    expect(preempts.request("t", 1, vi.fn())).toBe("already");
    preempts.toolEnded("t", 0);
    expect(fire).toHaveBeenCalledTimes(1);
    preempts.toolEnded("t", 0);
    expect(fire).toHaveBeenCalledTimes(1);
  });

  it("cuts a tool that runs past the ceiling, so a message never waits minutes", () => {
    vi.useFakeTimers();
    const preempts = new SafePointPreempts(45_000);
    const fire = vi.fn();
    preempts.request("t", 1, fire);
    vi.advanceTimersByTime(44_999);
    expect(fire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fire).toHaveBeenCalledTimes(1);
    expect(preempts.waiting("t")).toBe(false);
  });

  it("does nothing once the turn settled on its own", () => {
    vi.useFakeTimers();
    const preempts = new SafePointPreempts(1_000);
    const fire = vi.fn();
    preempts.request("t", 1, fire);
    preempts.clear("t");
    vi.advanceTimersByTime(5_000);
    preempts.toolEnded("t", 0);
    expect(fire).not.toHaveBeenCalled();
  });
});

describe("stopClosesCard (#4475)", () => {
  it("is an open permission, never a question, a chat card, a proposal or a settled card", () => {

    expect(stopClosesCard({ requestId: "r", requestType: "permission", tool: "shell" })).toBe(true);
    expect(stopClosesCard({ requestId: "r", requestType: "permission", tool: "shell", answered: "allow" })).toBe(false);
    expect(stopClosesCard({ requestId: "r", requestType: "permission", tool: "shell", dismissed: true })).toBe(false);
    expect(stopClosesCard({ requestId: "r", requestType: "question" })).toBe(false);
    expect(stopClosesCard({ requestType: "question" })).toBe(false);
    expect(stopClosesCard({ requestId: "r", tool: "x", routineRequest: {} })).toBe(false);
    expect(stopClosesCard(undefined)).toBe(false);
  });
});
