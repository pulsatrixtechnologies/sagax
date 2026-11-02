// A routine's schedule in words for the console (the label Sagax's own
// calendar shows, server side and in the server's time zone): "Every hour",
// "Every weekday at 09:00", "Custom schedule", "Once on 2026-10-09 14:00".
import { cronScheduleLabel } from "../shared/cron-label.ts";
import type { RoutineSchedule } from "./routines.ts";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function every(minutes: number): string {
  if (minutes < 60) return `Every ${minutes} min`;
  if (minutes === 60) return "Every hour";
  if (minutes % 60 === 0) return `Every ${minutes / 60} hr`;
  return `Every ${Math.floor(minutes / 60)} hr ${minutes % 60} min`;
}

function days(weekdays: readonly number[]): string {
  if (weekdays.length === 7) return "Every day";
  if (weekdays.join(",") === "1,2,3,4,5") return "Every weekday";
  return weekdays.map((day) => DAYS[day] ?? String(day)).join(", ");
}

const iso = (at: number) => new Date(at).toISOString().slice(0, 16).replace("T", " ");

export function routineScheduleLabel(schedule: RoutineSchedule): string {
  switch (schedule.type) {
    case "cron": return cronScheduleLabel(schedule);
    case "once": return `Once on ${iso(schedule.at)} UTC`;
    case "daily": return `${days(schedule.weekdays)} at ${schedule.time}`;
    case "interval": {
      const parts = [every(schedule.everyMinutes)];
      if (schedule.weekdays && schedule.weekdays.length < 7) parts.push(days(schedule.weekdays).toLowerCase());
      if (schedule.window) parts.push(`from ${schedule.window.start} to ${schedule.window.end}`);
      if (schedule.endsAt != null) parts.push(`until ${iso(schedule.endsAt)} UTC`);
      return parts.join(", ");
    }
    case "webhook": return "Incoming webhook";
    case "event": return "Incoming email";
    case "limit_reset":
      return schedule.at === null
        ? `When ${schedule.engine} limit resets`
        : `When ${schedule.engine} limit resets (next ${iso(schedule.at)} UTC)`;
    default: {
      const unexpected: never = schedule;
      return unexpected;
    }
  }
}
