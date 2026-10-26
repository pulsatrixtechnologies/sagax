// Human wording for cron expressions that the short presets in cron-label.ts
// do not cover: lists, ranges, steps, day names, day of month, months.
// Presentation only: the scheduler never reads this. Anything that cannot be
// said without guessing returns null so the caller keeps the raw expression.

export type CronLocale = "en" | "fr";

const MONTH_NAMES = {
  en: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
  fr: ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"],
} as const;
const DAY_NAMES = {
  en: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
  fr: ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"],
} as const;
const MONTH_ALIASES = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const DAY_ALIASES = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

interface Field { values: number[]; star: boolean; step: number | null; rangeStart: number | null; rangeEnd: number | null }

function aliasValue(token: string, aliases: string[], offset: number): number | null {
  if (/^\d+$/.test(token)) return Number(token);
  const index = aliases.indexOf(token.toUpperCase());
  return index < 0 ? null : index + offset;
}

function parseField(text: string, min: number, max: number, aliases: string[] = [], offset = 0): Field | null {
  const values = new Set<number>();
  const parts = text.split(",");
  let single: { step: number | null; start: number | null; end: number | null } | null = null;
  for (const part of parts) {
    const [rangePart, stepPart, extra] = part.split("/");
    if (extra !== undefined || rangePart === undefined || rangePart === "") return null;
    const step = stepPart === undefined ? 1 : Number(stepPart);
    if (stepPart !== undefined && (!/^\d+$/.test(stepPart) || step < 1)) return null;
    let start: number;
    let end: number;
    if (rangePart === "*") { start = min; end = max; }
    else if (rangePart.includes("-")) {
      const [a, b, more] = rangePart.split("-");
      if (more !== undefined) return null;
      const first = aliasValue(a ?? "", aliases, offset);
      const last = aliasValue(b ?? "", aliases, offset);
      if (first === null || last === null) return null;
      start = first; end = last;
    } else {
      const value = aliasValue(rangePart, aliases, offset);
      if (value === null) return null;
      start = value;
      end = stepPart === undefined ? value : max;
    }
    if (start < min || end > max || start > end) return null;
    for (let value = start; value <= end; value += step) values.add(value);
    single = parts.length === 1 ? { step: stepPart === undefined ? null : step, start: rangePart === "*" ? null : start, end: rangePart === "*" ? null : end } : null;
  }
  return {
    values: [...values].sort((a, b) => a - b),
    star: text === "*",
    step: single?.step ?? null,
    rangeStart: single?.start ?? null,
    rangeEnd: single?.end ?? null,
  };
}

function join(items: string[], locale: CronLocale): string {
  if (items.length <= 1) return items[0] ?? "";
  const word = locale === "fr" ? "et" : "and";
  const head = items.slice(0, -1).join(", ");
  return `${head} ${word} ${items[items.length - 1]}`;
}

const isContiguous = (values: number[]) => values.every((value, index) => index === 0 || value === values[index - 1]! + 1);

/** "8 AM" / "8 h" on the hour, "8:30 AM" / "8 h 30" otherwise. */
function clock(hour: number, minute: number, locale: CronLocale, forceMinutes = false): string {
  if (locale === "fr") return minute === 0 && !forceMinutes ? `${hour} h` : `${hour} h ${String(minute).padStart(2, "0")}`;
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  const suffix = hour < 12 ? "AM" : "PM";
  return minute === 0 && !forceMinutes ? `${h12} ${suffix}` : `${h12}:${String(minute).padStart(2, "0")} ${suffix}`;
}

const past = (minutes: number[]) => minutes.map((minute) => `:${String(minute).padStart(2, "0")}`);

function daysPhrase(dow: Field, locale: CronLocale): string | null {
  const days = [...new Set(dow.values.map((value) => value % 7))].sort((a, b) => a - b);
  if (days.length === 7) return "";
  const names = DAY_NAMES[locale];
  const key = days.join(",");
  if (key === "1,2,3,4,5") return locale === "fr" ? "du lundi au vendredi" : "weekdays";
  if (key === "0,6") return locale === "fr" ? "les fins de semaine" : "weekends";
  // Monday-first ordering, so Sunday closes a range (Fri-Sun)
  const ordered = days.map((day) => (day + 6) % 7).sort((a, b) => a - b);
  if (days.length >= 3 && isContiguous(ordered)) {
    const first = names[(ordered[0]! + 1) % 7]!;
    const last = names[(ordered[ordered.length - 1]! + 1) % 7]!;
    return locale === "fr" ? `du ${first} au ${last}` : `${first} to ${last}`;
  }
  const list = ordered.map((day) => names[(day + 1) % 7]!);
  if (locale === "fr") return days.length === 1 ? `le ${list[0]}` : `les ${join(list.map((name) => `${name}s`), locale)}`;
  return days.length === 1 ? `${list[0]}s` : join(list, locale);
}

function monthDayPhrase(dom: Field, locale: CronLocale): string {
  const values = dom.values;
  if (locale === "fr") {
    const list = values.map((value) => (value === 1 ? "1er" : String(value)));
    return `le ${join(list, locale)} du mois`;
  }
  const ordinal = (value: number) => {
    const mod100 = value % 100;
    if (mod100 >= 11 && mod100 <= 13) return `${value}th`;
    return `${value}${["th", "st", "nd", "rd"][value % 10] ?? "th"}`;
  };
  return `on the ${join(values.map(ordinal), locale)}`;
}

/** Null when the expression is not expressible clearly (caller shows the raw cron). */
export function describeCron(expression: string, locale: CronLocale): string | null {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) return null;
  const [minuteText, hourText, domText, monthText, dowText] = fields as [string, string, string, string, string];
  // Specials (L, #, ?, W) stay with the presets or the raw expression.
  if (/[^0-9A-Za-z*,/-]/.test(expression.replace(/\s/g, ""))) return null;
  const minute = parseField(minuteText, 0, 59);
  const hour = parseField(hourText, 0, 23);
  const dom = parseField(domText, 1, 31);
  const month = parseField(monthText, 1, 12, MONTH_ALIASES, 1);
  const dow = parseField(dowText, 0, 7, DAY_ALIASES, 0);
  if (!minute || !hour || !dom || !month || !dow) return null;
  // Day of month and weekday together mean "either" in cron: not clear in a sentence.
  if (!dom.star && !dow.star) return null;

  // When
  const fr = locale === "fr";
  const everyN = (n: number, unit: "minutes" | "hours") => (fr ? `toutes les ${n} ${unit === "minutes" ? "minutes" : "heures"}` : `every ${n} ${unit}`);
  const minutesFull = minute.star || (minute.step !== null && minute.rangeStart === null && 60 % minute.step === 0);
  const everyMinute = (): string => (minute.step === null || minute.step === 1 ? (fr ? "chaque minute" : "every minute") : everyN(minute.step, "minutes"));
  if (!minutesFull && minute.values.length > 12) return null;
  const minuteList = join(past(minute.values), locale);
  const first = hour.values[0]!;
  const last = hour.values[hour.values.length - 1]!;
  const range = fr ? `de ${clock(first, 0, locale)} à ${clock(last, 0, locale)}` : `${clock(first, 0, locale)} to ${clock(last, 0, locale)}`;
  let when: string;
  if (hour.star) {
    when = minutesFull ? everyMinute() : fr ? `toutes les heures à ${minuteList}` : `every hour at ${minuteList}`;
  } else if (hour.step !== null && hour.step > 1) {
    // "*/2" or "8-18/2": every N hours, inside the window when it is bounded
    if (minutesFull) return null;
    const bounded = hour.rangeStart !== null && hour.rangeEnd !== null;
    const onTheHour = minute.values.length === 1 && minute.values[0] === 0;
    when = [everyN(hour.step, "hours"), bounded ? range : "", onTheHour ? "" : `${fr ? "à" : "at"} ${minuteList}`].filter(Boolean).join(", ");
  } else if (hour.values.length > 1 && isContiguous(hour.values)) {
    when = `${range}, ${minutesFull ? everyMinute() : `${fr ? "à" : "at"} ${minuteList}`}`;
  } else {
    if (minutesFull) return null;
    const times: string[] = [];
    for (const h of hour.values) for (const m of minute.values) times.push(clock(h, m, locale, true));
    if (times.length > 6) return null;
    when = `${fr ? "à" : "at"} ${join(times, locale)}`;
  }

  // Which days
  const parts: string[] = [];
  const days = dow.star ? "" : daysPhrase(dow, locale);
  if (days === null) return null;
  if (days) parts.push(days);
  if (!dom.star) parts.push(monthDayPhrase(dom, locale));
  if (!month.star) {
    const names = month.values.map((value) => MONTH_NAMES[locale][value - 1]!);
    parts.push(locale === "fr" ? `en ${join(names, locale)}` : `in ${join(names, locale)}`);
  }
  const lead = parts.join(locale === "fr" ? ", " : ", ");
  const text = lead ? `${lead}, ${when}` : when;
  return text.charAt(0).toUpperCase() + text.slice(1);
}
