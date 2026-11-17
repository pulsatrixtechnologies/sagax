// The Routines page's table (2026-11-17): which routines show (the search;
// scope, bot and status filters narrow the list before it), in which order, and what each row says. Pure, so the table, its filters and its
// search are tested without a DOM. The words of a row come from the same
// helpers every routine list reads (routine-display.ts, schedule-label.ts).
import type { Routine, RoutineRun } from "@/lib/routines";
import { routineTrend, type RoutineTrend } from "@/lib/routine-trend";
import { scheduleLabelCompact } from "@/lib/schedule-label";

export interface RoutineTableRow {
  routine: Routine;
  botName: string;
  /** The schedule or trigger in words, never cron. */
  when: string;
  /** Its last 7 runs as marks (src/lib/routine-trend.ts). */
  trend: RoutineTrend;
  paused: boolean;
}

export function routineTableRows(routines: readonly Routine[], runs: readonly RoutineRun[], options: {
  botName: (routine: Routine) => string;
  query?: string;
}): RoutineTableRow[] {
  const byRoutine = new Map<string, RoutineRun[]>();
  for (const run of runs) {
    const list = byRoutine.get(run.routineId);
    if (list) list.push(run); else byRoutine.set(run.routineId, [run]);
  }
  const query = options.query?.trim().toLowerCase() ?? "";
  const rows: RoutineTableRow[] = [];
  for (const routine of routines) {
    const own = byRoutine.get(routine.id) ?? [];
    const paused = !routine.enabled && !(routine.schedule.type === "once" && routine.nextRunAt == null);
    const botName = options.botName(routine);
    const when = scheduleLabelCompact(routine.schedule);
    if (query && !`${routine.name} ${botName} ${when} ${routine.folder ?? ""}`.toLowerCase().includes(query)) continue;
    rows.push({ routine, botName, when, trend: routineTrend(own), paused });
  }
  // The list's own order: on routines first, soonest next run, then name.
  return rows.sort((a, b) => Number(b.routine.enabled) - Number(a.routine.enabled)
    || (a.routine.nextRunAt ?? Infinity) - (b.routine.nextRunAt ?? Infinity)
    || a.routine.name.localeCompare(b.routine.name));
}
