// Wall-clock arithmetic in a named IANA time zone, for routines that run in
// the zone a person chose rather than the host's (server/bots/bot-settings.ts).
// Built on Intl only: no time zone database ships with Sagax.

export interface ZonedParts {
  year: number;
  /** 1 to 12 */
  month: number;
  day: number;
  hour: number;
  minute: number;
  /** 0 (Sunday) to 6, like Date#getDay. */
  weekday: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string): Intl.DateTimeFormat {
  let found = formatters.get(timeZone);
  if (!found) {
    found = new Intl.DateTimeFormat("en-US", {
      timeZone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric",
    });
    formatters.set(timeZone, found);
  }
  return found;
}

/** The wall clock in `timeZone` at instant `at`. */
export function zonedParts(at: number, timeZone: string): ZonedParts {
  const parts: Record<string, number> = {};
  for (const part of formatter(timeZone).formatToParts(new Date(at))) {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  }
  const year = parts.year!, month = parts.month!, day = parts.day!;
  return { year, month, day, hour: parts.hour! % 24, minute: parts.minute!, weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay() };
}

/** How far `timeZone` is ahead of UTC at instant `at`, in milliseconds. */
function offsetAt(at: number, timeZone: string): number {
  const fields: Record<string, number> = {};
  for (const part of formatter(timeZone).formatToParts(new Date(at))) {
    if (part.type !== "literal") fields[part.type] = Number(part.value);
  }
  const wall = Date.UTC(fields.year!, fields.month! - 1, fields.day!, fields.hour! % 24, fields.minute!, fields.second!);
  return wall - Math.floor(at / 1000) * 1000;
}

/** The instant the wall clock in `timeZone` shows this date and time. In a
 * spring-forward gap the time that does not exist lands an hour later; in a
 * fall-back overlap the first of the two instants is used. Day overflow
 * (day 32, month 13) rolls over like Date.UTC. */
export function zonedTimeToUtc(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): number {
  const naive = Date.UTC(year, month - 1, day, hour, minute);
  const first = naive - offsetAt(naive, timeZone);
  const second = naive - offsetAt(first, timeZone);
  if (first === second) return first;
  // Two candidates: prefer the earlier one that really shows the asked time.
  const shows = (at: number) => {
    const p = zonedParts(at, timeZone);
    return p.hour === hour && p.minute === minute;
  };
  const [early, late] = first < second ? [first, second] : [second, first];
  if (shows(early)) return early;
  if (shows(late)) return late;
  return late;
}
