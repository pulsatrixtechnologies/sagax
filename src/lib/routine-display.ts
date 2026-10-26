import type { Routine, RoutineRun } from "./routines";
import { activeLocale, t } from "./i18n";
import { scheduleLabel } from "./schedule-label";

export function routineRunTime(run: RoutineRun): number {
  return run.createdAt || run.startedAt || run.scheduledFor;
}

export function latestRoutineRun(routineId: string, runs: readonly RoutineRun[]): RoutineRun | undefined {
  return runs.filter((run) => run.routineId === routineId)
    .reduce<RoutineRun | undefined>((latest, run) => !latest || routineRunTime(run) > routineRunTime(latest) ? run : latest, undefined);
}

export function routineRunLabel(run: RoutineRun): string {
  // a completed run with nothing for the person posted nothing (2026-10-22)
  if (run.status === "completed" && run.quiet) return t("routines.status.nothing_to_report");
  if (run.goalStatus) return t(`routines.goal.${run.goalStatus}`);
  const status = t(`routines.status.${run.status}`);
  return run.retried && run.status !== "queued" ? t(`routines.retried.${run.retried}`, { status }) : status;
}

/** Driver stop codes a run's error can still be (a run recorded before the
 * engine's own words were kept, or an engine that gave none). */
const ROUTINE_FAILURE_KEYS = {
  rpc_error: "routines.failure.rpc_error",
  auth_required: "routines.failure.auth_required",
  provider_safety: "routines.failure.provider_safety",
} as const;

/** A run's error as a person reads it: the engine's words as given, and a
 * bare stop code (rpc_error) turned into a sentence that says what to do. */
export function routineRunError(error: string | undefined): string | undefined {
  const text = error?.trim();
  if (!text || !/^[a-z][a-z0-9_]*$/.test(text)) return error;
  const key = Object.hasOwn(ROUTINE_FAILURE_KEYS, text) ? ROUTINE_FAILURE_KEYS[text as keyof typeof ROUTINE_FAILURE_KEYS] : null;
  return key ? t(key) : t("routines.failure.code", { code: text });
}

export function routineRunTone(run: RoutineRun): string {
  if (run.status === "waiting" || ["needs-input", "limit-reached", "paused"].includes(run.goalStatus ?? "")) return "text-warning";
  if (["failed", "missed"].includes(run.status) || ["failed", "blocked"].includes(run.goalStatus ?? "")) return "text-danger";
  if (run.status === "running") return "text-accent";
  if (run.status === "completed" && run.quiet) return "text-ink-secondary";
  if (run.status === "completed" && (!run.goalStatus || run.goalStatus === "completed")) return "text-success";
  return "text-ink-secondary";
}

export function routineDateTime(at: number): string {
  return new Date(at).toLocaleString(activeLocale(), { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function routineScheduleState(routine: Routine): string {
  // A consumed one-shot has no next date. It is not a paused recurring schedule.
  if (routine.schedule.type === "once" && routine.nextRunAt == null && routine.schedule.at <= Date.now()) return t("routines.finishedSchedule");
  return routine.enabled ? t("routines.activeSchedule") : t("routines.pausedSchedule");
}

/** The line under the name: when the routine runs. Active is the switch.
 * A paused or finished schedule keeps that word after the when. */
export function routineWhenLabel(routine: Routine): string {
  const when = scheduleLabel(routine.schedule);
  const state = routineScheduleState(routine);
  if (state === t("routines.activeSchedule")) return when;
  return `${when} · ${state}`;
}

export function routineNextLabel(routine: Routine): string {
  if (!routine.enabled) return routineScheduleState(routine);
  return routine.nextRunAt == null ? t("routines.noNextRun") : t("routines.nextRun", { time: routineDateTime(routine.nextRunAt) });
}

/** Where a routine runs, in the Computer panel's words. My Cloud is always
 * on, so its routines run on schedule; a desktop starts them while
 * Sagax is open there. A Cloud home offers no Local VM or this
 * computer, so a copied bot's setting reads as My Cloud. */
export function routineRunsOn({ roomGoal, runOn, computer, cloudHome }: {
  roomGoal: boolean; runOn?: string; computer?: string | null; cloudHome: boolean;
}): { label: string; hint: string } {
  const hint = t(cloudHome ? "routines.runsOn.cloudHomeHint" : "routines.runsOn.localHint");
  if (roomGoal) return { label: t(cloudHome ? "routines.runsOn.teamCloudHome" : "routines.runsOn.team"), hint };
  if (runOn === "cloud") return { label: t("routines.runsOn.boat"), hint: t(cloudHome ? "routines.runsOn.boatHintCloudHome" : "routines.runsOn.boatHint") };
  if (computer === "cloud") return { label: t("routines.runsOn.botCloud"), hint };
  if (computer === "vm" && !cloudHome) return { label: t("routines.runsOn.botVm"), hint };
  return { label: t(cloudHome ? "routines.runsOn.cloudHome" : "routines.runsOn.local"), hint };
}

/** The calendar's "Upcoming" panel: the routines that will run, soonest
 * first (2026-10-18, JC). A paused, suspended or finished routine has no
 * next run and is left to the list view. */
export function upcomingRoutines(routines: readonly Routine[]): Routine[] {
  return routines
    .filter((routine) => routine.enabled && !routine.suspended && routine.nextRunAt != null)
    .sort((a, b) => (a.nextRunAt ?? 0) - (b.nextRunAt ?? 0) || a.name.localeCompare(b.name));
}

function localDayIndex(at: number): number {
  const date = new Date(at);
  return Math.round(new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime() / 86_400_000);
}

/** A next run as a person says it: "Today at 9:00 AM", "Tomorrow at…",
 * "Tuesday at…" within the week, else "October 25 at…". */
export function routineNextRunPhrase(at: number, now = Date.now()): string {
  const locale = activeLocale();
  const time = new Date(at).toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
  const days = localDayIndex(at) - localDayIndex(now);
  if (days === 0) return t("routines.upcoming.today", { time });
  if (days === 1) return t("routines.upcoming.tomorrow", { time });
  if (days > 1 && days < 7) return t("routines.upcoming.weekday", { day: new Date(at).toLocaleDateString(locale, { weekday: "long" }), time });
  const sameYear = new Date(at).getFullYear() === new Date(now).getFullYear();
  const date = new Date(at).toLocaleDateString(locale, sameYear ? { month: "long", day: "numeric" } : { month: "long", day: "numeric", year: "numeric" });
  return t("routines.upcoming.date", { date, time });
}

const UPCOMING_IN_FLIGHT = ["running", "waiting", "queued"] as const;

/** The state pill of an upcoming row: a run in flight says so, a routine
 * whose last runs failed says Failing, otherwise Active. */
export function routineUpcomingState(routine: Routine, runs: readonly Pick<RoutineRun, "routineId" | "status">[]): { label: string; tone: "info" | "warning" | "neutral" } {
  const live = UPCOMING_IN_FLIGHT.find((status) => runs.some((run) => run.routineId === routine.id && run.status === status));
  if (live) return { label: t(`routines.status.${live}`), tone: "info" };
  if ((routine.failureStreak ?? 0) > 0) return { label: t("routines.scope.status.failing"), tone: "warning" };
  return { label: t("routines.activeSchedule"), tone: "neutral" };
}
