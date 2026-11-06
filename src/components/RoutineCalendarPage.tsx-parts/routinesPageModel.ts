import { useCallback, useMemo, useRef } from "react";
import type { RoutineRun, RoutineRunStatus } from "@/lib/routines";
import type { AppState } from "@/state/store";

/** The slices of the store the Automations page reads (2026-11-02): it
 * renders when one of them changes, not on every store frame (a bot's
 * stream, an unread mark, the sidebar). */
export function selectRoutinesPage(state: AppState) {
  return {
    routines: state.routines,
    routineRuns: state.routineRuns,
    bots: state.bots,
    groups: state.groups,
    config: state.config,
    routinesFocus: state.routinesFocus,
    routinesLoadState: state.routinesLoadState,
    webhooks: state.webhooks,
  };
}

const IN_FLIGHT_STATUSES: ReadonlySet<RoutineRunStatus> = new Set(["queued", "running", "waiting"]);
/** The in-flight runs, kept as the same array while that set (ids and
 * statuses) does not change: the upcoming panel reads only these. */
export function useInFlightRuns(runs: RoutineRun[]): RoutineRun[] {
  const held = useRef<{ key: string; runs: RoutineRun[] }>({ key: "", runs: [] });
  return useMemo(() => {
    const inFlight = runs.filter((run) => IN_FLIGHT_STATUSES.has(run.status));
    const key = inFlight.map((run) => `${run.id}:${run.routineId}:${run.status}`).join("|");
    if (key !== held.current.key) held.current = { key, runs: inFlight };
    return held.current.runs;
  }, [runs]);
}

/** The latest render's function behind a stable one: a memoized child keeps
 * the same prop while the function reads this render's state. */
export function useStableHandler<A extends unknown[], R>(handler: (...args: A) => R): (...args: A) => R {
  const ref = useRef(handler);
  ref.current = handler;
  return useCallback((...args: A) => ref.current(...args), []);
}
