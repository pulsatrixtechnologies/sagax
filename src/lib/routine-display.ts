import { routineReadinessLine } from "./routine-readiness";
import type { RoutineReadinessCheck } from "../../shared/routine-readiness";
import type { Routine, RoutineRun } from "./routines";
import { activeLocale, t } from "./i18n";
import { scheduleLabel } from "./schedule-label";
import { ROUTINE_AUTO_PAUSE_CHOICES } from "../../shared/routine-auto-pause";
import { readableRoutineProblems } from "../../shared/routine-problems";
import { reportBrief, routineResultParts } from "../../shared/routine-result";
import type { RoutineRunCardData } from "../../shared/routine-run";
import type { RoutineNeedsPerson } from "../../shared/routines";

/** A completed run's problems as a person reads them: a teammate's quoted
 * last message as plain text, rows stored before 2026-11-03 included. */
export function routineRunProblems(run: Pick<RoutineRun, "status" | "problems">): string {
  return run.status === "completed" && run.problems?.trim() ? readableRoutineProblems(run.problems) : "";
}

/** #3581: a result's one or two lines on its card: the brief the server
 * wrote, else the same function over the report (a card stored before it). */
export function routineRunBrief(run: Pick<RoutineRunCardData, "brief" | "summary">): string {
  return run.brief?.trim() || reportBrief(run.summary, "end");
}

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
  // 2026-11-02: a limit sent the run on to another engine at once; it never
  // waited for a reset, whatever its one retry is recorded as.
  if (run.limitTakeovers && run.status !== "queued") return t("routines.retried.limitSwitched", { status });
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

/** A run's state colour, the one rule for every surface that tells it (the
 * routine log, the panel's clock, the chat's problem row #4161). */
export function routineRunTone(run: Pick<RoutineRun, "status" | "goalStatus" | "problems" | "quiet"> | Pick<RoutineRunCardData, "status" | "goalStatus" | "problems">): string {
  if (run.status === "waiting" || ["needs-input", "limit-reached", "paused"].includes(run.goalStatus ?? "")) return "text-warning";
  if (["failed", "missed"].includes(run.status) || ["failed", "blocked"].includes(run.goalStatus ?? "")) return "text-danger";
  // 2026-11-03: blocked waits on something; never the success green.
  if (run.status === "blocked") return "text-warning";
  if (run.status === "running") return "text-accent";
  if (run.status === "completed" && run.problems) return "text-warning";
  if (run.status === "completed" && "quiet" in run && run.quiet) return "text-ink-secondary";
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

/** A run's final words in plain sentences (2026-11-03, owner report: "the
 * only result is a {"). Prose stays as written; a RUN_STATUS line or a JSON
 * report (shared/routine-result.ts) becomes what was done, what is blocked
 * and why, and what the person must do; any other structure a short excerpt
 * with its pretty-printed whole in `details` for "Show details". Never a
 * lone brace. */
export function routineResultText(raw: string | undefined): { text: string; details?: string; structured: boolean } {
  const parts = routineResultParts(raw);
  const lines: string[] = [];
  if (parts.status) {
    const reason = parts.reason ?? parts.blocked[0] ?? "";
    if (reason) lines.push(t(`routineResult.${parts.status}`, { reason }));
  }
  if (parts.summary) lines.push(parts.summary);
  if (parts.done.length) lines.push(t("routineResult.done", { items: parts.done.join("; ") }));
  const blocked = parts.status && !parts.reason ? parts.blocked.slice(1) : parts.blocked;
  if (blocked.length) lines.push(t("routineResult.blockedItems", { items: blocked.join("; ") }));
  if (parts.todo.length) lines.push(t("routineResult.todo", { items: parts.todo.join("; ") }));
  if (!lines.length && parts.excerpt) lines.push(parts.excerpt);
  if (!lines.length && parts.structured) lines.push(t("routineResult.structured"));
  return { text: lines.join("\n"), ...(parts.structured && parts.details ? { details: parts.details } : {}), structured: parts.structured };
}

/** The reason in a run's error or attention, in plain words; empty when it
 * says nothing a person can read (a "{" kept by an older server). */
function plainReason(text: string | undefined): string {
  const said = routineRunError(text);
  if (!said?.trim()) return "";
  const parts = routineResultParts(said);
  if (!parts.structured) return said.split("\n").map((line) => line.trim()).find(Boolean) ?? "";
  return parts.reason ?? parts.summary ?? parts.blocked[0] ?? parts.excerpt ?? "";
}

/** A blocked run's one line: "Blocked: <why>", the teammate it waits on, or
 * a plain line when its reason was lost. The run list, the run's bubble and
 * its chat card all show this. */
export function routineRunBlockedLine(run: { error?: string; attention?: string; readiness?: RoutineReadinessCheck[]; handedTo?: ReadonlyArray<{ name?: string; status: string }> }): string {
  const blocker = run.readiness?.find(check => !check.ok);
  const reason = (blocker ? routineReadinessLine(blocker) : "") || plainReason(run.error) || plainReason(run.attention);
  if (reason) return t("routineRun.blockedLine", { reason: reason.replace(/^blocked\s*[:—-]\s*/i, "") });
  const waitingOn = run.handedTo?.find((entry) => !["completed", "failed", "cancelled", "expired"].includes(entry.status));
  if (waitingOn) return t("routineRun.blockedWaitingFor", { name: waitingOn.name || t("routineRun.aTeammate") });
  return t("routineRun.blockedNoReason");
}

/** What a run has to say, the same for its row, its bubble and its card:
 * its problems, that it was quiet, why it is blocked, what it waits on, its
 * error, or its report in plain sentences. */
export function routineRunSummary(run: Pick<RoutineRun, "status" | "quiet" | "attention" | "error" | "output" | "problems" | "handedTo" | "readiness">): { text: string; details?: string } {
  if (run.status === "completed" && run.problems) return { text: routineRunProblems(run) };
  if (run.status === "completed" && run.quiet) return { text: t("routineRun.quiet") };
  if (run.status === "blocked") return { text: routineRunBlockedLine(run) };
  const { text, details } = routineResultText(run.attention || routineRunError(run.error) || run.output || "");
  return details ? { text, details } : { text };
}

/** The first line of what a run has to say (routineRunSummary). */
export function routineRunPreview(run: Pick<RoutineRun, "status" | "quiet" | "attention" | "error" | "output" | "problems" | "handedTo" | "readiness">): string {
  const text = routineRunSummary(run).text;
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

/** The sentence that needs the person (#4098): the bot's own words, else
 * the app's words for that kind. The Outcomes tab and the bot panel's
 * Suggestions card say it the same way. */
export function needSentence(need: RoutineNeedsPerson): string {
  if (need.text.trim()) return need.text.trim();
  switch (need.kind) {
    case "paused": return routineAutoPausedText(need.failures ?? 1);
    case "problem": return t("outcomes.needs.problem");
    case "goal": return need.goal === "stalled" ? t("outcomes.needs.goalStalled", { count: need.checks ?? 3 }) : t("outcomes.needs.goalExpired");
    default: return t("outcomes.needs.question");
  }
}
