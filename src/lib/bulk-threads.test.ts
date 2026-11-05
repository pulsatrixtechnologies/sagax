// Archive all / Delete all threads (the maintainer, 2026-11-04).
import { describe, expect, it } from "vitest";

import { BULK_THREAD_CONCURRENCY, bulkThreadTargets, runBounded, settled } from "./bulk-threads";

describe("bulkThreadTargets", () => {
  const tasks = [
    { threadId: "a" },
    { threadId: "b", busy: true },
    { threadId: "c", archivedAt: 5 },
    { threadId: "d", routineRunId: "run" },
    { threadId: "e", pinned: true },
    { threadId: "f", activity: "working" },
  ];

  it("leaves a thread at work and a routine run alone, and keeps pinned threads", () => {
    expect(bulkThreadTargets(tasks, "delete").map((task) => task.threadId)).toEqual(["a", "c", "e"]);
  });

  it("skips threads already archived when archiving", () => {
    expect(bulkThreadTargets(tasks, "archive").map((task) => task.threadId)).toEqual(["a", "e"]);
  });
});

describe("runBounded", () => {
  it("never has more than the limit in flight and counts the successes", async () => {
    let inFlight = 0;
    let peak = 0;
    const items = Array.from({ length: 11 }, (_, index) => index);
    const done = await runBounded(items, BULK_THREAD_CONCURRENCY, async (item) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight -= 1;
      if (item === 3) throw new Error("one thread failed");
      return item !== 5;
    });
    expect(peak).toBe(BULK_THREAD_CONCURRENCY);
    expect(done).toBe(9);
  });

  it("resolves at once for no items", async () => {
    expect(await runBounded([], 4, async () => true)).toBe(0);
  });
});

describe("settled", () => {
  it("turns a store action's onSettled into a promise", async () => {
    await expect(settled((done) => setTimeout(() => done(false), 0))).resolves.toBe(false);
  });
});
