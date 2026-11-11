// The routine schedule as a person picks it (2026-10-29): a frequency, the
// times, the days, the zone. Cron stays under the hood: the editor turns a
// model into the five-field expression the scheduler already runs
// (routine-schedule.ts), and an expression back into a model when it fits
// one. An expression that fits none returns null: the editor then keeps it
// as it is behind "Advanced", still described in words (cron-label.ts).
// Mirrored on iOS by CompanionCore/RoutineScheduleModel.swift.

export type ScheduleFrequency = "hourly" | "daily" | "weekdays" | "days" | "monthly" | "yearly" | "every";
export type ScheduleEveryUnit = "minutes" | "hours";

export interface ScheduleModel {
  frequency: ScheduleFrequency;
  /** "HH:MM" in 24 h, sorted, for daily, weekdays, days, monthly, yearly. */
  times: string[];
  /** Hourly: the minute past each hour. */
  minute: number;
  /** Certain days: Sunday = 0. */
  weekdays: number[];
  /** Monthly and yearly: 1 to 31, or "last" (monthly only). */
  monthDay: number | "last";
  /** Yearly: 1 to 12. */
  month: number;
  /** Every N minutes or hours. */
  every: number;
  unit: ScheduleEveryUnit;
}

/** Steps that land on the same minutes every hour (or hours every day). */
export const EVERY_MINUTES = [5, 10, 15, 20, 30] as const;
/** One hour is "Every hour" (hourly at :00). */
export const EVERY_HOURS = [2, 3, 4, 6, 8, 12] as const;
export const WORK_WEEK = [1, 2, 3, 4, 5] as const;

export type ScheduleModelProblem = "noTime" | "noDays" | "badTime";

const DAY_ALIASES = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

export function defaultScheduleModel(patch: Partial<ScheduleModel> = {}): ScheduleModel {
  return { frequency: "daily", times: ["09:00"], minute: 0, weekdays: [...WORK_WEEK], monthDay: 1, month: 1, every: 15, unit: "minutes", ...patch };
}

const clock = (hour: number, minute: number) => `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;

export function parseClock(value: string): { hour: number; minute: number } | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour <= 23 && minute <= 59 ? { hour, minute } : null;
}

/** Sorted, without repeats or empty entries. */
export function normalizeTimes(times: readonly string[]): string[] {
  const parsed = times.map(parseClock).filter((value): value is { hour: number; minute: number } => Boolean(value));
  return [...new Set(parsed.map(({ hour, minute }) => clock(hour, minute)))].sort();
}

/** The cron expression of a model, or why it cannot be one. Times that share
 * their minutes go in one expression ("30 8,12,16 …"); times with other
 * minutes get one expression each, joined by "; " (2026-10-29: 8:15 and
 * 12:30 are "15 8 …; 30 12 …", never 8:30 and 12:15 too). */
export function scheduleModelToCron(model: ScheduleModel): { expression: string } | { problem: ScheduleModelProblem } {
  if (model.frequency === "hourly") {
    if (!Number.isInteger(model.minute) || model.minute < 0 || model.minute > 59) return { problem: "badTime" };
    return { expression: `${model.minute} * * * *` };
  }
  if (model.frequency === "every") {
    if (model.unit === "minutes") {
      if (!(EVERY_MINUTES as readonly number[]).includes(model.every)) return { problem: "badTime" };
      return { expression: `*/${model.every} * * * *` };
    }
    if (!(EVERY_HOURS as readonly number[]).includes(model.every)) return { problem: "badTime" };
    return { expression: `0 */${model.every} * * *` };
  }
  if (model.times.some((time) => !parseClock(time))) return { problem: "badTime" };
  const times = normalizeTimes(model.times).map((time) => parseClock(time)!);
  if (!times.length) return { problem: "noTime" };
  const byMinute = new Map<number, number[]>();
  for (const time of times) byMinute.set(time.minute, [...(byMinute.get(time.minute) ?? []), time.hour]);
  // Earliest first: the expression of the first time of the day leads.
  const groups = [...byMinute.entries()].sort((a, b) => Math.min(...a[1]) * 60 + a[0] - (Math.min(...b[1]) * 60 + b[0]));
  const days = dayFields(model);
  if ("problem" in days) return days;
  return { expression: groups.map(([minute, hours]) => `${minute} ${hours.sort((a, b) => a - b).join(",")} ${days.fields}`).join("; ") };
}

/** The day, month and weekday fields of a timed model. */
function dayFields(model: ScheduleModel): { fields: string } | { problem: ScheduleModelProblem } {
  switch (model.frequency) {
    case "daily": return { fields: "* * *" };
    case "weekdays": return { fields: "* * 1-5" };
    case "days": {
      const days = [...new Set(model.weekdays.map((day) => day % 7))].filter((day) => day >= 0 && day <= 6).sort((a, b) => a - b);
      if (!days.length) return { problem: "noDays" };
      if (days.length === 7) return { fields: "* * *" };
      return { fields: `* * ${days.join(",")}` };
    }
    case "monthly": {
      const day = model.monthDay === "last" ? "L" : model.monthDay;
      if (day !== "L" && !(Number.isInteger(day) && day >= 1 && day <= 31)) return { problem: "badTime" };
      return { fields: `${day} * *` };
    }
    case "yearly": {
      const day = model.monthDay === "last" ? 31 : model.monthDay;
      if (!Number.isInteger(day) || day < 1 || day > 31 || !Number.isInteger(model.month) || model.month < 1 || model.month > 12) return { problem: "badTime" };
      return { fields: `${day} ${model.month} *` };
    }
    default: return { problem: "badTime" };
  }
}

function numberList(text: string, min: number, max: number, aliases: string[] = []): number[] | null {
  const values = new Set<number>();
  for (const part of text.split(",")) {
    const range = part.split("-");
    if (range.length > 2 || range.some((value) => value === "")) return null;
    const read = (token: string) => {
      if (/^\d+$/.test(token)) return Number(token);
      const index = aliases.indexOf(token.toUpperCase());
      return index < 0 ? null : index;
    };
    const first = read(range[0]!);
    const last = range.length === 2 ? read(range[1]!) : first;
    if (first === null || last === null || first < min || last > max || first > last) return null;
    for (let value = first; value <= last; value += 1) values.add(value);
  }
  return [...values].sort((a, b) => a - b);
}

/** The model an expression is, or null when it fits no model (then the
 * editor keeps it under Advanced). Several expressions joined by ";" are one
 * model when they differ only in their times. */
export function cronToScheduleModel(expression: string): ScheduleModel | null {
  const parts = expression.split(";").map((part) => part.trim()).filter(Boolean);
  if (parts.length <= 1) return singleCronToScheduleModel(parts[0] ?? "");
  const models = parts.map(singleCronToScheduleModel);
  if (models.some((model) => !model || model.frequency === "hourly" || model.frequency === "every")) return null;
  const first = models[0]!;
  const same = (model: ScheduleModel) => model.frequency === first.frequency && model.weekdays.join(",") === first.weekdays.join(",")
    && model.monthDay === first.monthDay && model.month === first.month;
  if (!(models as ScheduleModel[]).every(same)) return null;
  return { ...first, times: normalizeTimes((models as ScheduleModel[]).flatMap((model) => model.times)) };
}

function singleCronToScheduleModel(expression: string): ScheduleModel | null {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) return null;
  const [minuteText, hourText, dayText, monthText, weekdayText] = fields as [string, string, string, string, string];
  const base = defaultScheduleModel();

  const step = /^\*\/(\d+)$/;
  if (hourText === "*" && dayText === "*" && monthText === "*" && weekdayText === "*") {
    const minuteStep = step.exec(minuteText);
    if (minuteStep && (EVERY_MINUTES as readonly number[]).includes(Number(minuteStep[1]))) {
      return { ...base, frequency: "every", every: Number(minuteStep[1]), unit: "minutes" };
    }
    if (/^\d+$/.test(minuteText) && Number(minuteText) <= 59) return { ...base, frequency: "hourly", minute: Number(minuteText) };
    return null;
  }
  const hourStep = step.exec(hourText);
  if (hourStep && minuteText === "0" && dayText === "*" && monthText === "*" && weekdayText === "*") {
    const every = Number(hourStep[1]);
    return (EVERY_HOURS as readonly number[]).includes(every) ? { ...base, frequency: "every", every, unit: "hours" } : null;
  }

  if (!/^\d+$/.test(minuteText) || Number(minuteText) > 59) return null;
  const minute = Number(minuteText);
  const hours = numberList(hourText, 0, 23);
  if (!hours) return null;
  const times = hours.map((hour) => clock(hour, minute));

  if (monthText === "*" && dayText === "*") {
    if (weekdayText === "*") return { ...base, frequency: "daily", times };
    const days = numberList(weekdayText, 0, 7, DAY_ALIASES);
    if (!days) return null;
    const set = [...new Set(days.map((day) => day % 7))].sort((a, b) => a - b);
    if (set.length === 7) return { ...base, frequency: "daily", times };
    if (set.join(",") === WORK_WEEK.join(",")) return { ...base, frequency: "weekdays", times };
    return { ...base, frequency: "days", times, weekdays: set };
  }
  if (weekdayText !== "*") return null;
  const monthDay = dayText === "L" ? "last" as const : /^\d+$/.test(dayText) && Number(dayText) >= 1 && Number(dayText) <= 31 ? Number(dayText) : null;
  if (monthDay === null) return null;
  if (monthText === "*") return { ...base, frequency: "monthly", times, monthDay };
  if (!/^\d+$/.test(monthText) || Number(monthText) < 1 || Number(monthText) > 12 || monthDay === "last") return null;
  return { ...base, frequency: "yearly", times, monthDay, month: Number(monthText) };
}

/** The city of an IANA zone in plain words: "America/Toronto" is
 * "Toronto", "America/Argentina/Buenos_Aires" is "Buenos Aires". */
export function timeZoneCity(timeZone: string): string {
  if (timeZone === "UTC" || timeZone === "Etc/UTC") return "UTC";
  return (timeZone.split("/").at(-1) ?? timeZone).replace(/_/g, " ");
}
