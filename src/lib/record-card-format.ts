// How a record card words its times and its text (#4507). Every time is
// computed and written in the card's own zone (`tz`, the organization's), never
// the device's, in the person's language. Pure functions: `now` and the
// language are arguments, so a test holds both still.

function tagOf(lang: string): string {
  return lang.toLowerCase().startsWith("fr") ? "fr-CA" : lang || "en";
}

/** A zone name Intl accepts, else undefined (the device's own). */
function safeZone(tz: string | undefined): string | undefined {
  if (!tz) return undefined;
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return tz;
  } catch {
    return undefined;
  }
}

function parts(date: Date, tag: string, tz: string | undefined, options: Intl.DateTimeFormatOptions): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of new Intl.DateTimeFormat(tag, { ...options, timeZone: safeZone(tz) }).formatToParts(date)) out[part.type] = part.value;
  return out;
}

/** The calendar day of an instant in a zone, as a day number. */
function dayNumber(date: Date, tz: string | undefined): number {
  const p = parts(date, "en-CA", tz, { year: "numeric", month: "2-digit", day: "2-digit" });
  return Math.floor(Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day)) / 86_400_000);
}

/** A bare calendar day ("2026-11-05"): a due date, an invoice date. It is a day
 * on the calendar, not an instant: it has no time and no zone, so it is never
 * read as midnight UTC (which is the evening before in a zone behind UTC). */
const BARE_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isBareDay(value: string): boolean {
  return BARE_DAY.test(value.trim());
}

/** The calendar day of a bare day, as a day number (the same scale as dayNumber). */
function bareDayNumber(value: string): number {
  const match = BARE_DAY.exec(value.trim())!;
  return Math.floor(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / 86_400_000);
}

/** A bare day as a Date held at noon UTC, formatted with `timeZone: "UTC"`: the
 * same day on every device, in every zone. */
function bareDayDate(value: string): Date {
  const match = BARE_DAY.exec(value.trim())!;
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12));
}

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

/** "il y a 29 min", "il y a 3 jours", "in 2 hours": age or last update. */
export function formatRelative(iso: string, now: number, lang: string, tz?: string): string {
  const tag = tagOf(lang);
  // a calendar day is counted in whole days of the card's zone: today, yesterday, N days ago
  const bare = isBareDay(iso);
  const gap = bare ? bareDayNumber(iso) - dayNumber(new Date(now), tz) : 0;
  if (bare && gap === 0) return new Intl.RelativeTimeFormat(tag, { numeric: "auto" }).format(0, "day");
  const then = bare ? now + gap * DAY : Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const diff = then - now;
  const abs = Math.abs(diff);
  const sign = diff < 0 ? -1 : 1;
  if (abs < MINUTE) return new Intl.RelativeTimeFormat(tag, { numeric: "auto" }).format(0, "second");
  if (abs < HOUR) return new Intl.RelativeTimeFormat(tag, { numeric: "always", style: "short" }).format(sign * Math.floor(abs / MINUTE), "minute");
  if (abs < DAY) return new Intl.RelativeTimeFormat(tag, { numeric: "always", style: "short" }).format(sign * Math.floor(abs / HOUR), "hour");
  const days = Math.floor(abs / DAY);
  if (days < 14) return new Intl.RelativeTimeFormat(tag, { numeric: "auto" }).format(sign * days, "day");
  if (days < 60) return new Intl.RelativeTimeFormat(tag, { numeric: "auto" }).format(sign * Math.floor(days / 7), "week");
  if (days < 540) return new Intl.RelativeTimeFormat(tag, { numeric: "auto" }).format(sign * Math.floor(days / 30), "month");
  return new Intl.RelativeTimeFormat(tag, { numeric: "auto" }).format(sign * Math.floor(days / 365), "year");
}

function clock(date: Date, tag: string, tz: string | undefined): string {
  const format = new Intl.DateTimeFormat(tag, { hour: "numeric", minute: "2-digit", timeZone: safeZone(tz) });
  const list = format.formatToParts(date);
  const minute = list.findIndex((part) => part.type === "minute");
  if (minute < 0 || list[minute]!.value !== "00") return format.format(date);
  // the whole hour reads "17 h", not "17 h 00": the language's own hour, unless this ICU gives bare
  // digits for it (fr-CA "17" in ICU 79), then the minutes and their separator left out, the hour's mark kept
  const hour = new Intl.DateTimeFormat(tag, { hour: "numeric", timeZone: safeZone(tz) }).format(date);
  if (/\D/u.test(hour.replace(/\s/gu, ""))) return hour;
  return list.flatMap((part, index) => {
    if (index === minute) return [];
    if (index === minute - 1 && part.type === "literal") return /\p{L}/u.test(part.value) ? [part.value.trimEnd()] : [];
    return [part.value];
  }).join("").replace(/\s+/gu, " ").trim();
}

/** "aujourd'hui 14 h 03", "hier 16 h 20", "mer. 18 nov., 17 h": a note's time
 * and a due date. The year shows only when it is not this year's. */
export function formatAbsolute(iso: string, now: number, lang: string, tz: string | undefined, { time = true, year = false }: { time?: boolean; /** say the year even in this year */ year?: boolean } = {}): string {
  if (isBareDay(iso)) return formatDay(iso, now, lang, tz, year);
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const tag = tagOf(lang);
  const gap = dayNumber(date, tz) - dayNumber(new Date(now), tz);
  const at = time && /T\d/.test(iso) ? clock(date, tag, tz) : "";
  if (Math.abs(gap) <= 1) {
    const day = new Intl.RelativeTimeFormat(tag, { numeric: "auto" }).format(gap, "day");
    return at ? `${day} ${at}` : day;
  }
  const sameYear = parts(date, "en", tz, { year: "numeric" }).year === parts(new Date(now), "en", tz, { year: "numeric" }).year;
  const day = new Intl.DateTimeFormat(tag, { weekday: "short", day: "numeric", month: "short", ...(sameYear && !year ? {} : { year: "numeric" }), timeZone: safeZone(tz) }).format(date);
  return at ? `${day}, ${at}` : day;
}

/** A calendar day, as the person's locale writes a date: "demain", "mer. 5 nov.",
 * with the year when it is not this year's. Today is read in the card's zone;
 * the day itself is never shifted. */
function formatDay(day: string, now: number, lang: string, tz: string | undefined, withYear = false): string {
  const tag = tagOf(lang);
  const gap = bareDayNumber(day) - dayNumber(new Date(now), tz);
  if (Math.abs(gap) <= 1) return new Intl.RelativeTimeFormat(tag, { numeric: "auto" }).format(gap, "day");
  const date = bareDayDate(day);
  const sameYear = date.getUTCFullYear() === Number(parts(new Date(now), "en", tz, { year: "numeric" }).year);
  return new Intl.DateTimeFormat(tag, { weekday: "short", day: "numeric", month: "short", ...(sameYear && !withYear ? {} : { year: "numeric" }), timeZone: "UTC" }).format(date);
}

/** The hour of "à jour à 14 h 32": the clock time in the card's zone. */
export function formatClock(iso: string, lang: string, tz: string | undefined): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : clock(date, tagOf(lang), tz);
}

/** The full time with the zone's name: the tooltip of a relative time. */
export function formatFull(iso: string, lang: string, tz: string | undefined): string {
  if (isBareDay(iso)) return new Intl.DateTimeFormat(tagOf(lang), { dateStyle: "full", timeZone: "UTC" }).format(bareDayDate(iso));
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(tagOf(lang), { dateStyle: "full", timeStyle: "short", timeZone: safeZone(tz) }).format(date) + (tz && safeZone(tz) ? ` (${parts(date, tagOf(lang), tz, { timeZoneName: "short" }).timeZoneName ?? tz})` : "");
}

/** How late a past due date is, in the language: "2 jours", "3 h", "40 min".
 * A due DAY is late once that day is over in the card's zone (`tz`), and is
 * counted in whole days: due the 5th, it is one day late on the 6th. */
export function formatLateness(iso: string, now: number, lang: string, tz?: string): string | null {
  if (isBareDay(iso)) {
    const days = dayNumber(new Date(now), tz) - bareDayNumber(iso);
    return days >= 1 ? new Intl.NumberFormat(tagOf(lang), { style: "unit", unit: "day", unitDisplay: "long" }).format(days) : null;
  }
  const due = Date.parse(iso);
  if (Number.isNaN(due) || due >= now) return null;
  const late = now - due;
  const tag = tagOf(lang);
  const unit = (value: number, name: "day" | "hour" | "minute") => new Intl.NumberFormat(tag, { style: "unit", unit: name, unitDisplay: name === "day" ? "long" : "narrow" }).format(value);
  if (late >= DAY) return unit(Math.floor(late / DAY), "day");
  if (late >= HOUR) return unit(Math.floor(late / HOUR), "hour");
  return unit(Math.max(1, Math.floor(late / MINUTE)), "minute");
}

const GUID = /^\{?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\}?$/i;

/** A GUID is never a label. */
export function isGuid(value: string): boolean {
  return GUID.test(value.trim());
}

/** One line, compared loosely: case, spacing and a trailing ellipsis aside. */
function loose(value: string): string {
  return value.replace(/\s+/g, " ").replace(/[.…]+$/u, "").trim().toLowerCase();
}

/** Whether two texts say the same thing, one possibly cut shorter than the
 * other (a description and the note it was taken from). */
export function sameText(a: string, b: string): boolean {
  const left = loose(a);
  const right = loose(b);
  if (!left || !right) return false;
  if (left === right) return true;
  const [short, long] = left.length <= right.length ? [left, right] : [right, left];
  return short.length >= 24 && long.startsWith(short);
}

/** A percent field's value as 0 to 100, for the progress bar: only a value
 * written as a percentage ("52 %", "52%", "52,5 %") is one. */
export function percentValue(value: string): number | null {
  const match = /^(\d{1,3}(?:[.,]\d+)?)\s*%$/.exec(value.trim());
  if (!match) return null;
  const number = Number(match[1]!.replace(",", "."));
  return number >= 0 && number <= 100 ? number : null;
}
