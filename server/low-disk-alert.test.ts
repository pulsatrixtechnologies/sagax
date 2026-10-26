import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isDiskLow, lowDiskText, startLowDiskWatch, LOW_DISK_FLOOR_BYTES } from "./low-disk-alert.ts";

const GB = 1024 ** 3;

describe("low disk alert", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("is low under 5 GiB free or under 5% of the disk, and never on unknown numbers", () => {
    expect(LOW_DISK_FLOOR_BYTES).toBe(5 * GB);
    expect(isDiskLow({ freeBytes: 4 * GB, totalBytes: 2000 * GB })).toBe(true);
    expect(isDiskLow({ freeBytes: 40 * GB, totalBytes: 1000 * GB })).toBe(true);
    expect(isDiskLow({ freeBytes: 200 * GB, totalBytes: 1000 * GB })).toBe(false);
    expect(isDiskLow({ freeBytes: null, totalBytes: null })).toBe(false);
  });

  it("says how much room is left, in plain words", () => {
    expect(lowDiskText({ freeBytes: 3.2 * GB, totalBytes: 500 * GB })).toEqual({
      title: "The computer is running low on disk space",
      body: "3.2 GB left. Free some space (Settings > Computer care shows what can go) so bots can keep working.",
    });
  });

  it("notifies once a day while the disk stays low, and again after it recovers and drops", async () => {
    const free = { value: 2 * GB };
    const notify = vi.fn();
    const stop = startLowDiskWatch({ dir: "/x", notify, check: async () => ({ freeBytes: free.value, totalBytes: 500 * GB }), intervalMs: 60_000, firstCheckMs: 1_000 });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(notify).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(notify).toHaveBeenCalledTimes(1);
    free.value = 100 * GB;
    await vi.advanceTimersByTimeAsync(60_000);
    free.value = 1 * GB;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(notify).toHaveBeenCalledTimes(2);
    stop();
  });
});
