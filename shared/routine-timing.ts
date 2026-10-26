// Exact or flexible start times for a repeating routine.
//
// Exact (or no timing at all) starts at the scheduled slot. Flexible starts
// somewhere in [slot - early, slot + late]. The choice is a pure hash of the
// routine id and that slot, so a restart picks the same instant. The next
// slot is still computed from the nominal time, not from the shifted start.
// Stored early and late minutes are kept as written. The half-gap cap is
// applied only when a start is placed.

import { nextCronRuns } from "./routine-schedule.ts";
import { zonedParts, zonedTimeToUtc } from "./zoned-time.ts";

export const FLEXIBLE_DEFAULT_EARLY_MINUTES = 15;
export const FLEXIBLE_DEFAULT_LATE_MINUTES = 15;

/** A window wider than this is rejected. The cap against the gap is smaller. */
const MAX_WINDOW_MINUTES = 366 * 24 * 60;

/** Low 48 bits of the hash, matching the width of the old digest. */
const ROLL_MASK = (1n << 48n) - 1n;
const ROLL_SPACE = 2 ** 48;

const HOUR_MS = 60 * 60_000;
const DAY_MS = 24 * HOUR_MS;

export interface RoutineWindowTiming {
  /** Absent or "exact": start at the scheduled time. "flexible": start inside the window. */
  timing?: "exact" | "flexible";
  /** Minutes before the scheduled time. Only stored for flexible timing. */
  windowEarlyMinutes?: number;
  /** Minutes after the scheduled time. 0 means ready by the scheduled time. */
  windowLateMinutes?: number;
}

export interface TimingRequest {
  timing?: unknown;
  windowEarlyMinutes?: unknown;
  windowLateMinutes?: unknown;
}

interface GapSchedule {
  type: string;
  everyMinutes?: number;
  weekdays?: number[];
  expression?: string;
  timeZone?: string;
  windowEarlyMinutes?: number;
  windowLateMinutes?: number;
}

export function timingRequestOf(value: unknown): TimingRequest | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  if (raw.timing == null && raw.windowEarlyMinutes == null && raw.windowLateMinutes == null) return undefined;
  return {
    timing: raw.timing,
    windowEarlyMinutes: raw.windowEarlyMinutes,
    windowLateMinutes: raw.windowLateMinutes,
  };
}

export function hasTimingInput(value: unknown): boolean {
  return timingRequestOf(value) !== undefined;
}

/** Minutes the two sides may share: half the gap, rounded down. */
export function windowCapMinutes(gapMs: number): number {
  if (!Number.isFinite(gapMs) || gapMs <= 0) return Number.MAX_SAFE_INTEGER;
  return Math.max(0, Math.floor(gapMs / 2 / 60_000));
}

/**
 * Shrink a window so early + late is at most `cap`. A zero side stays zero.
 * Leftover minutes go to the side with the larger fractional share; a tie
 * keeps the early side.
 */
export function clampTimingWindow(early: number, late: number, cap: number): { early: number; late: number } {
  if (cap <= 0) return { early: 0, late: 0 };
  if (early + late <= cap) return { early, late };
  if (early === 0) return { early: 0, late: Math.min(late, cap) };
  if (late === 0) return { early: Math.min(early, cap), late: 0 };
  const scale = cap / (early + late);
  let nextEarly = Math.floor(early * scale);
  let nextLate = Math.floor(late * scale);
  const leftover = cap - nextEarly - nextLate;
  if (leftover > 0) {
    const earlyFrac = early * scale - nextEarly;
    const lateFrac = late * scale - nextLate;
    if (earlyFrac >= lateFrac) nextEarly += leftover;
    else nextLate += leftover;
  }
  return { early: nextEarly, late: nextLate };
}

/** Shortest gap between the selected weekdays, as a whole number of days. */
export function dailyGapMs(weekdays: readonly number[]): number {
  const days = [...new Set(weekdays.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))].sort((a, b) => a - b);
  if (days.length <= 1) return 7 * DAY_MS;
  let minDays = 7;
  for (let index = 0; index < days.length; index++) {
    const current = days[index]!;
    const next = days[(index + 1) % days.length]!;
    const gap = (next - current + 7) % 7;
    if (gap > 0 && gap < minDays) minDays = gap;
  }
  return minDays * DAY_MS;
}

const MONTH_NAMES = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const WEEKDAY_NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/** Three-letter month or weekday names, in any case, become numbers. A longer word stays, so the field is walked. */
function rewriteNames(field: string, names: readonly string[], origin: number): string | null {
  if (!/[A-Za-z]/.test(field)) return field;
  let invalid = false;
  const rewritten = field.replace(/[A-Za-z]+/g, (word) => {
    const index = names.indexOf(word.toLowerCase());
    if (index < 0) {
      invalid = true;
      return word;
    }
    return String(index + origin);
  });
  return invalid ? null : rewritten;
}

/** One cron field (star, a number, a range, a step, or a comma list) as sorted values. */
function parseCronField(field: string, min: number, max: number): number[] | null {
  if (/[^0-9*,/-]/.test(field)) return null;
  const values = new Set<number>();
  for (const piece of field.split(",")) {
    if (!piece) return null;
    const stepSplit = piece.split("/");
    if (stepSplit.length > 2) return null;
    const step = stepSplit.length === 2 ? Number(stepSplit[1]) : 1;
    if (!Number.isInteger(step) || step <= 0) return null;
    const range = stepSplit[0]!;
    let start: number;
    let end: number;
    if (range === "*") {
      start = min;
      end = max;
    } else if (range.includes("-")) {
      const [rawStart, rawEnd] = range.split("-");
      if (rawEnd === undefined || range.split("-").length !== 2) return null;
      start = Number(rawStart);
      end = Number(rawEnd);
    } else {
      start = Number(range);
      end = stepSplit.length === 2 ? max : start;
    }
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < min || end > max || start > end) return null;
    for (let value = start; value <= end; value += step) values.add(value);
  }
  return values.size === 0 ? null : [...values].sort((a, b) => a - b);
}

const DAY_MINUTES = 24 * 60;
const GAP_CACHE_LIMIT = 64;

interface CronParts {
  minutes: number[];
  hours: number[];
  /** Null means every day of the month. */
  days: number[] | null;
  /** Null means every month. */
  months: number[] | null;
  /** Null means every weekday. Sunday is 0; a written 7 is folded in. */
  weekdays: number[] | null;
}

interface CivilDate {
  year: number;
  month: number;
  day: number;
  weekday: number;
}

interface SpringJump extends CivilDate {
  /** Wall minute the clocks leave. The following shiftMinutes do not occur. */
  startMinute: number;
  shiftMinutes: number;
}

/** How many times a cron gap was computed rather than remembered. */
let gapMisses = 0;
const gapCache = new Map<string, number>();
const springCache = new Map<string, SpringJump[]>();

export function cronGapCacheMisses(): number {
  return gapMisses;
}

function cronParts(expression: string): CronParts | null {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) return null;
  const [minuteField, hourField, dayField, monthField, weekdayField] = fields;
  const minutes = parseCronField(minuteField!, 0, 59);
  const hours = parseCronField(hourField!, 0, 23);
  if (!minutes || !hours) return null;
  const monthSource = monthField === "*" || monthField === "?" ? monthField : rewriteNames(monthField!, MONTH_NAMES, 1);
  const weekdaySource = weekdayField === "*" || weekdayField === "?" ? weekdayField : rewriteNames(weekdayField!, WEEKDAY_NAMES, 0);
  if (monthSource == null || weekdaySource == null) return null;
  const days = dayField === "*" || dayField === "?" ? null : parseCronField(dayField!, 1, 31);
  const months = monthSource === "*" || monthSource === "?" ? null : parseCronField(monthSource, 1, 12);
  const rawWeekdays = weekdaySource === "*" || weekdaySource === "?" ? null : parseCronField(weekdaySource, 0, 7);
  if ((dayField !== "*" && dayField !== "?" && !days) || (monthSource !== "*" && monthSource !== "?" && !months)) return null;
  if (weekdaySource !== "*" && weekdaySource !== "?" && !rawWeekdays) return null;
  const weekdays = rawWeekdays ? [...new Set(rawWeekdays.map((day) => day % 7))].sort((a, b) => a - b) : null;
  return { minutes, hours, days, months, weekdays };
}

function minuteSlots(minutes: number[], hours: number[]): number[] {
  const slots = new Set<number>();
  for (const hour of hours) {
    for (const minute of minutes) slots.add(hour * 60 + minute);
  }
  return [...slots].sort((a, b) => a - b);
}

function dateMatches(date: CivilDate, parts: CronParts): boolean {
  if (parts.months && !parts.months.includes(date.month)) return false;
  const dayOk = !parts.days || parts.days.includes(date.day);
  const weekdayOk = !parts.weekdays || parts.weekdays.includes(date.weekday);
  // When both the day and the weekday are restricted, either one is enough.
  if (parts.days && parts.weekdays) return dayOk || weekdayOk;
  return dayOk && weekdayOk;
}

function civilDate(year: number, month: number, day: number): CivilDate {
  const at = new Date(Date.UTC(year, month - 1, day));
  return { year: at.getUTCFullYear(), month: at.getUTCMonth() + 1, day: at.getUTCDate(), weekday: at.getUTCDay() };
}

/** Shortest number of days from one matching day to the next.
 * The span is a multiple of 7, so a weekly schedule wraps onto the same weekday,
 * and it still covers 2024 through 2031, including both leap days. */
function minimumDayDistance(parts: CronParts): number | null {
  if (!parts.days && !parts.months && !parts.weekdays) return 1;
  const start = Date.UTC(2024, 0, 1);
  const span = Math.round((Date.UTC(2032, 0, 1) - start) / DAY_MS);
  const total = span - (span % 7);
  let previous: number | undefined;
  let first: number | undefined;
  let min = Number.POSITIVE_INFINITY;
  for (let index = 0; index < total; index++) {
    const at = new Date(start + index * DAY_MS);
    const date = { year: at.getUTCFullYear(), month: at.getUTCMonth() + 1, day: at.getUTCDate(), weekday: at.getUTCDay() };
    if (!dateMatches(date, parts)) continue;
    if (first == null) first = index;
    if (previous != null) min = Math.min(min, index - previous);
    previous = index;
  }
  if (first == null || previous == null) return null;
  return Math.min(min, total - previous + first);
}

/** Wall-clock minutes between consecutive slots, including the next matching day. */
function wallGapMinutes(slots: number[], parts: CronParts): number {
  let min = Number.POSITIVE_INFINITY;
  for (let index = 1; index < slots.length; index++) min = Math.min(min, slots[index]! - slots[index - 1]!);
  const distance = minimumDayDistance(parts);
  if (distance == null) return min;
  const last = slots[slots.length - 1]!;
  const first = slots[0]!;
  return Math.min(min, distance * DAY_MINUTES - last + first);
}

function showsWallMinute(date: CivilDate, minuteOfDay: number, timeZone: string): boolean {
  const hour = Math.floor(minuteOfDay / 60);
  const minute = minuteOfDay % 60;
  const utc = zonedTimeToUtc(date.year, date.month, date.day, hour, minute, timeZone);
  const shown = zonedParts(utc, timeZone);
  return shown.year === date.year && shown.month === date.month && shown.day === date.day && shown.hour === hour && shown.minute === minute;
}

function firstMissingMinute(date: CivilDate, timeZone: string): number | null {
  const step = 10;
  let probe = 0;
  while (probe < DAY_MINUTES && showsWallMinute(date, probe, timeZone)) probe += step;
  if (probe >= DAY_MINUTES) return null;
  let lo = Math.max(0, probe - step);
  let hi = Math.min(probe, DAY_MINUTES - 1);
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (showsWallMinute(date, mid, timeZone)) lo = mid + 1;
    else hi = mid;
  }
  return showsWallMinute(date, lo, timeZone) ? null : lo;
}

function noonOffset(date: CivilDate, timeZone: string): number {
  const utc = zonedTimeToUtc(date.year, date.month, date.day, 12, 0, timeZone);
  return Date.UTC(date.year, date.month - 1, date.day, 12, 0) - utc;
}

/** Spring-forward jumps from 2024 through 2031. Fall-back repeats an hour, so it never shortens a gap. */
function springJumps(timeZone: string): SpringJump[] {
  const cached = springCache.get(timeZone);
  if (cached) return cached;
  const store = (jumps: SpringJump[]) => {
    springCache.set(timeZone, jumps);
    return jumps;
  };
  if (timeZone === "UTC" || timeZone === "Etc/UTC" || timeZone === "Etc/GMT" || timeZone === "GMT") return store([]);
  try {
    const samples = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((month) => noonOffset(civilDate(2026, month, 15), timeZone));
    if (samples.every((offset) => offset === samples[0])) return store([]);
    const jumps: SpringJump[] = [];
    let previous = noonOffset(civilDate(2024, 1, 1), timeZone);
    const origin = Date.UTC(2024, 0, 1);
    const end = Date.UTC(2032, 0, 1);
    for (let index = 7; origin + index * DAY_MS < end; index += 7) {
      const probe = new Date(origin + index * DAY_MS);
      const probeDate = civilDate(probe.getUTCFullYear(), probe.getUTCMonth() + 1, probe.getUTCDate());
      const offset = noonOffset(probeDate, timeZone);
      if (offset >= previous + 30 * 60_000) {
        let seen = previous;
        for (let dayIndex = 1; dayIndex <= 7; dayIndex++) {
          const at = new Date(origin + (index - 7 + dayIndex) * DAY_MS);
          const date = civilDate(at.getUTCFullYear(), at.getUTCMonth() + 1, at.getUTCDate());
          const dayOffset = noonOffset(date, timeZone);
          if (dayOffset >= seen + 30 * 60_000) {
            const startMinute = firstMissingMinute(date, timeZone);
            if (startMinute != null) {
              jumps.push({ ...date, startMinute, shiftMinutes: Math.round((dayOffset - seen) / 60_000) });
            }
            break;
          }
          seen = dayOffset;
        }
      }
      previous = offset;
    }
    return store(jumps);
  } catch {
    return store([]);
  }
}

function adjacentMatch(date: CivilDate, parts: CronParts, direction: -1 | 1): CivilDate | null {
  for (let delta = 1; delta <= 8 * 366; delta++) {
    const next = civilDate(date.year, date.month, date.day + direction * delta);
    if (dateMatches(next, parts)) return next;
  }
  return null;
}

/** The instant this wall minute runs. A minute inside a spring-forward gap lands at the later time, the same way a cron run does. */
function slotInstant(date: CivilDate, minuteOfDay: number, timeZone: string): number {
  const hour = Math.floor(minuteOfDay / 60);
  const minute = minuteOfDay % 60;
  return zonedTimeToUtc(date.year, date.month, date.day, hour, minute, timeZone);
}

function boundaryMinutes(from: CivilDate, fromSlot: number, to: CivilDate, toSlot: number, timeZone: string): number | null {
  const start = slotInstant(from, fromSlot, timeZone);
  const end = slotInstant(to, toSlot, timeZone);
  if (end <= start) return null;
  return Math.round((end - start) / 60_000);
}

/**
 * A spring-forward removes the skipped minutes from a gap that contains them.
 * A slot inside the skipped hour is counted at the later instant it moves to.
 * Only that shorter real gap can undercut the wall-clock minimum.
 */
function shortenForSpring(slots: number[], wall: number, timeZone: string, parts: CronParts): number {
  if (!Number.isFinite(wall) || wall <= 1) return wall;
  const jumps = springJumps(timeZone);
  if (jumps.length === 0) return wall;
  let best = wall;
  const first = slots[0]!;
  const last = slots[slots.length - 1]!;
  for (const jump of jumps) {
    const prev = adjacentMatch(jump, parts, -1);
    const next = adjacentMatch(jump, parts, 1);
    if (dateMatches(jump, parts)) {
      for (let index = 1; index < slots.length; index++) {
        const gap = boundaryMinutes(jump, slots[index - 1]!, jump, slots[index]!, timeZone);
        if (gap != null && gap < best) best = gap;
      }
      // The skipped hour sits between the previous matching day and this one
      // when today's first slot is already after the jump.
      if (prev) {
        const incoming = boundaryMinutes(prev, last, jump, first, timeZone);
        if (incoming != null && incoming < best) best = incoming;
      }
      if (next) {
        const outgoing = boundaryMinutes(jump, last, next, first, timeZone);
        if (outgoing != null && outgoing < best) best = outgoing;
      }
    } else if (prev && next) {
      const spanned = boundaryMinutes(prev, last, next, first, timeZone);
      if (spanned != null && spanned < best) best = spanned;
    }
  }
  return best;
}

/**
 * How far a worded cron must be walked. A weekday-only expression repeats
 * every week. A day or month name needs a year. Very frequent worded
 * expressions can still be cut off after 2,500 steps.
 */
function restrictedCronCycleMs(expression: string): number {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) return 366 * DAY_MS;
  const dayField = fields[2]!;
  const monthField = fields[3]!;
  const weekdayField = fields[4]!;
  const dayRestricted = dayField !== "*" && dayField !== "?";
  const monthRestricted = monthField !== "*" && monthField !== "?";
  const weekdayRestricted = weekdayField !== "*" && weekdayField !== "?";
  if (!dayRestricted && !monthRestricted && weekdayRestricted) return 7 * DAY_MS;
  return 366 * DAY_MS;
}

function walkFrom(expression: string, timeZone: string, after: number, cycle: number): number {
  const schedule = { type: "cron" as const, expression, timeZone };
  let cursor = after;
  let first: number | undefined;
  let previous: number | undefined;
  let min = Number.POSITIVE_INFINITY;
  const deadline = after + 8 * 366 * DAY_MS;
  for (let step = 0; step < 2500; step++) {
    const next = nextCronRuns(schedule, cursor, 1)[0];
    if (next == null || next > deadline) break;
    if (first == null) first = next;
    if (previous != null) {
      min = Math.min(min, next - previous);
      if (next - first >= cycle) break;
    }
    previous = next;
    cursor = next;
  }
  return min;
}

/** Worded month or weekday fields. Anchored on a fixed week and on each spring-forward, not on the caller. */
function walkedCronGapMs(expression: string, timeZone: string): number {
  const cycle = restrictedCronCycleMs(expression);
  const anchors = [Date.UTC(2026, 5, 15)];
  try {
    for (const jump of springJumps(timeZone)) {
      anchors.push(Date.UTC(jump.year, jump.month - 1, jump.day) - 2 * DAY_MS);
    }
  } catch {
    // A zone that cannot be read keeps the fixed week.
  }
  let min = Number.POSITIVE_INFINITY;
  for (const after of anchors) min = Math.min(min, walkFrom(expression, timeZone, after, cycle));
  return min;
}

function computeCronGapMs(expression: string, timeZone: string): number {
  const parts = cronParts(expression);
  if (!parts) return walkedCronGapMs(expression, timeZone);
  const slots = minuteSlots(parts.minutes, parts.hours);
  if (slots.length === 0) return Number.POSITIVE_INFINITY;
  const wall = wallGapMinutes(slots, parts);
  return shortenForSpring(slots, wall, timeZone, parts) * 60_000;
}

function cachedCronGapMs(expression: string, timeZone: string): number {
  const key = `${timeZone}\0${expression.trim().replace(/\s+/g, " ")}`;
  const found = gapCache.get(key);
  if (found !== undefined) {
    gapCache.delete(key);
    gapCache.set(key, found);
    return found;
  }
  gapMisses += 1;
  const gap = computeCronGapMs(expression, timeZone);
  gapCache.set(key, gap);
  if (gapCache.size > GAP_CACHE_LIMIT) {
    const oldest = gapCache.keys().next().value;
    if (oldest !== undefined) gapCache.delete(oldest);
  }
  return gap;
}

/** Gap used to cap a window. A cron gap is the real shortest gap, remembered per expression and zone. */
export function nominalGapMs(schedule: GapSchedule, _after: number): number {
  if (schedule.type === "interval" && typeof schedule.everyMinutes === "number") return schedule.everyMinutes * 60_000;
  if (schedule.type === "daily") return dailyGapMs(schedule.weekdays ?? []);
  if (schedule.type === "cron" && schedule.expression && schedule.timeZone) {
    return cachedCronGapMs(schedule.expression, schedule.timeZone);
  }
  return Number.POSITIVE_INFINITY;
}

function wholeMinutes(value: unknown, fallback: number, label: string): number {
  if (value == null) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > MAX_WINDOW_MINUTES) {
    throw new Error(`${label} must be a whole number of minutes`);
  }
  return value;
}

/** Null means exact. Flexible minutes are stored as given; the cap is applied later. */
export function resolveTiming(request: TimingRequest | undefined): { early: number; late: number } | null {
  if (!request) return null;
  const { timing } = request;
  if (timing == null) {
    if (request.windowEarlyMinutes != null || request.windowLateMinutes != null) {
      throw new Error("Exact timing does not take a window");
    }
    return null;
  }
  if (timing === "exact") {
    if (request.windowEarlyMinutes != null || request.windowLateMinutes != null) {
      throw new Error("Exact timing does not take a window");
    }
    return null;
  }
  if (timing !== "flexible") throw new Error("Choose exact or flexible timing");
  return {
    early: wholeMinutes(request.windowEarlyMinutes, FLEXIBLE_DEFAULT_EARLY_MINUTES, "The early window"),
    late: wholeMinutes(request.windowLateMinutes, FLEXIBLE_DEFAULT_LATE_MINUTES, "The late window"),
  };
}

/** The window a start is actually placed in: stored minutes, narrowed to the cap. */
export function cappedWindow(schedule: GapSchedule, at: number): { early: number; late: number } {
  const early = schedule.windowEarlyMinutes ?? FLEXIBLE_DEFAULT_EARLY_MINUTES;
  const late = schedule.windowLateMinutes ?? FLEXIBLE_DEFAULT_LATE_MINUTES;
  return clampTimingWindow(early, late, windowCapMinutes(nominalGapMs(schedule, at)));
}

/** Keep an explicit "exact" choice on a proposal so a later save can clear flexible. */
export function presentTiming<T extends { type: string }>(schedule: T, source: unknown): T {
  if (schedule.type === "once") {
    if (hasTimingInput(source)) throw new Error("A one-time routine starts at its chosen time");
    return schedule;
  }
  const request = timingRequestOf(source);
  if (!request) return schedule;
  if (request.timing === "exact") {
    if (request.windowEarlyMinutes != null || request.windowLateMinutes != null) {
      throw new Error("Exact timing does not take a window");
    }
    return { ...schedule, timing: "exact" as const };
  }
  const resolved = resolveTiming(request);
  if (!resolved) return schedule;
  return {
    ...schedule,
    timing: "flexible" as const,
    windowEarlyMinutes: resolved.early,
    windowLateMinutes: resolved.late,
  };
}

/** Persistence form. Exact and absent timing omit the keys entirely. */
export function applyTiming<T extends { type: string }>(schedule: T, source: unknown): T {
  const presented = presentTiming(schedule, source);
  if ((presented as { timing?: string }).timing === "exact") return schedule;
  return presented;
}

export function storedTiming(schedule: {
  type: string;
  timing?: "exact" | "flexible";
  windowEarlyMinutes?: number;
  windowLateMinutes?: number;
}): RoutineWindowTiming {
  if (schedule.type === "once" || schedule.timing !== "flexible") return {};
  return {
    timing: "flexible",
    windowEarlyMinutes: schedule.windowEarlyMinutes,
    windowLateMinutes: schedule.windowLateMinutes,
  };
}

export function isFlexibleSchedule<T extends { type: string; timing?: string }>(
  schedule: T,
): schedule is T & { timing: "flexible"; windowEarlyMinutes?: number; windowLateMinutes?: number } {
  return schedule.type !== "once" && schedule.timing === "flexible";
}

/** FNV-1a over the UTF-16 code units, low 48 bits. No platform crypto. */
function fnv1a48(text: string): number {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (let index = 0; index < text.length; index++) {
    hash ^= BigInt(text.charCodeAt(index));
    hash = (hash * prime) & 0xffffffffffffffffn;
  }
  return Number(hash & ROLL_MASK);
}

/** Inclusive instant in [nominal - early, nominal + late]. Span 0 is the nominal. */
export function flexibleStartAt(routineId: string, nominalAt: number, earlyMinutes: number, lateMinutes: number): number {
  const earlyMs = earlyMinutes * 60_000;
  const lateMs = lateMinutes * 60_000;
  const span = earlyMs + lateMs;
  if (span <= 0) return nominalAt;
  const roll = fnv1a48(`${routineId}\0${nominalAt}`);
  const offset = Math.min(span, Math.floor((roll / ROLL_SPACE) * (span + 1)));
  return nominalAt - earlyMs + offset;
}

/**
 * The hashed start, moved forward to `notBefore` while the window is still
 * open. Null when even the late edge is already past.
 */
export function placedStart(picked: number, nominalAt: number, lateMinutes: number, notBefore: number): number | null {
  const latest = nominalAt + lateMinutes * 60_000;
  if (latest < notBefore) return null;
  return picked >= notBefore ? picked : notBefore;
}

/**
 * First nominal strictly after `afterNominal` whose window is still open at
 * `notBefore`, and strictly after `lastFiredNominalAt` when one is set.
 * One step: interval math and cron's next-after-now already jump, so a long
 * outage does not walk slot by slot. The start is never before `notBefore`.
 */
export function planFlexibleStart(input: {
  routineId: string;
  schedule: GapSchedule;
  afterNominal: number;
  notBefore: number;
  lastFiredNominalAt?: number;
  nextNominal: (after: number) => number | null;
}): { start: number; nominal: number } | null {
  const window = cappedWindow(input.schedule, input.notBefore);
  const lateMs = window.late * 60_000;
  let cursor = Math.max(input.afterNominal, input.notBefore - lateMs - 1);
  const fired = input.lastFiredNominalAt;
  if (fired != null && fired > cursor) cursor = fired;
  const nominal = input.nextNominal(cursor);
  if (nominal == null || !(nominal > cursor)) return null;
  if (fired != null && nominal <= fired) return null;
  const picked = flexibleStartAt(input.routineId, nominal, window.early, window.late);
  const placed = placedStart(picked, nominal, window.late, input.notBefore);
  return placed == null ? null : { start: placed, nominal };
}
