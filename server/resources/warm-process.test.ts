import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChildProcess } from "node:child_process";
import { killCliTree } from "../procs.ts";
import { WarmResourceBudget } from "./warm-resources.ts";
import { retireClosedWarmProcess } from "./warm-process.ts";

vi.mock("../procs.ts", () => ({ killCliTree: vi.fn() }));
afterEach(() => { vi.useRealTimers(); vi.resetAllMocks(); });

describe("retiring warm process trees", () => {
  it("keeps a closed root charged when descendants are unconfirmed, then retries the tree", async () => {
    vi.useFakeTimers();
    vi.mocked(killCliTree).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const budget = new WarmResourceBudget({ intervalMs: 0, sample: async () => [] });
    const child = { pid: 5000, exitCode: 0, signalCode: null } as ChildProcess;
    const lease = budget.register({ person: "osprey", kind: "acp", bytes: 10, evict: () => killCliTree(child) });
    retireClosedWarmProcess(lease, child);
    expect(budget.stats()).toMatchObject({ count: 1, closing: 1 });
    await vi.advanceTimersByTimeAsync(1999); expect(killCliTree).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); expect(budget.stats().resources).toBe(1);
    await budget.refresh(); await budget.settled();
    expect(killCliTree).toHaveBeenCalledTimes(2); expect(budget.stats().resources).toBe(0);
  });
  it("forgets a resource after confirmed tree cleanup without counting a budget eviction", async () => {
    vi.useFakeTimers(); vi.mocked(killCliTree).mockResolvedValue(true);
    const budget = new WarmResourceBudget({ intervalMs: 0 });
    const lease = budget.register({ person: "wren", kind: "pi", bytes: 10, evict() {} });
    retireClosedWarmProcess(lease, {} as ChildProcess);
    await vi.advanceTimersByTimeAsync(2000);
    expect(budget.stats()).toMatchObject({ resources: 0, evictions: 0 });
  });
});
