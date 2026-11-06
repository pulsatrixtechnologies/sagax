import { describe, expect, it, vi } from "vitest";
import { deferConnectorsPatch } from "./defer-connectors-patch.ts";

describe("deferConnectorsPatch", () => {
  it("runs the write on the injected schedule, not synchronously", () => {
    const queued: Array<() => void> = [];
    const apply = vi.fn();
    deferConnectorsPatch(apply, (fn) => queued.push(fn));
    expect(apply).not.toHaveBeenCalled();
    expect(queued).toHaveLength(1);
    queued[0]!();
    expect(apply).toHaveBeenCalledOnce();
  });

  it("defaults to a short timer past first-token overhead", async () => {
    vi.useFakeTimers();
    const apply = vi.fn();
    deferConnectorsPatch(apply);
    expect(apply).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(49);
    expect(apply).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(apply).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it("swallows an apply failure so a late bots save never rejects the turn", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const queued: Array<() => void> = [];
    deferConnectorsPatch(() => {
      throw new Error("bots.json locked");
    }, (fn) => queued.push(fn));
    expect(() => queued[0]!()).not.toThrow();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("bots.json locked"));
    warn.mockRestore();
  });
});
