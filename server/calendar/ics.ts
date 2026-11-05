// A small iCalendar (RFC 5545) reader for the calendar poller
// (server/triggers/trigger-pollers.ts): the VEVENTs of a feed, and the start times
// of each one inside a window. Recurrence: DAILY, WEEKLY (BYDAY), MONTHLY
// (by month day) and YEARLY with INTERVAL, COUNT, UNTIL and EXDATE, plus
// overridden instances (RECURRENCE-ID). Time zones by IANA TZID, a few
// Windows names, else UTC. All-day events have no start time to warn about
// and are left out. Input is untrusted: sizes are capped, nothing is
// evaluated.

const MAX_EVENTS = 5_000;
const MAX_INSTANCES_SCANNED = 5_000;
const MAX_TEXT = 1_000;

const WINDOWS_ZONES: Record<string, string> = {
  "eastern standard time": "America/New_York",
  "central standard time": "America/Chicago",
  "mountain standard time": "America/Denver",
  "us mountain standard time": "America/Phoenix",
  "pacific standard time": "America/Los_Angeles",
  "atlantic standard time": "America/Halifax",
  "newfoundland standard time": "America/St_Johns",
  "alaskan standard time": "America/Anchorage",
  "hawaiian standard time": "Pacific/Honolulu",
  "gmt standard time": "Europe/London",
  "greenwich standard time": "Atlantic/Reykjavik",
  "w. europe standard time": "Europe/Berlin",
  "romance standard time": "Europe/Paris",
  "central europe standard time": "Europe/Budapest",
  "central european standard time": "Europe/Warsaw",
  "e. europe standard time": "Europe/Chisinau",
  "fle standard time": "Europe/Kiev",
  "tokyo standard time": "Asia/Tokyo",
  "china standard time": "Asia/Shanghai",
  "india standard time": "Asia/Kolkata",
  "aus eastern standard time": "Australia/Sydney",
  "utc": "UTC",
  "coordinated universal time": "UTC",
};

export interface IcsEvent {
  uid: string;
  summary: string;
  description?: string;
  location?: string;
  organizer?: string;
  url?: string;
  status?: string;
  /** UTC milliseconds; undefined for an all-day event. */
  start?: number;
  allDay: boolean;
  rrule?: string;
  /** Wall-clock parts and zone of DTSTART, to step recurrences in local time. */
  local?: { parts: WallClock; zone: string };
  exdates: number[];
  /** Set on an overridden instance: the original start it replaces. */
  recurrenceId?: number;
}

interface WallClock { year: number; month: number; day: number; hour: number; minute: number; second: number }

interface Property { name: string; params: Record<string, string>; value: string }

function unfold(text: string): string[] {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n[ \t]/g, "").split("\n");
}

function parseLine(line: string): Property | null {
  // NAME;PARAM=a;PARAM="b:c":value (a quoted param may hold : and ;)
  let index = 0;
  let inQuote = false;
  for (; index < line.length; index += 1) {
    const char = line[index];
    if (char === "\"") inQuote = !inQuote;
    else if (char === ":" && !inQuote) break;
  }
  if (index >= line.length) return null;
  const head = line.slice(0, index);
  const value = line.slice(index + 1);
  const parts = head.match(/(?:[^;"]|"[^"]*")+/g) ?? [];
  const name = (parts.shift() ?? "").toUpperCase();
  if (!name) return null;
  const params: Record<string, string> = {};
  for (const part of parts) {
    const eq = part.indexOf("=");
    if (eq > 0) params[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1).replace(/^"|"$/g, "");
  }
  return { name, params, value };
}

function unescapeText(value: string): string {
  return value.replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1").slice(0, MAX_TEXT);
}

export function zoneFor(tzid: string | undefined): string {
  if (!tzid) return "UTC";
  const clean = tzid.replace(/^\//, "").trim();
  const windows = WINDOWS_ZONES[clean.toLowerCase()];
  if (windows) return windows;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: clean });
    return clean;
  } catch {
    return "UTC";
  }
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function zoneOffset(utc: number, zone: string): number {
  if (zone === "UTC") return 0;
  let format = formatters.get(zone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    formatters.set(zone, format);
  }
  const parts: Record<string, number> = {};
  for (const part of format.formatToParts(new Date(utc))) if (part.type !== "literal") parts[part.type] = Number(part.value);
  const asUtc = Date.UTC(parts.year!, parts.month! - 1, parts.day!, parts.hour! % 24, parts.minute!, parts.second!);
  return asUtc - Math.floor(utc / 1000) * 1000;
}

/** UTC milliseconds of a wall-clock time in a zone. */
export function wallToUtc(wall: WallClock, zone: string): number {
  const guess = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  const first = guess - zoneOffset(guess, zone);
  const second = guess - zoneOffset(first, zone);
  return second;
}

function parseDateValue(prop: Property): { utc?: number; wall?: WallClock; zone: string; allDay: boolean } | null {
  const value = prop.value.trim();
  const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(value);
  if (!match) return null;
  const wall: WallClock = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]), hour: Number(match[4] ?? 0), minute: Number(match[5] ?? 0), second: Number(match[6] ?? 0) };
  if (match[4] === undefined || prop.params.VALUE === "DATE") return { wall, zone: "UTC", allDay: true };
  const zone = match[7] ? "UTC" : zoneFor(prop.params.TZID);
  return { utc: wallToUtc(wall, zone), wall, zone, allDay: false };
}

function organizerOf(prop: Property): string {
  const email = prop.value.replace(/^mailto:/i, "").trim();
  const name = prop.params.CN?.trim();
  return name && email ? `${name} <${email}>` : name || email;
}

export function parseIcs(text: string): IcsEvent[] {
  const events: IcsEvent[] = [];
  let current: Property[] | null = null;
  let depth = 0;
  for (const line of unfold(text)) {
    const upper = line.toUpperCase();
    if (upper === "BEGIN:VEVENT") { current = []; depth = 0; continue; }
    if (!current) continue;
    if (upper.startsWith("BEGIN:")) { depth += 1; continue; }
    if (upper.startsWith("END:") && depth > 0) { depth -= 1; continue; }
    if (upper === "END:VEVENT") {
      const event = buildEvent(current);
      if (event) events.push(event);
      current = null;
      if (events.length >= MAX_EVENTS) break;
      continue;
    }
    if (depth > 0) continue; // VALARM and friends
    const prop = parseLine(line);
    if (prop) current.push(prop);
  }
  return events;
}

function buildEvent(props: Property[]): IcsEvent | null {
  const get = (name: string) => props.find((prop) => prop.name === name);
  const uid = get("UID")?.value.trim();
  const start = get("DTSTART");
  if (!uid || !start) return null;
  const parsed = parseDateValue(start);
  if (!parsed) return null;
  const exdates: number[] = [];
  for (const prop of props.filter((entry) => entry.name === "EXDATE")) {
    for (const value of prop.value.split(",")) {
      const date = parseDateValue({ ...prop, value });
      if (date?.utc !== undefined) exdates.push(date.utc);
    }
  }
  const recurrence = get("RECURRENCE-ID");
  const recurrenceId = recurrence ? parseDateValue(recurrence)?.utc : undefined;
  const organizer = get("ORGANIZER");
  return {
    uid: uid.slice(0, 500),
    summary: unescapeText(get("SUMMARY")?.value ?? "").slice(0, 300),
    ...(get("DESCRIPTION") ? { description: unescapeText(get("DESCRIPTION")!.value) } : {}),
    ...(get("LOCATION") ? { location: unescapeText(get("LOCATION")!.value).slice(0, 300) } : {}),
    ...(organizer ? { organizer: organizerOf(organizer).slice(0, 300) } : {}),
    ...(get("URL") ? { url: get("URL")!.value.trim().slice(0, 1_000) } : {}),
    ...(get("STATUS") ? { status: get("STATUS")!.value.trim().toUpperCase() } : {}),
    ...(parsed.utc !== undefined ? { start: parsed.utc } : {}),
    allDay: parsed.allDay,
    ...(get("RRULE") ? { rrule: get("RRULE")!.value.trim() } : {}),
    ...(parsed.wall && !parsed.allDay ? { local: { parts: parsed.wall, zone: parsed.zone } } : {}),
    exdates,
    ...(recurrenceId !== undefined ? { recurrenceId } : {}),
  };
}

const DAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

function addDays(wall: WallClock, days: number): WallClock {
  const date = new Date(Date.UTC(wall.year, wall.month - 1, wall.day + days));
  return { ...wall, year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

function weekday(wall: WallClock): number {
  return new Date(Date.UTC(wall.year, wall.month - 1, wall.day)).getUTCDay();
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Start times (UTC ms) of a master event's instances in [from, to]. */
function expand(event: IcsEvent, from: number, to: number): number[] {
  if (event.start === undefined || !event.local) return [];
  if (!event.rrule) return event.start >= from && event.start <= to ? [event.start] : [];
  const rule: Record<string, string> = {};
  for (const part of event.rrule.split(";")) {
    const [key, value] = part.split("=");
    if (key && value) rule[key.toUpperCase()] = value.toUpperCase();
  }
  const freq = rule.FREQ;
  const interval = Math.max(1, Math.min(1_000, Number(rule.INTERVAL) || 1));
  const count = rule.COUNT ? Math.max(1, Number(rule.COUNT) || 1) : Infinity;
  const until = rule.UNTIL ? parseDateValue({ name: "UNTIL", params: {}, value: rule.UNTIL }) : null;
  const untilMs = until ? until.utc ?? Date.UTC(until.wall!.year, until.wall!.month - 1, until.wall!.day, 23, 59, 59) : Infinity;
  const zone = event.local.zone;
  const base = event.local.parts;
  const byDay = (rule.BYDAY ?? "").split(",").map((day) => DAYS.indexOf(day.replace(/^[+-]?\d+/, ""))).filter((day) => day >= 0);
  const out: number[] = [];
  let produced = 0;
  const exdates = new Set(event.exdates);
  const emit = (wall: WallClock): boolean => {
    const utc = wallToUtc(wall, zone);
    if (utc < event.start!) return true;
    if (utc > untilMs || produced >= count || utc > to) return false;
    produced += 1;
    if (utc >= from && !exdates.has(utc)) out.push(utc);
    return true;
  };
  for (let step = 0; step < MAX_INSTANCES_SCANNED; step += 1) {
    if (freq === "DAILY") {
      if (!emit(addDays(base, step * interval))) break;
    } else if (freq === "WEEKLY") {
      const days = byDay.length ? byDay : [weekday(base)];
      const weekStart = addDays(base, step * 7 * interval - weekday(base));
      let going = true;
      for (const day of [...days].sort((a, b) => a - b)) {
        if (!emit(addDays(weekStart, day))) { going = false; break; }
      }
      if (!going) break;
    } else if (freq === "MONTHLY") {
      const months = base.month - 1 + step * interval;
      const year = base.year + Math.floor(months / 12);
      const month = (months % 12) + 1;
      if (base.day > daysInMonth(year, month)) continue;
      if (!emit({ ...base, year, month })) break;
    } else if (freq === "YEARLY") {
      const year = base.year + step * interval;
      if (base.day > daysInMonth(year, base.month)) continue;
      if (!emit({ ...base, year })) break;
    } else {
      // Unsupported frequency: the first instance only.
      if (event.start >= from && event.start <= to) out.push(event.start);
      break;
    }
  }
  return out;
}

export interface IcsInstance {
  event: IcsEvent;
  start: number;
}

/** Every timed, non-cancelled instance starting in [from, to]. */
export function instancesBetween(events: IcsEvent[], from: number, to: number): IcsInstance[] {
  const overrides = new Map<string, Set<number>>();
  for (const event of events) {
    if (event.recurrenceId === undefined) continue;
    if (!overrides.has(event.uid)) overrides.set(event.uid, new Set());
    overrides.get(event.uid)!.add(event.recurrenceId);
  }
  const out: IcsInstance[] = [];
  for (const event of events) {
    if (event.allDay || event.status === "CANCELLED") continue;
    if (event.recurrenceId !== undefined) {
      if (event.start !== undefined && event.start >= from && event.start <= to) out.push({ event, start: event.start });
      continue;
    }
    const replaced = overrides.get(event.uid);
    for (const start of expand(event, from, to)) {
      if (!replaced?.has(start)) out.push({ event, start });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}
