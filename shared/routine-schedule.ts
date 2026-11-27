import { Cron } from "croner";

export interface RoutineCronSchedule {
  type: "cron";
  /** One five-field expression, or several joined by "; " (2026-10-29: each
   * time of a day keeps its own minutes, e.g. "15 8 * * 1-5; 30 12 * * 1-5").
   * The routine runs at every instant any of them names, once per instant. */
  expression: string;
  /** Explicit IANA timezone; independent of the server or viewer's timezone. */
  timeZone: string;
}

const MAX_EXPRESSION_LENGTH = 1024;
/** Expressions one schedule may join (one per distinct minute of a day). */
export const MAX_CRON_EXPRESSIONS = 24;
export const CRON_EXPRESSION_SEPARATOR = "; ";

/** The expressions of a schedule: one, or several joined by ";". */
export function cronExpressions(expression: string): string[] {
  return expression.split(";").map((part) => part.trim().replace(/\s+/g, " ")).filter(Boolean);
}
const MAX_PREVIEW_RUNS = 1000;

function cronCalculator(value: unknown): { schedule: RoutineCronSchedule; crons: Cron[] } {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Choose a valid cron schedule");
  const input = value as Partial<RoutineCronSchedule>;
  if (input.type !== "cron" || typeof input.expression !== "string") throw new Error("Choose a valid cron schedule");
  if (Object.keys(input).some(key => !["type", "expression", "timeZone", "timing", "windowEarlyMinutes", "windowLateMinutes"].includes(key))) {
    throw new Error("Cron schedules accept only type, expression and timeZone; start/end dates and other restrictions are not supported");
  }
  const parts = [...new Set(cronExpressions(input.expression))];
  const expression = parts.join(CRON_EXPRESSION_SEPARATOR);
  if (!parts.length || parts.length > MAX_CRON_EXPRESSIONS || expression.length > MAX_EXPRESSION_LENGTH
    || parts.some((part) => part.split(" ").length !== 5 || part.includes("@"))) {
    throw new Error("Cron must have five fields: minute hour day-of-month month weekday (no seconds, year, or macros); join several with \";\"");
  }
  const timeZone = typeof input.timeZone === "string" ? input.timeZone.trim() : "";
  // Intl also accepts numeric offsets in newer runtimes. Require a named zone
  // so wall-clock schedules follow its daylight-saving rules instead.
  if (timeZone.length > 128 || !(timeZone === "UTC" || /^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)+$/.test(timeZone))) {
    throw new Error("Choose an IANA timezone such as America/New_York, Asia/Kolkata, or UTC");
  }
  try { new Intl.DateTimeFormat("en-US", { timeZone }).format(0); }
  catch { throw new Error("Choose a valid IANA timezone such as America/New_York, Asia/Kolkata, or UTC"); }
  try {
    // Date calculator only: no callback, name, or timer. RoutineManager owns
    // dispatch, persistence, catch-up and cancellation. Croner bounds its
    // five-field search at year 3000, including impossible calendar dates.
    const crons = parts.map((part) => new Cron(part, { timezone: timeZone, mode: "5-part", paused: true }));
    return { schedule: { type: "cron", expression, timeZone }, crons };
  } catch (error) {
    throw new Error(`Invalid cron expression: ${(error as Error).message}`);
  }
}

function calculationDate(after: number): Date {
  const date = new Date(after);
  if (!Number.isFinite(after) || !Number.isFinite(date.getTime())) throw new Error("Choose a valid cron preview date");
  return date;
}

/** Every expression's runs, merged in order; an instant two of them name
 * runs once. */
function futureRuns(crons: Cron[], after: number, count: number): number[] {
  if (crons.length === 1) return singleFutureRuns(crons[0]!, after, count);
  const merged = [...new Set(crons.flatMap((cron) => singleFutureRuns(cron, after, count)))].sort((a, b) => a - b);
  return merged.slice(0, count);
}

function singleFutureRuns(cron: Cron, after: number, count: number): number[] {
  const from = calculationDate(after);
  // Croner resolves an ambiguous wall-clock time to its first occurrence.
  // If the cursor is already in the second occurrence, its first candidate
  // can therefore be in the past. Ask the same calculator for more candidates
  // and discard those, rather than moving the scheduler cursor backwards.
  // Minute precision bounds even a full-day historical timezone fold at 1440.
  const maximum = count + 1440;
  let requested = count;
  while (true) {
    const candidates = cron.nextRuns(requested, from);
    const runs: number[] = [];
    for (const date of candidates) {
      const at = date.getTime();
      if (!Number.isFinite(at)) throw new Error("The cron schedule produced an invalid date");
      if (at > (runs.at(-1) ?? after)) runs.push(at);
      if (runs.length === count) return runs;
    }
    if (candidates.length < requested || requested === maximum) return runs;
    // Sparse schedules normally need just one more candidate. Grow only when
    // needed, so a daily preview never scans years to skip one repeated hour.
    requested = Math.min(maximum, requested * 2);
  }
}

/** Normalize once at the trust boundary, rejecting impossible schedules. */
export function normalizeCronSchedule(value: unknown, after = Date.now()): RoutineCronSchedule {
  const { schedule, crons } = cronCalculator(value);
  if (!futureRuns(crons, after, 1).length) throw new Error("This cron expression has no future runs. Choose dates that exist.");
  return schedule;
}

/** Strictly-future instants, shared by the scheduler, cards and calendar.
 * Croner 11 DST (Vixie-aligned): a fixed-time job in a spring gap runs at the
 * first valid time after the gap; in a fall-back overlap it runs once at the
 * first occurrence. An interval job (a wildcard or list in seconds/minutes/
 * hours) runs on both occurrences of a repeated hour. */
export function nextCronRuns(schedule: RoutineCronSchedule, after: number, count: number): number[] {
  return createCronRunPreview(schedule)(after, count);
}

/**
 * One Croner build for many previews of the same schedule. The calendar's
 * dense path jumps half hour by half hour and would otherwise rebuild the
 * calculator on every call (#1677).
 */
export function createCronRunPreview(schedule: RoutineCronSchedule): (after: number, count: number) => number[] {
  const { crons } = cronCalculator(schedule);
  return (after, count) => {
    if (!Number.isInteger(count) || count < 1 || count > MAX_PREVIEW_RUNS) throw new Error("Choose between 1 and 1000 cron preview runs");
    return futureRuns(crons, after, count);
  };
}
