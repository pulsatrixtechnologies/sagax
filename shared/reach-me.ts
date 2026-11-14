// "Me joindre" (Reach me, 2026-10-26): one setting per bot, chosen by the
// person who answers that bot's cards, for how the bot reaches them outside
// the app when a question or an approval waits on them. Pure, shared by the
// server (server/reach-me/) and the bot page (src/components/bot-settings/
// BotReachMe.tsx).
//
// - Channels: push (iOS APNs and Android FCM, the phones the person
//   registered), sms (Perspicax Voice, to the person's own proven number),
//   teams (the person's own Teams chat through their engine connector),
//   telegram (the person's own bot from BotFather), whatsapp (the person's
//   own WhatsApp Business number, WhatsApp Cloud API).
// - Hours (#4250 S2): the person's ONE quiet-hours setting rules every bot
//   and channel (Settings > Notifications, shared/attention-policy.ts); a bot
//   keeps only its channels. The per-bot `hours` a previous version saved
//   are still parsed and kept in the file, so that version reads them back,
//   but nothing reads them any more.
// - No setting saved for a bot: push only (the behavior before this setting).

export const REACH_CHANNELS = ["push", "sms", "teams", "telegram", "whatsapp"] as const;
export type ReachChannelId = (typeof REACH_CHANNELS)[number];

/** The channels that are wired. */
export const REACH_WIRED: readonly ReachChannelId[] = ["push", "sms", "teams", "telegram", "whatsapp"];

/** One range: days of the week (0 Sunday to 6 Saturday) and a start and an
 * end time, HH:MM, in the settings' time zone. An end before its start runs
 * past midnight (22:00 to 07:00). */
export interface ReachHoursRange {
  days: number[];
  start: string;
  end: string;
}

export type ReachHours =
  | { always: true }
  | { always: false; timeZone: string; ranges: ReachHoursRange[] };

export interface ReachMeSettings {
  channels: ReachChannelId[];
  /** The person's own number for sms, E.164. Perspicax Voice sends to it only
   * when it is one of the person's verified numbers on their line. */
  smsNumber?: string;
  /** Kept for the previous version only (#4250 S2): never read. */
  hours: ReachHours;
}

export const DEFAULT_REACH_ME: ReachMeSettings = Object.freeze({ channels: ["push"], hours: { always: true } }) as ReachMeSettings;

export const E164 = /^\+[1-9]\d{7,14}$/;
const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
export const REACH_MAX_RANGES = 14;

/** A time zone the runtime knows (IANA name). */
export function validTimeZone(zone: string): boolean {
  if (!zone || zone.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** "+15145550123" becomes "***0123": the only form a log, an audit row or
 * a screen other than the person's own setting shows. */
export function maskNumber(number: string): string {
  const digits = number.replace(/\D/g, "");
  return digits.length >= 4 ? `***${digits.slice(-4)}` : "***";
}

/** A typed number in E.164: spaces, dashes, dots and parentheses dropped; a
 * ten digit North American number gets +1. */
export function normalizePhone(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const digits = trimmed.replace(/[\s().-]/g, "");
  const withPlus = digits.startsWith("+") ? digits : digits.length === 10 ? `+1${digits}` : digits.length === 11 && digits.startsWith("1") ? `+${digits}` : `+${digits}`;
  return E164.test(withPlus) ? withPlus : null;
}

export type ReachMeParse = { ok: true; settings: ReachMeSettings } | { ok: false; error: string; field: string };

/** The settings as the screen or a bot sent them, or why not. Unknown
 * channels are refused, duplicates dropped. */
export function parseReachMe(value: unknown): ReachMeParse {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, error: "Send an object { channels, smsNumber?, hours }.", field: "body" };
  const input = value as Record<string, unknown>;
  const rawChannels = input.channels;
  if (!Array.isArray(rawChannels)) return { ok: false, error: "channels is a list: push, sms, teams, telegram, whatsapp.", field: "channels" };
  const channels: ReachChannelId[] = [];
  for (const entry of rawChannels) {
    if (typeof entry !== "string" || !(REACH_CHANNELS as readonly string[]).includes(entry)) {
      return { ok: false, error: `Unknown channel. Use push, sms, teams, telegram or whatsapp.`, field: "channels" };
    }
    if (!channels.includes(entry as ReachChannelId)) channels.push(entry as ReachChannelId);
  }
  let smsNumber: string | undefined;
  if (input.smsNumber !== undefined && input.smsNumber !== null && input.smsNumber !== "") {
    if (typeof input.smsNumber !== "string") return { ok: false, error: "smsNumber is your phone number, like +15145550123.", field: "smsNumber" };
    const normalized = normalizePhone(input.smsNumber);
    if (!normalized) return { ok: false, error: "smsNumber is not a phone number in international form (+1 514 555 0123).", field: "smsNumber" };
    smsNumber = normalized;
  }
  if (channels.includes("sms") && !smsNumber) return { ok: false, error: "Text messages need your own phone number.", field: "smsNumber" };
  const hours = parseHours(input.hours);
  if ("error" in hours) return { ok: false, error: hours.error, field: "hours" };
  return { ok: true, settings: { channels, ...(smsNumber ? { smsNumber } : {}), hours } };
}

function parseHours(value: unknown): ReachHours | { error: string } {
  if (value === undefined || value === null) return { always: true };
  if (typeof value !== "object" || Array.isArray(value)) return { error: "hours is { always: true } or { always: false, timeZone, ranges }." };
  const input = value as Record<string, unknown>;
  if (input.always !== false) return { always: true };
  const timeZone = typeof input.timeZone === "string" ? input.timeZone.trim() : "";
  if (!validTimeZone(timeZone)) return { error: "hours.timeZone is a time zone name, like America/Toronto." };
  if (!Array.isArray(input.ranges) || input.ranges.length === 0) return { error: "hours.ranges needs at least one range of days and times." };
  if (input.ranges.length > REACH_MAX_RANGES) return { error: `At most ${REACH_MAX_RANGES} ranges.` };
  const ranges: ReachHoursRange[] = [];
  for (const raw of input.ranges) {
    if (!raw || typeof raw !== "object") return { error: "Each range is { days, start, end }." };
    const range = raw as Record<string, unknown>;
    const days = Array.isArray(range.days) ? [...new Set(range.days.filter((day): day is number => Number.isInteger(day) && day >= 0 && day <= 6))].sort() : [];
    if (!days.length) return { error: "Each range needs at least one day (0 Sunday to 6 Saturday)." };
    const start = typeof range.start === "string" ? range.start : "";
    const end = typeof range.end === "string" ? range.end : "";
    if (!HHMM.test(start) || !HHMM.test(end)) return { error: "Times are HH:MM, 24 hours (08:00, 17:30)." };
    if (start === end) return { error: "A range starts and ends at different times." };
    ranges.push({ days, start, end });
  }
  return { always: false, timeZone, ranges };
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** The weekday (0 Sunday) and the minute of the day at `atMs` in `timeZone`. */
export function localClock(atMs: number, timeZone: string): { day: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(atMs));
  const read = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const hour = Number(read("hour")) % 24;
  return { day: WEEKDAYS[read("weekday")] ?? 0, minute: hour * 60 + Number(read("minute")) };
}

/** Reply codes: four letters and digits a person types back, with nothing
 * that reads twice (no 0/O, 1/I/L, 2/Z, 5/S, 8/B, G/6). */
export const REACH_CODE_ALPHABET = "ACDEFHJKMNPRTUVWXY3479";
export const REACH_CODE = /^[ACDEFHJKMNPRTUVWXY3479]{4}$/;

export type ReachDecision = "allow" | "deny";

const ALLOW_WORDS = new Set(["oui", "yes", "y", "o", "ok", "okay", "allow", "autoriser", "autorise", "approve", "approuve", "approuver", "go", "vas-y", "accepte", "accept", "1", "👍"]);
const DENY_WORDS = new Set(["non", "no", "n", "deny", "refuse", "refuser", "refusé", "stop", "annule", "decline", "2", "👎"]);

/** What the words after the code say: allow, deny, or nothing clear. Only
 * the first word counts, so "oui mais non" is a yes and "non merci" a no:
 * the person reads their reply before sending it. */
export function readReachDecision(words: string): ReachDecision | null {
  const first = words.trim().toLowerCase().split(/[\s,.!;:]+/u)[0] ?? "";
  if (ALLOW_WORDS.has(first)) return "allow";
  if (DENY_WORDS.has(first)) return "deny";
  return null;
}

/** A reply's code and the words after it, or null. The code comes first,
 * on its own (`K7Q2 oui`, `k7q2: non`, `K7Q2 - mardi 10 h`). */
export function splitReachReply(text: string): { code: string; rest: string } | null {
  const match = /^\s*([A-Za-z0-9]{4})(?=$|[\s:,.\-\u2013\u2014])[\s:,.\-\u2013\u2014]*([\s\S]*)$/u.exec(text);
  if (!match) return null;
  const code = match[1]!.toUpperCase();
  if (!REACH_CODE.test(code)) return null;
  return { code, rest: match[2]!.trim() };
}
