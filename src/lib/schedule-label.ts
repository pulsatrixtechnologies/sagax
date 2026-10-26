import { atLocalTime } from "@/lib/routine-calendar";
import type { RoutineSchedule } from "@/lib/routines";
import { activeLocale } from "@/lib/i18n";
import { cronRawText, cronScheduleLabel } from "../../shared/cron-label";

/** Cron wording follows the app language: French (Québec) or English. */
export function cronLocale(): "fr" | "en" {
  return activeLocale().toLowerCase().startsWith("fr") ? "fr" : "en";
}

/** The exact expression (and zone) of a cron schedule, for a tooltip or
 * Copy; null for every other kind of schedule. */
export function scheduleRawCron(schedule: RoutineSchedule | { type: string }): string | null {
  return schedule.type === "cron" ? cronRawText(schedule as Extract<RoutineSchedule, { type: "cron" }>) : null;
}

export const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export function niceTime(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function niceDate(at: number): string {
  return new Date(at).toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
}

/** A change's timestamp for a list row: the time alone if it happened
 * today, else the date — one rule shared by the Overview's recent-changes
 * card and the History section so the same row never reads two ways. */
export function whenLabel(at: number): string {
  const date = new Date(at);
  const sameDay = new Date().toDateString() === date.toDateString();
  return sameDay ? niceTime(at) : date.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function durationLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  if (minutes % 60 === 0) return `${minutes / 60} hr`;
  return `${Math.floor(minutes / 60)} hr ${minutes % 60} min`;
}

export function intervalLabel(minutes: number): string {
  if (minutes < 60) return `Every ${minutes} min`;
  if (minutes === 60) return "Every hour";
  if (minutes % 60 === 0) return `Every ${minutes / 60} hr`;
  return `Every ${Math.floor(minutes / 60)} hr ${minutes % 60} min`;
}

function intervalRestrictions(schedule: Extract<RoutineSchedule, { type: "interval" }>): string[] {
  const details: string[] = [];
  if (schedule.weekdays && schedule.weekdays.length < 7) {
    details.push(schedule.weekdays.join(",") === "1,2,3,4,5"
      ? "weekdays"
      : schedule.weekdays.map((day) => DAY_NAMES[day]).join(", "));
  }
  if (schedule.window) {
    const wallTime = (time: string) => {
      const [hour, minute] = time.split(":").map(Number);
      return niceTime(new Date(2000, 0, 1, hour, minute).getTime());
    };
    details.push(`${wallTime(schedule.window.start)}–${wallTime(schedule.window.end)}`);
  }
  if (schedule.endsAt != null) {
    details.push(`until ${new Date(schedule.endsAt).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}`);
  }
  return details;
}

function windowNote(schedule: { type: string; timing?: string; windowEarlyMinutes?: number; windowLateMinutes?: number }): string | null {
  if (schedule.timing !== "flexible") return null;
  return `(-${schedule.windowEarlyMinutes ?? 0}/+${schedule.windowLateMinutes ?? 0} min)`;
}

export function scheduleLabel(schedule: RoutineSchedule | { type: "once"; at: number } | { type: "daily"; time: string; weekdays: number[] }): string {
  if (schedule.type === "cron") {
    const note = windowNote(schedule);
    const label = cronScheduleLabel(schedule, cronLocale());
    return note ? `${label} · around the time ${note}` : label;
  }
  if (schedule.type === "once") return `${niceDate(schedule.at)}, ${niceTime(schedule.at)}`;
  if (schedule.type === "interval") {
    const note = windowNote(schedule);
    const label = [intervalLabel(schedule.everyMinutes), ...intervalRestrictions(schedule)].join(" · ");
    return note ? `${label} · around the time ${note}` : label;
  }
  const days = schedule.weekdays;
  const label = days.length === 7
    ? "Every day"
    : days.join(",") === "1,2,3,4,5"
      ? "Every weekday"
      : days.length === 1
        ? `Weekly on ${DAY_NAMES[days[0]!]}`
        : days.map((day) => DAY_NAMES[day]).join(", ");
  const time = niceTime(atLocalTime(Date.now(), schedule.time));
  const note = windowNote(schedule);
  return note ? `${label} around ${time} ${note}` : `${label} at ${time}`;
}

export function scheduleSentence(schedule: RoutineSchedule): string {
  const note = windowNote(schedule);
  if (schedule.type === "cron") {
    const label = cronScheduleLabel(schedule, cronLocale());
    return note ? `${label} · around the time ${note}` : label;
  }
  if (schedule.type === "interval") {
    const label = intervalLabel(schedule.everyMinutes);
    // Convert "Every X min" → "every X minutes", "Every hour" → "every hour", etc.
    const lowercase = label.replace(/^Every /, "every ");
    // Replace "N min" with "N minutes" (avoid replacing if already "minutes")
    const withMinutes = lowercase.replace(/(\d+) min(?!ute)/g, "$1 minutes");
    // Replace "1 hr" with "1 hour" and "N hr" with "N hours" (but leave "every hour" unchanged)
    const cadence = withMinutes.replace(/(\d+) hr(?!our)/g, (_match, num) => {
      return num === "1" ? "1 hour" : `${num} hours`;
    });
    const sentence = [cadence, ...intervalRestrictions(schedule)].join(" · ");
    return note ? `${sentence} · around the time ${note}` : sentence;
  }
  if (schedule.type === "once") {
    return `once on ${niceDate(schedule.at)}, ${niceTime(schedule.at)}`;
  }
  // type === "daily"
  const days = schedule.weekdays;
  const timeStr = niceTime(atLocalTime(Date.now(), schedule.time));
  const when = note ? `around ${timeStr} ${note}` : `at ${timeStr}`;

  if (days.length === 7) {
    return `every day ${when}`;
  }
  if (days.join(",") === "1,2,3,4,5") {
    return `every weekday ${when}`;
  }
  if (days.length === 1) {
    return `weekly on ${DAY_NAMES[days[0]!]} ${when}`;
  }

  // Custom multi-day selection
  return `${days.map((day) => DAY_NAMES[day]).join(", ")} ${when}`;
}
