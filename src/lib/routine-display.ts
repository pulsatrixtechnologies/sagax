import type { Routine, RoutineRun } from "./routines";
import { activeLocale, t } from "./i18n";
import { scheduleLabel } from "./schedule-label";
import { ROUTINE_AUTO_PAUSE_CHOICES } from "../../shared/routine-auto-pause";

export function routineRunTime(run: RoutineRun): number {
  return run.createdAt || run.startedAt || run.scheduledFor;
}

export function latestRoutineRun(routineId: string, runs: readonly RoutineRun[]): RoutineRun | undefined {
  return runs.filter((run) => run.routineId === routineId)
    .reduce<RoutineRun | undefined>((latest, run) => !latest || routineRunTime(run) > routineRunTime(latest) ? run : latest, undefined);
}

export function routineRunLabel(run: RoutineRun): string {
  // a completed run with nothing for the person posted nothing (2026-10-22)
  if (run.status === "completed" && run.problems) return t("routines.status.completedWithProblems");
  if (run.status === "completed" && run.quiet) return t("routines.status.nothing_to_report");
  if (run.goalStatus) return t(`routines.goal.${run.goalStatus}`);
  const status = t(`routines.status.${run.status}`);
  return run.retried && run.status !== "queued" ? t(`routines.retried.${run.retried}`, { status }) : status;
}

/** 2026-11-01: a queued run's place among the queued runs of its bot,
 * oldest first (the scheduler starts them in that order). Null when the run
 * is not queued. */
export function routineQueuePosition(run: Pick<RoutineRun, "id" | "botId" | "status" | "createdAt">, runs: readonly Pick<RoutineRun, "id" | "botId" | "status" | "createdAt">[]): { position: number; count: number } | null {
  if (run.status !== "queued") return null;
  const queued = runs.filter((other) => other.status === "queued" && other.botId === run.botId);
  if (!queued.some((other) => other.id === run.id)) queued.push(run);
  queued.sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { position: queued.findIndex((other) => other.id === run.id) + 1, count: queued.length };
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
  if (run.status === "completed" && run.problems) return "text-warning";
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
 * first (2026-10-18). A paused, suspended or finished routine has no
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

/** 2026-10-26 (shared/routine-auto-pause.ts): "Paused after 5 failures in
 * a row", the words of the notice, the list and the history. */
export function routineAutoPausedText(failures: number): string {
  return failures === 1 ? t("routines.autoPause.pausedAfterOne") : t("routines.autoPause.pausedAfter", { count: failures });
}

/** The editor's choices, the routine's own count kept when it is another. */
export function routineAutoPauseChoices(current: number): number[] {
  const choices: number[] = [...ROUTINE_AUTO_PAUSE_CHOICES];
  if (!choices.includes(current)) choices.push(current);
  return choices.sort((a, b) => (a === 0 ? -1 : b === 0 ? 1 : a - b));
}

export function routineAutoPauseOption(count: number): string {
  if (count === 0) return t("routines.autoPause.never");
  return count === 1 ? t("routines.autoPause.optionOne") : t("routines.autoPause.option", { count });
}

/** #1516: "1 run" in the singular, the count of its week otherwise. */
export function routineWeekRunsText(weekRuns: { ok: number; total: number }): string {
  return t(weekRuns.total === 1 ? "routines.weekRunsOne" : "routines.weekRuns", weekRuns);
}

/** #1516: a one-time event's schedule says the very date and time its
 * details already show, so the details leave it out. */
export function scheduleRepeatsEventDate(schedule: { type: string; at?: number }, at: number): boolean {
  return schedule.type === "once" && schedule.at === at;
}

/** 2026-10-29: how long a run took, or has been going: "4 min", "1 h 12 min",
 * "38 s". Absent before it started. */
export function routineRunDuration(run: Pick<RoutineRun, "startedAt" | "finishedAt" | "status">, now = Date.now()): string | undefined {
  if (!run.startedAt) return undefined;
  const end = run.finishedAt ?? (["running", "waiting"].includes(run.status) ? now : undefined);
  if (end === undefined) return undefined;
  const seconds = Math.max(0, Math.round((end - run.startedAt) / 1000));
  if (seconds < 60) return t("routineRun.seconds", { count: seconds });
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return t("routineRun.minutes", { count: minutes });
  const rest = minutes % 60;
  return rest === 0 ? t("routineRun.hours", { count: Math.floor(minutes / 60) }) : t("routineRun.hoursMinutes", { hours: Math.floor(minutes / 60), minutes: rest });
}

/** The first line of what a run has to say: what it waits on, its error, its
 * report. A quiet run says it had nothing. */
export function routineRunPreview(run: Pick<RoutineRun, "status" | "quiet" | "attention" | "error" | "output" | "problems">): string {
  if (run.status === "completed" && run.problems) return run.problems.split("\n")[0]!.trim();
  if (run.status === "completed" && run.quiet) return t("routineRun.quiet");
  const text = run.attention || routineRunError(run.error) || run.output || "";
  const line = text.split("\n").map((part) => part.trim()).find((part) => part && !/^\|?\s*:?-{2,}/.test(part)) ?? "";
  const plain = line.startsWith("|") ? line.split("|").map((cell) => cell.trim()).filter(Boolean).join(" · ") : line;
  return plain.replace(/[*_`#>]+/g, "").trim();
}

/** A relative moment for the lists: "just now", "12 min ago", "yesterday", a
 * date past a week. */
export function routineRunAgo(at: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 45) return t("task.updated.justNow");
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return t("task.updated.minutes", { count: minutes });
  if (seconds < 86_400) return t("task.updated.hours", { count: Math.round(minutes / 60) });
  const days = Math.round(seconds / 86_400);
  if (days === 1) return t("task.updated.yesterday");
  if (seconds < 7 * 86_400) return t("task.updated.days", { count: days });
  return new Date(at).toLocaleDateString(activeLocale(), { month: "short", day: "numeric" });
}

export type RoutineStateTone = "active" | "paused" | "warning" | "info" | "neutral";

/** 2026-10-29: the one word a routine's page and list say about it: Running
 * (a run in flight), Paused after N failures, Paused: why (suspended),
 * Paused, Finished (a consumed one-shot), Active. */
export function routineState(routine: Routine, runs: readonly Pick<RoutineRun, "routineId" | "status">[] = []): { label: string; tone: RoutineStateTone } {
  const live = ["running", "waiting", "queued"].find((status) => runs.some((run) => run.routineId === routine.id && run.status === status));
  if (live) return { label: t(`routines.status.${live as "running" | "waiting" | "queued"}`), tone: "info" };
  if (!routine.enabled && routine.autoPaused) return { label: routineAutoPausedText(routine.autoPaused.failures), tone: "warning" };
  if (routine.suspended) return { label: t("routines.suspended", { reason: t(routine.suspended.reason === "person_out" ? "routines.suspendReason.person_out" : "routines.suspendReason.no_right") }), tone: "warning" };
  const state = routineScheduleState(routine);
  if (state === t("routines.finishedSchedule")) return { label: state, tone: "neutral" };
  if (!routine.enabled) return { label: state, tone: "paused" };
  if ((routine.failureStreak ?? 0) > 0) return { label: t("routines.scope.status.failing"), tone: "warning" };
  return { label: state, tone: "active" };
}

/** The list's "Next" words: the next run in a person's words, or why there
 * is none (paused, finished, waits for a change or a call). */
export function routineNextText(routine: Routine, now = Date.now()): string {
  if (routine.nextRunAt != null) return routineNextRunPhrase(routine.nextRunAt, now);
  if (routine.schedule.type === "webhook") return t("routines.trigger.webhook");
  if (routine.schedule.type === "event") return t("routineRun.onEvent");
  if (!routine.enabled) return routineScheduleState(routine);
  return t("routines.noNextRun");
}
