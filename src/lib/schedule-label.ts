import { atLocalTime } from "@/lib/routine-calendar";
import type { RoutineSchedule } from "@/lib/routines";
import { activeLocale, t } from "@/lib/i18n";
import { cronScheduleLabel } from "../../shared/cron-label";

/** Cron wording follows the app language: French (Québec) or English. */
export function cronLocale(): "fr" | "en" {
  return activeLocale().toLowerCase().startsWith("fr") ? "fr" : "en";
}

/** Short weekday names (index 0 = Sunday) in the active language, read at
 * call time so they follow a language change at render. */
export function dayNames(): string[] {
  const format = new Intl.DateTimeFormat(activeLocale(), { weekday: "short" });
  // 2023-01-01 was a Sunday.
  return Array.from({ length: 7 }, (_, day) => format.format(new Date(2023, 0, 1 + day)));
}

export function niceTime(at: number): string {
  return new Date(at).toLocaleTimeString(activeLocale(), { hour: "numeric", minute: "2-digit" });
}

export function niceDate(at: number): string {
  return new Date(at).toLocaleDateString(activeLocale(), { weekday: "long", month: "long", day: "numeric" });
}

/** A change's timestamp for a list row: the time alone if it happened
 * today, else the date — one rule shared by the Overview's recent-changes
 * card and the History section so the same row never reads two ways. */
export function whenLabel(at: number): string {
  const date = new Date(at);
  const sameDay = new Date().toDateString() === date.toDateString();
  return sameDay ? niceTime(at) : date.toLocaleDateString(activeLocale(), { month: "short", day: "numeric" });
}

export function durationLabel(minutes: number): string {
  if (minutes < 60) return t("schedule.duration.min", { minutes });
  if (minutes % 60 === 0) return t("schedule.duration.hr", { hours: minutes / 60 });
  return t("schedule.duration.hrMin", { hours: Math.floor(minutes / 60), minutes: minutes % 60 });
}

export function intervalLabel(minutes: number): string {
  if (minutes < 60) return t("computer.routine.everyMin", { minutes });
  if (minutes === 60) return t("schedule.everyHour");
  if (minutes % 60 === 0) return t("schedule.everyHr", { hours: minutes / 60 });
  return t("schedule.everyHrMin", { hours: Math.floor(minutes / 60), minutes: minutes % 60 });
}

function intervalRestrictions(schedule: Extract<RoutineSchedule, { type: "interval" }>): string[] {
  const details: string[] = [];
  if (schedule.weekdays && schedule.weekdays.length < 7) {
    details.push(schedule.weekdays.join(",") === "1,2,3,4,5"
      ? t("schedule.weekdays")
      : schedule.weekdays.map((day) => dayNames()[day]).join(", "));
  }
  if (schedule.window) {
    const wallTime = (time: string) => {
      const [hour, minute] = time.split(":").map(Number);
      return niceTime(new Date(2000, 0, 1, hour, minute).getTime());
    };
    details.push(`${wallTime(schedule.window.start)}–${wallTime(schedule.window.end)}`);
  }
  if (schedule.endsAt != null) {
    details.push(t("schedule.until", { date: new Date(schedule.endsAt).toLocaleDateString(activeLocale(), { month: "short", day: "numeric", year: "numeric" }) }));
  }
  return details;
}

function windowNote(schedule: { type: string; timing?: string; windowEarlyMinutes?: number; windowLateMinutes?: number }): string | null {
  if (schedule.timing !== "flexible") return null;
  return t("schedule.windowNote", { early: schedule.windowEarlyMinutes ?? 0, late: schedule.windowLateMinutes ?? 0 });
}

export function scheduleLabel(schedule: RoutineSchedule | { type: "once"; at: number } | { type: "daily"; time: string; weekdays: number[] }): string {
  if (schedule.type === "cron") {
    const note = windowNote(schedule);
    const label = cronScheduleLabel(schedule, cronLocale());
    return note ? t("schedule.aroundTheTime", { label, note }) : label;
  }
  if (schedule.type === "once") return `${niceDate(schedule.at)}, ${niceTime(schedule.at)}`;
  if (schedule.type === "interval") {
    const note = windowNote(schedule);
    const label = [intervalLabel(schedule.everyMinutes), ...intervalRestrictions(schedule)].join(" · ");
    return note ? t("schedule.aroundTheTime", { label, note }) : label;
  }
  if (schedule.type === "webhook") return t("schedule.incomingWebhook");
  if (schedule.type === "event") return t("schedule.incomingEmail");
  if (schedule.type === "limit_reset") {
    return schedule.at === null
      ? t("schedule.limitReset", { engine: schedule.engine })
      : t("schedule.limitResetAt", { engine: schedule.engine, time: niceTime(schedule.at) });
  }
  const days = schedule.weekdays;
  const label = days.length === 7
    ? t("computer.routine.everyDay")
    : days.join(",") === "1,2,3,4,5"
      ? t("schedule.everyWeekday")
      : days.length === 1
        ? t("schedule.weeklyOn", { day: dayNames()[days[0]!]! })
        : days.map((day: number) => dayNames()[day]).join(", ");
  const time = niceTime(atLocalTime(Date.now(), schedule.time));
  const note = windowNote(schedule);
  return note ? t("schedule.dailyAround", { label, time, note }) : t("schedule.dailyAt", { label, time });
}

/** "every 5 minutes", "every hour", "every 1 hour 30 minutes". */
function intervalCadence(minutes: number): string {
  if (minutes === 60) return t("schedule.sentence.everyHour");
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const hoursText = hours === 1 ? t("schedule.sentence.hour1") : t("schedule.sentence.hours", { count: hours });
  const minutesText = rest === 1 ? t("schedule.sentence.minute1") : t("schedule.sentence.minutes", { count: rest });
  const span = hours === 0 ? minutesText : rest === 0 ? hoursText : `${hoursText} ${minutesText}`;
  return t("schedule.sentence.every", { span });
}

export function scheduleSentence(schedule: RoutineSchedule): string {
  const note = windowNote(schedule);
  if (schedule.type === "cron") {
    const label = cronScheduleLabel(schedule, cronLocale());
    return note ? t("schedule.aroundTheTime", { label, note }) : label;
  }
  if (schedule.type === "interval") {
    const cadence = intervalCadence(schedule.everyMinutes);
    const sentence = [cadence, ...intervalRestrictions(schedule)].join(" · ");
    return note ? `${sentence} · around the time ${note}` : sentence;
  }
  if (schedule.type === "once") {
    return t("schedule.sentence.once", { date: niceDate(schedule.at), time: niceTime(schedule.at) });
  }
  if (schedule.type === "webhook") return t("schedule.sentence.webhook");
  if (schedule.type === "event") return t("schedule.sentence.email");
  if (schedule.type === "limit_reset") {
    return schedule.at === null
      ? t("schedule.sentence.limitReset", { engine: schedule.engine })
      : t("schedule.sentence.limitResetAt", { engine: schedule.engine, time: niceTime(schedule.at) });
  }
  // type === "daily"
  const days = schedule.weekdays;
  const timeStr = niceTime(atLocalTime(Date.now(), schedule.time));
  const when = note ? t("schedule.sentence.around", { time: timeStr, note }) : t("schedule.sentence.at", { time: timeStr });

  if (days.length === 7) {
    return t("schedule.sentence.everyDay", { when });
  }
  if (days.join(",") === "1,2,3,4,5") {
    return t("schedule.sentence.everyWeekday", { when });
  }
  if (days.length === 1) {
    return t("schedule.sentence.weeklyOn", { day: dayNames()[days[0]!]!, when });
  }

  // Custom multi-day selection
  return `${days.map((day) => dayNames()[day]).join(", ")} ${when}`;
}

/** The compact line of a routine list row (the full label, with its zone,
 * stays in the tooltip and the detail): "Weekdays around 8:30 AM", "Every
 * Monday around 8:06 AM", "Once October 29 at 5:57 PM", "Every hour", "When a
 * webhook fires". The time follows the locale (12 h in English, 24 h in
 * French); the zone shows only when it is not the person's own. A schedule
 * that does not reduce to one of these keeps its full label. */
export function scheduleLabelCompact(schedule: RoutineSchedule | { type: "once"; at: number } | { type: "daily"; time: string; weekdays: number[] }): string {
  const locale = activeLocale();
  const clock = (hour: number, minute: number) => new Date(2000, 0, 1, hour, minute).toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
  if (schedule.type === "webhook") return t("schedule.compact.webhook");
  if (schedule.type === "event") return t("schedule.compact.email");
  if (schedule.type === "once") {
    const sameYear = new Date(schedule.at).getFullYear() === new Date().getFullYear();
    const date = new Date(schedule.at).toLocaleDateString(locale, sameYear ? { month: "long", day: "numeric" } : { month: "long", day: "numeric", year: "numeric" });
    return t("schedule.compact.once", { date, time: niceTime(schedule.at) });
  }
  if (schedule.type === "interval" && schedule.everyMinutes === 60 && !schedule.weekdays && !schedule.window && schedule.endsAt == null) return t("schedule.everyHour");
  if (schedule.type !== "cron") return scheduleLabel(schedule);
  const [minute, hour, day, month, weekday] = schedule.expression.trim().split(/\s+/);
  if (!/^\d+$/.test(minute ?? "") || !/^\d+$/.test(hour ?? "") || Number(minute) > 59 || Number(hour) > 23 || day !== "*" || month !== "*") return scheduleLabel(schedule);
  const time = clock(Number(hour), Number(minute));
  let label: string | null = null;
  if (weekday === "*") label = t("schedule.compact.dailyAround", { time });
  else if (weekday === "1-5" || weekday?.toUpperCase() === "MON-FRI") label = t("schedule.compact.weekdaysAround", { time });
  else if (/^[0-7]$/.test(weekday ?? "")) {
    const dayName = new Date(2023, 0, 1 + (Number(weekday) % 7)).toLocaleDateString(locale, { weekday: "long" });
    label = t("schedule.compact.weeklyAround", { day: dayName, time });
  }
  if (!label) return scheduleLabel(schedule);
  const local = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return schedule.timeZone && schedule.timeZone !== local ? t("schedule.compact.zone", { label, zone: schedule.timeZone }) : label;
}
