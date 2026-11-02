// Pure helpers for successive attempts and startup ordering (DEL-02 / DEL-03).
import { describe, expect, it } from "vitest";

import {
  attemptOutcomeFor,
  byOldestFirst,
  nextAttemptNumber,
  openAttempt,
  shouldResumeAfterReport,
  type Attempt,
} from "./attempts.ts";

const attempt = (number: number, outcome: Attempt["outcome"] = "completed"): Attempt => ({
  id: `a${number}`, assignmentId: "job", number, startedAt: number * 1000, outcome,
  ...(outcome === "running" ? {} : { finishedAt: number * 1000 + 1 }),
});

describe("attempts helpers", () => {
  it("numbers successive attempts from the highest stored", () => {
    expect(nextAttemptNumber([])).toBe(1);
    expect(nextAttemptNumber([attempt(1), attempt(2)])).toBe(3);
    expect(nextAttemptNumber([attempt(5), attempt(2)])).toBe(6);
  });

  it("finds the open running attempt", () => {
    expect(openAttempt([])).toBeUndefined();
    expect(openAttempt([attempt(1), attempt(2)])).toBeUndefined();
    expect(openAttempt([attempt(1), attempt(2, "running")])?.number).toBe(2);
  });

  it("resumes after a report only when an undelivered entry arrived later", () => {
    expect(shouldResumeAfterReport(undefined, [{ createdAt: 10 }])).toBe(false);
    expect(shouldResumeAfterReport(100, [])).toBe(false);
    expect(shouldResumeAfterReport(100, [{ createdAt: 50 }])).toBe(false);
    expect(shouldResumeAfterReport(100, [{ createdAt: 50 }, { createdAt: 150 }])).toBe(true);
  });

  it("maps settlement outcomes onto attempt outcomes", () => {
    expect(attemptOutcomeFor("completed", "done")).toBe("completed");
    expect(attemptOutcomeFor("failed", "interrupted")).toBe("interrupted");
    expect(attemptOutcomeFor("failed", "provider_error")).toBe("failed");
    expect(attemptOutcomeFor("cancelled", "stopped")).toBe("failed");
    expect(attemptOutcomeFor("expired", "expired")).toBe("failed");
  });

  it("admits priority-now first, then oldest createdAt", () => {
    const rows = [
      { id: "late", createdAt: 300 },
      { id: "now-late", createdAt: 400, priority: "now" as const },
      { id: "early", createdAt: 100 },
      { id: "now-early", createdAt: 200, priority: "now" as const },
    ];
    expect([...rows].sort(byOldestFirst).map(r => r.id)).toEqual([
      "now-early", "now-late", "early", "late",
    ]);
  });
});
