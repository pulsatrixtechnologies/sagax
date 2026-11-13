import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { outcomesOf, routineNeed, type Outcome, type OutcomeRecord, type OutcomeRoutine, type OutcomeRun } from "./outcomes.ts";

const vectors = JSON.parse(readFileSync(new URL("./outcomes.vectors.json", import.meta.url), "utf8")) as {
  now: number;
  cases: Array<{ name: string; records?: OutcomeRecord[]; routines: OutcomeRoutine[]; runs: OutcomeRun[]; outcomes: Outcome[] }>;
};

describe("a bot's outcomes, read from its routines (#4098, shared vectors, also run by the phone)", () => {
  it.each(vectors.cases)("$name", ({ records, routines, runs, outcomes }) => {
    expect(outcomesOf(routines, runs, records ?? [], vectors.now)).toEqual(outcomes);
  });

  it("every routine that exists today shows as an outcome of its own, nothing to redo", () => {
    const routines = vectors.cases.flatMap((item) => (item.records ? [] : item.routines));
    for (const item of vectors.cases.filter((entry) => !entry.records)) {
      expect(outcomesOf(item.routines, item.runs, [], vectors.now).map((outcome) => outcome.routineIds)).toEqual(
        expect.arrayContaining(item.routines.map((routine) => [routine.id])),
      );
    }
    expect(routines.length).toBeGreaterThan(8);
  });

  it("the cases name every status and every kind read from today's wire", () => {
    const all = vectors.cases.flatMap((item) => item.outcomes);
    expect(new Set(all.map((outcome) => outcome.status))).toEqual(new Set(["needs-you", "on-track", "paused", "finished", "reached"]));
    expect(new Set(all.flatMap((outcome) => (outcome.needsPerson ? [outcome.needsPerson.kind] : [])))).toEqual(new Set(["question", "paused", "problem", "goal", "items"]));
  });

  it("a waiting run's need clears once the run is answered", () => {
    const routine: OutcomeRoutine = { id: "r1", name: "Digest", enabled: true, schedule: { type: "cron", expression: "0 7 * * *", timeZone: "UTC" }, nextRunAt: null, createdAt: 1 };
    const waiting: OutcomeRun = { id: "x1", routineId: "r1", routineName: "Digest", status: "waiting", scheduledFor: 10, createdAt: 10, attention: "Which deck?" };
    expect(routineNeed(routine, [waiting])?.kind).toBe("question");
    expect(routineNeed(routine, [{ ...waiting, status: "completed", finishedAt: 20 }])).toBeUndefined();
  });
});
