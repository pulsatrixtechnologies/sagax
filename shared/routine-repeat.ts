// #3695, #3990: a routine reports by its streak, whatever starts it (a
// schedule, a trigger such as a webhook, a new email or a teammate's
// message, a proactive watch) and however often it runs. The person does
// not read each of its runs: a finished run that only says how it went
// writes nothing in their chat; a problem is told once, as one summary
// card, and that same card says when it works again: at its first run with
// a problem for a routine that runs at most once a day, once it lasts
// ROUTINE_PROBLEM_STREAK_TOLD runs in a row for one that can run several
// times a day (routineProblemToldAt). What else reaches the
// chat from a routine: a request that waits on the person, items only they
// can do, a run they started themselves, and the result of a routine they
// set to post its results when it runs on a clock once a day or less often
// (a briefing, a weekly report). Every run stays in the routine's run log.
import { createCronRunPreview, type RoutineCronSchedule } from "./routine-schedule.ts";
import { parseClock } from "./schedule-model.ts";
import { isTriggerSchedule } from "./routines.ts";

/** How many runs in a row of a routine that can run several times a day
 * must end with problems before the person is told (the owner's "after an
 * error has occurred x times", 2026-11-11). */
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

/** #3990: whether a run reports by its routine's streak (nothing in the
 * chat but the one summary). Every run but one a person started and a team
 * goal's run (its goal card is its own). */
export function routineReportsByStreak(run: { startedBy?: string | null; target?: string | null }): boolean {
  return run.startedBy !== "person" && run.target !== "room-goal";
}

/** #3990: whether a routine can run several times a day: on a trigger (a
 * webhook, a new email, a GitHub event) or on a clock that repeats within a
 * day (routineRepeatsWithinDay). A daily, weekly or monthly time, a single
 * date and no schedule do not. */
export function routineRunsSeveralTimesADay(schedule: { type: string; source?: unknown } | null | undefined, after = Date.now(), timeZone?: string): boolean {
  return isTriggerSchedule(schedule) || routineRepeatsWithinDay(schedule, after, timeZone);
}

/** #3990: after how many runs in a row with a problem the person gets the
 * routine's one summary. A routine that can run several times a day waits
 * ROUTINE_PROBLEM_STREAK_TOLD runs (one slip is not worth a card); one that
 * runs at most once a day tells at its first run with a problem, since
 * waiting would mean days of silence on a real failure. */
export function routineProblemToldAt(schedule: { type: string; source?: unknown } | null | undefined, after = Date.now(), timeZone?: string): number {
  return routineRunsSeveralTimesADay(schedule, after, timeZone) ? ROUTINE_PROBLEM_STREAK_TOLD : 1;
}

/** #3990: whether each completed result of this routine is posted in the
 * chat: only when the person set it to post its results and it runs at
 * most once a day. A routine that can run several times a day, on its
 * clock or on a trigger, posts no run, whatever that choice says: the
 * choice then only names where its summary and a run the person starts
 * go. */
export function routinePostsEachResult(schedule: { type: string } | null | undefined, postResults: boolean, after = Date.now()): boolean {
  return postResults && !routineRunsSeveralTimesADay(schedule, after);
}

/** #3990: whether this finished run's result is posted in the chat
 * (server/index.ts routineEffectivePostResults). A proactive wake posts its
 * result only when its kind is told to answer the person (`alwaysReport`:
 * an accepted suggestion, a watch they keep, a screen offer, a room or DM
 * mention, a text, its look at its own failed run: server/proactive/
 * proactive-wake.ts wakeAlwaysReports) and only when the bot had something
 * for them: a wake that ends quiet (the nothing-to-report line) posts
 * nothing, as any run; a wake on a teammate's message, a mail, a calendar
 * event or a webhook post posts none. A routine's run follows routinePostsEachResult with the routine's
 * choice, else `byDefault` (the installation's); a webhook's own run (no
 * routine behind it) is started by a trigger, so it posts none. A request
 * that waits on the person, items only they can do and a problem's one
 * summary are told whatever this says. */
export function routineRunPostsResult(
  run: { proactive?: { alwaysReport?: boolean } | null; webhookId?: string | null },
  routine: { schedule?: { type: string } | null; postResults?: boolean } | null | undefined,
  byDefault: boolean,
  after = Date.now(),
): boolean {
  if (run.proactive) return run.proactive.alwaysReport === true;
  const chosen = routine?.postResults ?? byDefault;
  if (!routine) return !run.webhookId && chosen;
  return routinePostsEachResult(routine.schedule, chosen, after);
}

type RunRowFacts = {
  kind: string;
  attention?: unknown;
  routineRun?: {
    status?: string;
    wakeTopic?: string | null;
    forPerson?: true | null;
    goalStatus?: string | null;
    startedBy?: string | null;
    problems?: unknown;
    recovered?: { streak?: true | null } | null;
    repeat?: { streak?: true | null } | null;
    autoPausedAfter?: number | null;
  } | null;
};

/** #3990: a routine run's row the chat no longer draws, cards stored by
 * older servers included: a row that only says how a run went (completed
 * with problems, works again, nothing to report, blocked, cancelled, the
 * same problem again), and a wake's row that carries nothing for the person,
 * whatever its topic (a teammate's message, a mail, a calendar event, a
 * heartbeat, a watch, an accepted suggestion). A wake's row tells a report
 * for the person by `forPerson`, written since the server stopped forcing a
 * quiet chosen wake to report; a row stored before cannot tell its forced
 * "nothing for you" words from a report, so it leaves the chat (the run log
 * keeps it). Drawn as before: a live or waiting run, a result,
 * items for the person, a run the person started, the streak's one summary
 * (and its works again), a team goal's card, and a failure (a passing
 * banner, shared/transient-notices.ts). Every run stays in its routine's
 * run log (Automations). */
export function routineRunRowOutOfChat(message: RunRowFacts): boolean {
  const run = message.kind === "routine.run" ? message.routineRun : null;
  if (!run?.status) return false;
  if (message.attention || run.goalStatus || run.startedBy === "person" || run.repeat?.streak || run.recovered?.streak) return false;
  if ((run.autoPausedAfter ?? 0) > 0) return false;
  switch (run.status) {
    case "queued":
    case "running":
    case "waiting":
    case "failed":
    case "missed":
      return false;
    case "completed":
      return Boolean(run.problems || run.recovered || (run.wakeTopic && !run.forPerson));
    default:
      return true;
  }
}
