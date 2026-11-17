import { useEffect, useRef } from "react";

import type { RoutineRun } from "@/lib/routines";
import { api } from "./store/api";
import { useStore } from "./store";
import { useStoreDispatch, useStoreSelector } from "./store-selector";

/** Loads the runs scheduled from `start` up to where the app's window begins, once a view shows dates before it. */
export function useRoutineRunsFrom(start: number): void {
  const { state, dispatch } = useStore();
  const since = state.routineRunsSince;
  useEffect(() => {
    if (since === null || start >= since) return;
    let live = true;
    api(`/api/routines?from=${start}&to=${since}`)
      .then(({ runs }) => { if (live && Array.isArray(runs)) dispatch({ type: "routineRunsLoaded", runs, from: start, to: since }); })
      .catch(() => {});
    return () => { live = false; };
  }, [start, since, dispatch]);
}

/** A trend needs each routine's last few runs, not every run of the weeks they span: this asks the range
 * `start` to the app's window for just the newest `perRoutine` of each routine (an older server ignores that and
 * answers the whole range, which still draws the same bars). The answer carries no range, so the app's window
 * (`routineRunsSince`) stays where it is, and they land in `routineTrendRuns`, not among the app's runs: a view that needs every run of a range still loads it.
 * Asked once per `start` (the caller rounds it to the day); a failure is not retried until `start` changes.
 * Returns "loading" until the answer lands. */
export function useRoutineTrendRuns(start: number, perRoutine: number): "loading" | "ready" | "failed" {
  const { state, dispatch } = useStore();
  const since = state.routineRunsSince;
  const done = useRef<{ key: string; result: "ready" | "failed" } | null>(null);
  const key = `${start}:${since}`;
  const settled = since !== null && done.current?.key === key ? done.current.result : null;
  useEffect(() => {
    if (since === null || done.current?.key === key) return;
    let live = true;
    api(`/api/routines?from=${start}&to=${since}&perRoutine=${perRoutine}`)
      .then(({ runs }) => {
        if (!live) return;
        done.current = { key, result: "ready" };
        // Kept apart from the app's runs (the run log and the figures never see them); dispatched even when empty: it
        // is what redraws the caller with "ready".
        dispatch({ type: "routineTrendRunsLoaded", runs: Array.isArray(runs) ? runs : [] });
      })
      .catch(() => { if (live) { done.current = { key, result: "failed" }; dispatch({ type: "routineTrendRunsLoaded", runs: [] }); } });
    return () => { live = false; };
  }, [key, start, since, perRoutine, dispatch]);
  return settled ?? "loading";
}

/** Whether the runs from `start` are all held: the app's window reaches back that far. */
export function useRoutineRunsCover(start: number): boolean {
  return useStoreSelector((state) => state.routineRunsSince === null || start >= state.routineRunsSince);
}

/** The run that worked in this conversation; one older than the app's window is loaded when the thread is a run's. */
export function useThreadRoutineRun(botId: string, threadId: string): RoutineRun | undefined {
  // Selectors, not the whole store: a run frame of another conversation never redraws the chat.
  const dispatch = useStoreDispatch();
  const run = useStoreSelector((state) => state.routineRuns.find((candidate) => candidate.target === "bot" && candidate.botId === botId && candidate.threadId === threadId));
  const missing = useStoreSelector((state) => !state.routineRuns.some((candidate) => candidate.target === "bot" && candidate.botId === botId && candidate.threadId === threadId)
    && Boolean(state.bots.find((bot) => bot.id === botId)?.tasks?.some((task) => task.threadId === threadId && task.routineRunId))
    && state.routineRunsSince !== null);
  useEffect(() => {
    if (!missing) return;
    let live = true;
    api(`/api/routines?thread=${encodeURIComponent(threadId)}`)
      .then(({ runs }) => { if (live && Array.isArray(runs) && runs.length) dispatch({ type: "routineRunsLoaded", runs }); })
      .catch(() => {});
    return () => { live = false; };
  }, [missing, threadId, dispatch]);
  return run;
}
