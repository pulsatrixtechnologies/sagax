import { t } from "@/lib/i18n";
import {
  addDays,
  atLocalTime,
  startOfDay,
  toLocalTimeInput,
} from "@/lib/routine-calendar";
import type { CalendarCall } from "@/lib/calendar-calls";
import type { Routine, RoutineRunStatus, RoutineSchedule, RoutineScheduleInput } from "@/lib/routines";
import type { MausState } from "@/lib/mascot";
import type { Bot, Group } from "@/state/store";
import { scheduleDraftFor } from "@/components/routines/schedule-editor";
import { ALL_DAYS, WEEKDAYS } from "./constants";
import type { CalendarRecurrenceChoice, CallOccurrence, IntervalDayChoice, RecurrenceChoice } from "./types";

export function activeRoomMembers(group: Group | undefined, bots: Bot[]): Bot[] {
  if (!group) return [];
  return group.memberIds.flatMap((id) => {
    const bot = bots.find((candidate) => candidate.id === id);
    return bot && !bot.hidden ? [bot] : [];
  });
}

export function roomCanRunGoal(group: Group): boolean {
  return !group.dm;
}


export function nextHour(): number {
  const date = new Date(Date.now() + 60 * 60_000);
  date.setMinutes(0, 0, 0);
  return date.getTime();
}

/** The moment the editor opens a routine on: its one-time date, its next
 * run, or the next hour. */
export function routineEditorAt(routine: Routine | undefined): number {
  return routine?.schedule.type === "once"
    ? routine.schedule.at
    : routine?.schedule.type === "daily"
      ? atLocalTime(Date.now(), routine.schedule.time)
      : routine?.schedule.type === "interval"
        ? routine.schedule.anchorAt
      : routine?.schedule.type === "cron"
        ? routine.nextRunAt ?? nextHour()
      : nextHour();
}

/** "15 minutes", "2 hours": an interval preset in words. */
export function intervalSpan(minutes: number): string {
  return minutes < 60 ? t("scheduleEditor.minutesN", { count: minutes }) : minutes === 60 ? t("scheduleEditor.hour1") : t("scheduleEditor.hoursN", { count: minutes / 60 });
}

export function sameDays(left: readonly number[] | undefined, right: readonly number[]): boolean {
  return Boolean(left && left.length === right.length && left.every((day, index) => day === right[index]));
}

export function intervalDayChoice(schedule: RoutineSchedule | CalendarCall["schedule"]): IntervalDayChoice {
  if (schedule.type !== "interval" || !schedule.weekdays || schedule.weekdays.length === 7) return "every-day";
  return sameDays(schedule.weekdays, WEEKDAYS) ? "weekdays" : "custom";
}

export function endOfLocalDate(dateInput: string): number {
  const date = new Date(`${dateInput}T00:00`);
  date.setHours(23, 59, 59, 999);
  return date.getTime();
}

export function recurrenceFor(schedule: RoutineSchedule | CalendarCall["schedule"], at: number, routine: boolean): RecurrenceChoice {
  if (schedule.type === "once") return "none";
  // 2026-10-29: a routine started by a webhook or an email says so.
  if (schedule.type === "webhook") return routine ? "webhook" : "none";
  if (schedule.type === "event") return routine ? (schedule.source === "github" ? "github" : "email") : "none";
  if (schedule.type === "interval") return "interval";
  if (schedule.type === "cron") {
    const { draft, fits } = scheduleDraftFor(schedule, at);
    return !fits ? "advanced" : draft.model.frequency === "every" ? "interval" : "pattern";
  }
  if (schedule.type === "limit_reset") return "limit_reset";
  if (routine) return "pattern";
  if (schedule.weekdays.length === 7) return "daily";
  if (schedule.weekdays.join(",") === "1,2,3,4,5") return "weekdays";
  if (schedule.weekdays.length === 1 && schedule.weekdays[0] === new Date(at).getDay()) return "weekly";
  return "custom";
}

export function makeCalendarSchedule(choice: CalendarRecurrenceChoice, at: number, weekdays: number[]): CalendarCall["schedule"] {
  if (choice === "none") return { type: "once", at };
  const selected = choice === "daily"
    ? ALL_DAYS
    : choice === "weekdays"
      ? WEEKDAYS
      : choice === "weekly"
        ? [new Date(at).getDay()]
        : weekdays;
  return { type: "daily", time: toLocalTimeInput(at), weekdays: [...selected].sort() };
}

export function makeRoutineSchedule(
  choice: Exclude<RecurrenceChoice, "pattern" | "advanced" | "webhook" | "github" | "email" | "limit_reset">,
  at: number,
  weekdays: number[],
  everyMinutes: number,
  interval: {
    anchorAt: number;
    weekdays: number[] | null;
    window: { start: string; end: string } | null;
    endsAt: number | null;
  },
): RoutineScheduleInput {
  if (choice === "interval") return { type: "interval", everyMinutes, ...interval };
  return makeCalendarSchedule(choice, at, weekdays);
}

export function projectCalls(calls: CalendarCall[], from: number, to: number): CallOccurrence[] {
  const items: CallOccurrence[] = [];
  for (const call of calls) {
    if (call.schedule.type === "once") {
      if (call.schedule.at >= from && call.schedule.at < to) {
        items.push({ id: `call-${call.id}-${call.schedule.at}`, at: call.schedule.at, durationMinutes: call.durationMinutes, call });
      }
      continue;
    }
    for (let day = startOfDay(from); day < to; day = addDays(day, 1)) {
      if (!call.schedule.weekdays.includes(new Date(day).getDay())) continue;
      const at = atLocalTime(day, call.schedule.time);
      if (at >= from && at < to && at >= call.createdAt) {
        items.push({ id: `call-${call.id}-${at}`, at, durationMinutes: call.durationMinutes, call });
      }
    }
  }
  return items.sort((left, right) => left.at - right.at);
}

export function statusState(status: RoutineRunStatus): MausState {
  if (status === "running") return "working";
  if (status === "waiting") return "curious";
  if (status === "completed") return "proud";
  if (status === "failed" || status === "missed") return "sad";
  if (status === "cancelled") return "sleeping";
  return "drowsy";
}
