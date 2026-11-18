// Booking cards: the pure part of the Booking node of shared/widget.ts. The bot
// reads the person's own calendar through its connector (Sagax has no calendar
// of its own), then writes the free slots as instants. Every slot is a Button
// child of the Booking whose press is `book_slot` with the slot in its payload,
// so a press is checked, recorded and sent like any other one, and the bot
// books it with the same calendar tool, under the same organization rules.
//
// Times are instants (ISO 8601 with an offset or Z). They are written, and
// grouped into days, in the person's time zone (`timeZone`, an IANA name), else
// in the device's own, in the person's language. Nothing here reads a clock:
// `now` is an argument.

export const BOOKING_ACTION = "book_slot";
export const BOOKING_LABEL = "Book";
export const BOOKING_LIMITS = {
  /** Slots one card offers. */
  slots: 48,
  /** Upcoming bookings one card lists (the card shows the first three). */
  upcoming: 10,
  /** Upcoming bookings drawn before "and N more". */
  upcomingShown: 3,
  /** Times shown under the days before More times. */
  timesShown: 5,
  /** Days shown side by side. */
  daysShown: 5,
} as const;

const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/i;

/** An instant as canonical UTC text, or undefined when it is not an ISO time with an offset. */
export function bookingInstant(raw: unknown): string | undefined {
  if (typeof raw !== "string" || !INSTANT.test(raw.trim())) return undefined;
  const ms = Date.parse(raw.trim());
  return Number.isFinite(ms) ? new Date(ms).toISOString() : undefined;
}

/** A zone name Intl accepts, else undefined. */
export function bookingZone(raw: unknown): string | undefined {
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  try {
    new Intl.DateTimeFormat("en", { timeZone: raw.trim() });
    return raw.trim();
  } catch {
    return undefined;
  }
}

/** A language tag Intl accepts, else undefined. */
export function bookingLocale(raw: unknown): string | undefined {
  if (typeof raw !== "string" || !/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(raw.trim())) return undefined;
  try {
    return Intl.getCanonicalLocales(raw.trim())[0];
  } catch {
    return undefined;
  }
}

/** The tag a French reader gets is Quebec's. */
function tagOf(locale: string | undefined): string {
  const lang = (locale ?? "en").toLowerCase();
  return lang.startsWith("fr") ? "fr-CA" : locale ?? "en";
}

function parts(iso: string, zone: string | undefined, locale: string | undefined, options: Intl.DateTimeFormatOptions): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of new Intl.DateTimeFormat(tagOf(locale), { ...options, ...(zone ? { timeZone: zone } : {}) }).formatToParts(new Date(iso))) out[part.type] = part.value;
  return out;
}

/** The calendar day of an instant in a zone: "2026-11-09". */
export function bookingDayKey(iso: string, zone?: string): string {
  const p = parts(iso, zone, "en-CA", { year: "numeric", month: "2-digit", day: "2-digit" });
  return `${p.year}-${p.month}-${p.day}`;
}

/** "3:30 PM", "15 h 30": a time of day in the zone. */
export function bookingTime(iso: string, zone?: string, locale?: string): string {
  return new Intl.DateTimeFormat(tagOf(locale), { hour: "numeric", minute: "2-digit", ...(zone ? { timeZone: zone } : {}) }).format(new Date(iso));
}

/** "Mon, Nov 9": a day with its weekday. */
export function bookingDate(iso: string, zone?: string, locale?: string): string {
  return new Intl.DateTimeFormat(tagOf(locale), { weekday: "short", month: "short", day: "numeric", ...(zone ? { timeZone: zone } : {}) }).format(new Date(iso));
}

/** "Mon, Nov 9 at 3:30 PM", "lun. 9 nov. à 15 h 30": a date with its time. */
export function bookingMoment(iso: string, zone?: string, locale?: string): string {
  return new Intl.DateTimeFormat(tagOf(locale), { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", ...(zone ? { timeZone: zone } : {}) }).format(new Date(iso));
}

/** What a press on a slot says the person asked for: "Book Mon, Nov 9, 3:30 PM". */
export function bookingSlotLabel(prefix: string, iso: string, zone?: string, locale?: string): string {
  return `${prefix} ${bookingDate(iso, zone, locale)}, ${bookingTime(iso, zone, locale)}`;
}

export interface BookingDay {
  /** "2026-11-09", the day in the person's zone. */
  key: string;
  /** An instant of that day (its first slot), to word the day. */
  at: string;
  /** Its slots, earliest first. */
  slots: string[];
}

/** Slots grouped into days of the zone, earliest day first. */
export function bookingDays(starts: readonly string[], zone?: string): BookingDay[] {
  const days = new Map<string, BookingDay>();
  for (const iso of [...starts].sort()) {
    const key = bookingDayKey(iso, zone);
    const day = days.get(key);
    if (day) day.slots.push(iso);
    else days.set(key, { key, at: iso, slots: [iso] });
  }
  return [...days.values()];
}

/** How a day reads on the line under the times: "Today", "Tomorrow" or the weekday, then the date. */
export function bookingDayKind(dayKey: string, now: number, zone?: string): "today" | "tomorrow" | "other" {
  const today = bookingDayKey(new Date(now).toISOString(), zone);
  if (dayKey === today) return "today";
  const next = new Date(Date.parse(`${today}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  return dayKey === next ? "tomorrow" : "other";
}

/** A day as "Nov 9" (or "9 nov."), for the line under the times. */
export function bookingShortDate(iso: string, zone?: string, locale?: string): string {
  return new Intl.DateTimeFormat(tagOf(locale), { month: "short", day: "numeric", ...(zone ? { timeZone: zone } : {}) }).format(new Date(iso));
}

/** A day tile: its weekday and its number. */
export function bookingTile(iso: string, zone?: string, locale?: string): { weekday: string; day: string } {
  const p = parts(iso, zone, locale, { weekday: "short", day: "numeric" });
  return { weekday: p.weekday ?? "", day: p.day ?? "" };
}
