// #3695: a routine that repeats more than once a day reports by its streak.
// The person does not read each of its runs: a finished run that only says
// how it went writes nothing in their chat; a problem that lasts
// ROUTINE_PROBLEM_STREAK_TOLD runs in a row is told once, as one summary
// card, and that same card says when it works again. A routine that runs
// once a day or less often (a briefing, a weekly report) reports each run.
import { createCronRunPreview, type RoutineCronSchedule } from "./routine-schedule.ts";
import { parseClock } from "./schedule-model.ts";

/** How many runs in a row must end with problems before the person is told
 * (the owner's "after an error has occurred x times", 2026-11-11). */
export const ROUTINE_PROBLEM_STREAK_TOLD = 3;

const DAY_MINUTES = 24 * 60;
/** Enough of a cron's next runs to see two on one day when it has them. */
const CRON_SAMPLE = 48;
const cronVerdicts = new Map<string, boolean>();

function localDay(at: number, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
  } catch {
    return new Date(at).toISOString().slice(0, 10);
  }
}

function cronRepeatsWithinDay(schedule: RoutineCronSchedule, after: number): boolean {
  const key = `${schedule.timeZone}|${schedule.expression}`;
  const known = cronVerdicts.get(key);
  if (known !== undefined) return known;
  let verdict = false;
  try {
    const days = new Set<string>();
    for (const at of createCronRunPreview(schedule)(after, CRON_SAMPLE)) {
      const day = localDay(at, schedule.timeZone);
      if (days.has(day)) { verdict = true; break; }
      days.add(day);
    }
  } catch {
    verdict = false;
  }
  if (cronVerdicts.size > 500) cronVerdicts.clear();
  cronVerdicts.set(key, verdict);
  return verdict;
}

/** The local minute of the day an instant falls on, in `timeZone` or the
 * clock's own zone. */
function localMinuteOfDay(at: number, timeZone: string | undefined): number {
  if (timeZone) {
    try {
      const parts = new Intl.DateTimeFormat("en-US", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(at);
      const part = (type: string) => Number(parts.find((entry) => entry.type === type)?.value ?? 0);
      return part("hour") * 60 + part("minute");
    } catch { /* an unknown zone reads as the clock's own */ }
  }
  const date = new Date(at);
  return date.getHours() * 60 + date.getMinutes();
}

/** Whether an interval under a day fits two runs on one day. Without a
 * window it does. With a window [start, end), two aligned starts fit only
 * when the window is longer than the interval; when the interval divides a
 * day its starts fall on the same minutes every day, so the anchor says
 * whether a second one lands in the window. */
function intervalRepeatsWithinDay(fields: { everyMinutes?: unknown; anchorAt?: unknown; window?: unknown }, timeZone: string | undefined): boolean {
  const every = fields.everyMinutes;
  if (typeof every !== "number" || !(every > 0) || every >= DAY_MINUTES) return false;
  const window = fields.window as { start?: unknown; end?: unknown } | undefined;
  if (!window || typeof window.start !== "string" || typeof window.end !== "string") return true;
  const start = parseClock(window.start);
  const end = parseClock(window.end);
  if (!start || !end) return true;
  const from = start.hour * 60 + start.minute;
  const to = end.hour * 60 + end.minute;
  if (to - from <= every) return false;
  if (DAY_MINUTES % every !== 0 || typeof fields.anchorAt !== "number") return true;
  const offset = localMinuteOfDay(fields.anchorAt, timeZone) % every;
  const first = from + ((((offset - from) % every) + every) % every);
  return first + every < to;
}

/** Whether a routine's schedule can run it more than once on a day: an
 * interval under a day whose window fits two runs, a cron that names two or
 * more times on one day, or a run at every usage-limit reset (a short
 * usage window resets several times a day). A daily time, a single date, a
 * run at the next reset only and a trigger (a webhook, a mail, a GitHub
 * event) never do: they are not a clock repeat. `timeZone` is the zone an
 * interval's window is read in (absent: the clock's own). */
export function routineRepeatsWithinDay(schedule: { type: string } | null | undefined, after = Date.now(), timeZone?: string): boolean {
  if (!schedule) return false;
  const fields = schedule as { type: string; everyMinutes?: unknown; anchorAt?: unknown; window?: unknown; expression?: unknown; timeZone?: unknown; repeat?: unknown };
  switch (fields.type) {
    case "interval":
      return intervalRepeatsWithinDay(fields, timeZone);
    case "cron":
      return typeof fields.expression === "string" && typeof fields.timeZone === "string"
        && cronRepeatsWithinDay(fields as RoutineCronSchedule, after);
    case "limit_reset":
      return fields.repeat === "every_reset";
    default:
      return false;
  }
}
