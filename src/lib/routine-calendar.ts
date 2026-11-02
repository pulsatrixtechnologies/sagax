import type { Routine, RoutineRun, RoutineSchedule } from "./routines";
import { createCronRunPreview } from "../../shared/routine-schedule";

import { activeLocale } from "@/lib/i18n";
export const CALENDAR_SLOT_MINUTES = 5;
const ROUTINE_MARKER_MINUTES = 30;
const MAX_RECEIPTS_PER_ROUTINE_PER_RANGE = 12;
/** nextCronRuns answers at most this many runs per call. */
const CRON_BATCH = 1000;
/**
 * Half-hour buckets for the calendar "+N" stack (`groupCalendarSlots`).
 * Dense cron projections emit at most one marker per bucket so a per-minute
 * expression covers the day without 288 React nodes per routine (#1677).
 */
export const SLOT_GROUP_MS = 30 * 60_000;
/** Cadence at or below one calendar slot is collapsed into SLOT_GROUP_MS. */
const DENSE_CRON_GAP_MS = CALENDAR_SLOT_MINUTES * 60_000;

export type RoutineCalendarItem = {
  id: string;
  at: number;
  durationMinutes: number;
  routine: Routine | null;
  run: RoutineRun | null;
};

export type CalendarCollisionItem = {
  id: string;
  at: number;
  durationMinutes: number;
};

export type CalendarCollisionLayout = {
  column: number;
  columns: number;
};

export function startOfDay(at: number): number {
  const date = new Date(at);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

export function addDays(at: number, days: number): number {
  const date = new Date(at);
  date.setDate(date.getDate() + days);
  return date.getTime();
}

export function startOfWeek(at: number): number {
  const date = new Date(startOfDay(at));
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return date.getTime();
}

export function atLocalTime(day: number, time: string): number {
  const [hour, minute] = time.split(":").map(Number);
  const date = new Date(day);
  date.setHours(hour, minute, 0, 0);
  return date.getTime();
}

export function toLocalDateInput(at: number): string {
  const date = new Date(at - new Date(at).getTimezoneOffset() * 60_000);
  return date.toISOString().slice(0, 10);
}

export function toLocalTimeInput(at: number): string {
  const date = new Date(at - new Date(at).getTimezoneOffset() * 60_000);
  return date.toISOString().slice(11, 16);
}

export function fromLocalDateAndTime(date: string, time: string, originalAt?: number): number {
  // Date/time inputs display minutes, but agent-created schedules can carry
  // seconds and milliseconds. A title-only save must not move the anchor or
  // choose a different occurrence of a repeated local time at a DST boundary.
  if (originalAt != null && date === toLocalDateInput(originalAt) && time === toLocalTimeInput(originalAt)) return originalAt;
  return new Date(`${date}T${time}`).getTime();
}

/** Start a new interval at least one full cadence from now, on a clean minute boundary. */
export function nextIntervalAnchor(now: number, everyMinutes: number): number {
  return Math.ceil((now + everyMinutes * 60_000) / 60_000) * 60_000;
}

export function intervalAnchorForSave(
  now: number,
  everyMinutes: number,
  current?: { everyMinutes: number; anchorAt: number },
): number {
  return current?.everyMinutes === everyMinutes
    ? current.anchorAt
    : nextIntervalAnchor(now, everyMinutes);
}

/** The next cadence point, retaining the original phase when editing. */
export function nextIntervalForSave(
  now: number,
  everyMinutes: number,
  current?: { everyMinutes: number; anchorAt: number },
): number {
  const anchor = intervalAnchorForSave(now, everyMinutes, current);
  if (anchor > now) return anchor;
  const intervalMs = everyMinutes * 60_000;
  return anchor + (Math.floor((now - anchor) / intervalMs) + 1) * intervalMs;
}

export function snapMinutes(minutes: number, increment = CALENDAR_SLOT_MINUTES): number {
  return Math.max(0, Math.min(24 * 60 - increment, Math.round(minutes / increment) * increment));
}

/**
 * Assign overlapping events to stable, side-by-side columns. Adjacent events can
 * reuse a column, while overlap chains share one column count so cards never
 * cover each other as a cluster grows.
 */
export function packCalendarCollisions(
  items: readonly CalendarCollisionItem[],
): Map<string, CalendarCollisionLayout> {
  // Short events keep a 16px hit target in the renderer. Pack against that
  // same visual footprint so adjacent five-minute cards never cover each other.
  const visualEnd = (item: CalendarCollisionItem) =>
    item.at + Math.max(15, item.durationMinutes) * 60_000;
  const sorted = [...items].sort((left, right) =>
    left.at - right.at
    || visualEnd(left) - visualEnd(right)
    || left.id.localeCompare(right.id),
  );
  const result = new Map<string, CalendarCollisionLayout>();

  for (let cursor = 0; cursor < sorted.length;) {
    const cluster: CalendarCollisionItem[] = [];
    let clusterEnd = sorted[cursor]!.at;
    while (cursor < sorted.length) {
      const item = sorted[cursor]!;
      if (cluster.length > 0 && item.at >= clusterEnd) break;
      cluster.push(item);
      clusterEnd = Math.max(clusterEnd, visualEnd(item));
      cursor += 1;
    }

    const columnEnds: number[] = [];
    const assignments = cluster.map((item) => {
      const available = columnEnds.findIndex((end) => end <= item.at);
      const column = available === -1 ? columnEnds.length : available;
      columnEnds[column] = visualEnd(item);
      return { id: item.id, column };
    });
    const columns = Math.max(1, columnEnds.length);
    for (const assignment of assignments) {
      result.set(assignment.id, { column: assignment.column, columns });
    }
  }

  return result;
}

/** Format a local UTC offset in the compact style used by calendar gutters. */
export function formatGmtOffset(offsetMinutes: number): string {
  if (offsetMinutes === 0) return "GMT+0";
  const sign = offsetMinutes > 0 ? "+" : "-";
  const absolute = Math.abs(offsetMinutes);
  const hours = Math.floor(absolute / 60);
  const minutes = absolute % 60;
  return `GMT${sign}${hours}${minutes ? `:${String(minutes).padStart(2, "0")}` : ""}`;
}

export function slotAt(day: number, clientY: number, top: number, hourHeight: number): number {
  const minutes = snapMinutes(((clientY - top) / hourHeight) * 60);
  const date = new Date(day);
  date.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return date.getTime();
}

export function scheduleAt(schedule: Exclude<RoutineSchedule, { type: "interval" | "cron" }>, occurrenceAt: number, nextAt: number): Exclude<RoutineSchedule, { type: "interval" | "cron" }>;
export function scheduleAt(schedule: RoutineSchedule, occurrenceAt: number, nextAt: number): RoutineSchedule;
export function scheduleAt(schedule: RoutineSchedule, occurrenceAt: number, nextAt: number): RoutineSchedule {
  if (schedule.type === "cron") throw new Error("Edit this routine's schedule to change its cron timing.");
  if (schedule.type === "once") return { type: "once", at: nextAt };
  if (schedule.type === "interval") {
    return {
      ...schedule,
      anchorAt: schedule.anchorAt + (nextAt - occurrenceAt),
    };
  }
  if (schedule.type === "webhook" || schedule.type === "event") return schedule;
  // Limit-reset waits on the engine clock; drag does not move it.
  if (schedule.type === "limit_reset") return schedule;
  const dayDelta = Math.round((startOfDay(nextAt) - startOfDay(occurrenceAt)) / 86_400_000);
  return {
    type: "daily",
    time: toLocalTimeInput(nextAt),
    weekdays: schedule.weekdays.map((weekday: number) => ((weekday + dayDelta) % 7 + 7) % 7).sort(),
    ...(schedule.timing === "flexible"
      ? {
        timing: "flexible" as const,
        windowEarlyMinutes: schedule.windowEarlyMinutes,
        windowLateMinutes: schedule.windowLateMinutes,
      }
      : {}),
  };
}

export function projectedRoutineItems(
  routines: Routine[],
  runs: RoutineRun[],
  from: number,
  to: number,
): RoutineCalendarItem[] {
  const routineById = new Map(routines.map((routine) => [routine.id, routine]));
  const receiptCounts = new Map<string, number>();
  const visibleRuns = runs
    .filter((run) => run.scheduledFor >= from && run.scheduledFor < to)
    .sort((left, right) => right.scheduledFor - left.scheduledFor)
    .filter((run) => {
      if (run.status === "queued" || run.status === "running" || run.status === "waiting") {
        return true;
      }
      // A routine may later be edited or deleted, so the current definition
      // cannot safely tell us whether its history came from a dense interval.
      // Keep active receipts unbounded above, while trimming terminal history.
      const count = receiptCounts.get(run.routineId) ?? 0;
      if (count >= MAX_RECEIPTS_PER_ROUTINE_PER_RANGE) return false;
      receiptCounts.set(run.routineId, count + 1);
      return true;
    });
  const items: RoutineCalendarItem[] = visibleRuns
    .map((run) => ({
      id: `run-${run.id}`,
      at: run.scheduledFor,
      durationMinutes: ROUTINE_MARKER_MINUTES,
      routine: routineById.get(run.routineId) ?? null,
      run,
    }));

  // Runs by routine and minute, so a dense cron does not scan every run per occurrence.
  const receiptMinutes = new Map<string, number[]>();
  for (const run of runs) {
    const key = `${run.routineId}:${Math.floor(run.scheduledFor / 60_000)}`;
    receiptMinutes.set(key, [...(receiptMinutes.get(key) ?? []), run.scheduledFor]);
  }
  const hasReceipt = (routineId: string, at: number) => {
    const minute = Math.floor(at / 60_000);
    return [minute - 1, minute, minute + 1].some((bucket) =>
      (receiptMinutes.get(`${routineId}:${bucket}`) ?? []).some((scheduledFor) => Math.abs(scheduledFor - at) < 60_000));
  };

  for (const routine of routines) {
    if (!routine.enabled) continue;
    if (routine.schedule.type === "cron") {
      // Never reconstruct skipped work before the scheduler's next occurrence.
      // Every run of each visible day shows, up to midnight (#1483: an hourly
      // routine used to stop at 11:00). A cron at or below one calendar slot
      // collapses to one marker per half hour and skips ahead, so croner and
      // React are not asked for every minute (#1677). Sparser crons still
      // emit every occurrence (hourly stays 24/day).
      if (routine.nextRunAt == null) continue;
      const nextRuns = createCronRunPreview(routine.schedule);
      for (let day = startOfDay(Math.max(from, routine.nextRunAt)); day < to; day = addDays(day, 1)) {
        let after = Math.max(day, from, routine.createdAt, routine.nextRunAt) - 1;
        const probe = nextRuns(after, 2);
        if (!probe.length || probe[0]! >= to) break;
        // Jump over empty days for sparse monthly/yearly schedules.
        day = startOfDay(probe[0]!);
        after = Math.max(day, from, routine.createdAt, routine.nextRunAt) - 1;
        const end = Math.min(to, addDays(day, 1));
        const dense = probe.length >= 2 && probe[1]! - probe[0]! <= DENSE_CRON_GAP_MS;
        if (dense) {
          while (after < end) {
            const upcoming = nextRuns(after, 1);
            if (!upcoming.length || upcoming[0]! >= end) break;
            const at = upcoming[0]!;
            if (!hasReceipt(routine.id, at)) items.push({
              id: `next-${routine.id}-${at}`, at, durationMinutes: ROUTINE_MARKER_MINUTES, routine, run: null,
            });
            after = (Math.floor(at / SLOT_GROUP_MS) + 1) * SLOT_GROUP_MS - 1;
          }
          continue;
        }
        let lastSlot = -1;
        while (after < end) {
          const upcoming = nextRuns(after, CRON_BATCH);
          for (const at of upcoming) {
            if (at >= end) break;
            const slot = Math.floor(at / (CALENDAR_SLOT_MINUTES * 60_000));
            if (slot === lastSlot) continue;
            lastSlot = slot;
            if (!hasReceipt(routine.id, at)) items.push({
              id: `next-${routine.id}-${at}`, at, durationMinutes: ROUTINE_MARKER_MINUTES, routine, run: null,
            });
          }
          if (upcoming.length < CRON_BATCH) break;
          after = upcoming[upcoming.length - 1]!;
        }
      }
      continue;
    }
    if (routine.schedule.type === "once") {
      const at = routine.schedule.at;
      if (at >= from && at < to && !hasReceipt(routine.id, at)) {
        items.push({
          id: `next-${routine.id}-${at}`,
          at,
          durationMinutes: ROUTINE_MARKER_MINUTES,
          routine,
          run: null,
        });
      }
      continue;
    }
    if (routine.schedule.type === "interval") {
      // The scheduler deliberately skips overlapping and stale interval ticks.
      // Its persisted nextRunAt is the only future occurrence users can act on;
      // reconstructing an unreceipted tick would resurrect work it skipped.
      const at = routine.nextRunAt;
      if (at != null && at >= from && at < to && !hasReceipt(routine.id, at)) {
        items.push({
          id: `next-${routine.id}-${at}`,
          at,
          durationMinutes: ROUTINE_MARKER_MINUTES,
          routine,
          run: null,
        });
      }
      continue;
    }
    if (routine.schedule.type === "webhook" || routine.schedule.type === "event") continue;
    // Limit-reset uses nextRunAt from the server clock, not a daily wall time.
    if (routine.schedule.type === "limit_reset") continue;
    for (let day = startOfDay(from); day < to; day = addDays(day, 1)) {
      if (!routine.schedule.weekdays.includes(new Date(day).getDay())) continue;
      const at = atLocalTime(day, routine.schedule.time);
      if (at >= from && at < to && at >= routine.createdAt && !hasReceipt(routine.id, at)) {
        items.push({
          id: `next-${routine.id}-${at}`,
          at,
          durationMinutes: ROUTINE_MARKER_MINUTES,
          routine,
          run: null,
        });
      }
    }
  }
  return items.sort((left, right) => left.at - right.at);
}

/**
 * What the Calendar view draws: the PLANNED occurrences only, past and future,
 * at their scheduled time (#872). A run is a log entry (status, result): it
 * never paints the calendar, including past runs of a deleted routine.
 * History stays in List / Logs.
 */
export function scheduledRoutineItems(
  routines: Routine[],
  _runs: RoutineRun[],
  from: number,
  to: number,
): RoutineCalendarItem[] {
  const seen = new Set<string>();
  const items: RoutineCalendarItem[] = [];
  // Empty runs: do not inject receipts as calendar markers. Plans come from
  // the schedule alone (nextRunAt / daily / cron / once).
  for (const item of projectedRoutineItems(routines, [], from, to)) {
    if (!item.routine) continue;
    const id = `plan-${item.routine.id}-${item.at}`;
    if (seen.has(id)) continue;
    seen.add(id);
    items.push({ ...item, id, run: null });
  }
  return items;
}

/**
 * Many routines in the same half hour: draw at most two cards. Past that,
 * the first one stays and the others collapse into one "+N" marker that lists
 * them on demand, instead of a stack of unreadable slivers.
 */
export function groupCalendarSlots<T extends CalendarCollisionItem>(
  items: readonly T[],
  maxVisible = 2,
): { shown: T[]; overflow: Array<{ id: string; at: number; items: T[] }> } {
  const slots = new Map<number, T[]>();
  for (const item of [...items].sort((a, b) => a.at - b.at || a.id.localeCompare(b.id))) {
    const key = Math.floor(item.at / SLOT_GROUP_MS);
    slots.set(key, [...(slots.get(key) ?? []), item]);
  }
  const shown: T[] = [];
  const overflow: Array<{ id: string; at: number; items: T[] }> = [];
  for (const slot of slots.values()) {
    if (slot.length <= maxVisible) { shown.push(...slot); continue; }
    shown.push(slot[0]!);
    const rest = slot.slice(1);
    overflow.push({ id: `more-${slot[0]!.id}`, at: slot[0]!.at, items: rest });
  }
  return { shown, overflow };
}

export function calendarRangeLabel(from: number, days: number): string {
  const to = addDays(from, days - 1);
  const start = new Date(from);
  const end = new Date(to);
  if (days === 1) {
    return start.toLocaleDateString(activeLocale(), { month: "long", day: "numeric", year: "numeric" });
  }
  if (start.getMonth() === end.getMonth()) {
    return `${start.toLocaleDateString(activeLocale(), { month: "long" })} ${start.getDate()} - ${end.getDate()}, ${end.getFullYear()}`;
  }
  return `${start.toLocaleDateString(activeLocale(), { month: "short", day: "numeric" })} - ${end.toLocaleDateString(activeLocale(), { month: "short", day: "numeric", year: "numeric" })}`;
}
