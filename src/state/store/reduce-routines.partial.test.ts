import { describe, expect, it } from "vitest";
import { reduceRoutines } from "./reduce-routines";
import { initialState } from "./model";
import type { Action } from "./model";

// QA 0.8.66 F11: a frame of the app served where /api/routines answers `{}`
// threw "runs is not iterable" from trimRoutineRuns and the page widget showed
// the error screen. A listing without `routines` or `runs` hydrates as empty lists.
describe("reduceRoutines with a partial listing", () => {
  const run = (payload: Record<string, unknown>) => reduceRoutines(initialState, payload as unknown as Action, (s) => s);

  it("hydrates a listing without runs", () => {
    const next = run({ type: "routinesHydrated", routines: [] });
    expect(next?.routineRuns).toEqual([]);
    expect(next?.routinesLoadState).toBe("ready");
  });
  it("hydrates an empty listing", () => {
    const next = run({ type: "routinesHydrated" });
    expect(next?.routines).toEqual([]);
    expect(next?.routineRuns).toEqual([]);
  });
  it("keeps the runs it holds when older runs arrive without a list", () => {
    expect(run({ type: "routineRunsLoaded", from: 0, to: 1 })?.routineRuns).toEqual([]);
  });
});
