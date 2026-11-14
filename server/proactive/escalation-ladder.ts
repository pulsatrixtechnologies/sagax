/** #4250 (S3): the escalation ladder (docs/proactive.md, "Escalation
 * ladder"). What still waits on the person is told again on a clock that
 * depends on its level, read from the signal ledger (the steps already told
 * are on disk), so a restart neither repeats a step nor starts a clock over.
 *
 * - urgent (a card a bot is blocked on): again after 2 h and after 24 h,
 *   then one line each morning with everything that still waits (the
 *   morning line). Never an automatic text message: a reminder and the
 *   morning line ring the phone, the card itself went by the channels the
 *   person chose when it was raised.
 * - card (a fix item: a routine that keeps having the same problem, an
 *   engine signed out or out of credit): told again after a day, then weekly
 *   while it stays open.
 * - fyi: never reminded.
 *
 * A step missed while the server was down is told once, as the last step
 * due: never one ring per missed step. */
import type { QuietHours, SignalLevel } from "../../shared/signal-levels.ts";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

export interface EscalationLadder {
  /** Delays after the item was first told, one per step. */
  readonly steps: readonly number[];
  /** After the last step: once more every `every` while it stays open. */
  readonly every?: number;
}

/** An urgent card: 2 h, 24 h, then the morning line. */
export const URGENT_LADDER: EscalationLadder = Object.freeze({ steps: Object.freeze([2 * HOUR_MS, DAY_MS]) });

/** A fix item: a day, then weekly. */
export const FIX_LADDER: EscalationLadder = Object.freeze({ steps: Object.freeze([DAY_MS]), every: 7 * DAY_MS });

/** The ladder of a level, or null (FYI is never reminded). */
export function ladderFor(level: SignalLevel): EscalationLadder | null {
  return level === "urgent" ? URGENT_LADDER : level === "card" ? FIX_LADDER : null;
}

/** When step `step` (1, 2...) is due for an item first told at `firstAt`,
 * or null when the ladder has no such step. */
export function stepDueAt(ladder: EscalationLadder, firstAt: number, step: number): number | null {
  if (step <= 0) return firstAt;
  if (step <= ladder.steps.length) return firstAt + ladder.steps[step - 1]!;
  if (!ladder.every || ladder.every <= 0) return null;
  const last = ladder.steps.at(-1) ?? 0;
  return firstAt + last + (step - ladder.steps.length) * ladder.every;
}

/** Whether the ladder has a step after `told`. */
export function hasNextStep(ladder: EscalationLadder, firstAt: number, told: number): boolean {
  return stepDueAt(ladder, firstAt, told + 1) !== null;
}

/** The step to tell now: after `told` steps, the last one whose time has
 * come (a server that was down tells the missed steps once), else null. */
export function dueStep(ladder: EscalationLadder, firstAt: number, told: number, now: number): number | null {
  let step = told + 1;
  const first = stepDueAt(ladder, firstAt, step);
  if (first === null || now < first) return null;
  for (;;) {
    const after = stepDueAt(ladder, firstAt, step + 1);
    if (after === null || now < after) return step;
    step += 1;
  }
}

/** The steps a store that keeps only the time of the last one told (a
 * previous version's mark on the card) has told: those due by then. */
export function stepsToldBy(ladder: EscalationLadder, firstAt: number, lastToldAt: number): number {
  const step = dueStep(ladder, firstAt, 0, lastToldAt);
  return step ?? 0;
}

/** The morning line: once per local day, from the end of the person's
 * quiet hours (none set: 08:00 in their time zone). */
export const MORNING_LINE_KIND = "morning-line";
export const MORNING_DEFAULT_MINUTE = 8 * 60;
export const morningLineKey = (day: string): string => `morning-line:${day}`;

/** The minute of the day the person's morning starts. */
export function morningMinute(quiet: QuietHours | null | undefined): number {
  if (!quiet || !/^\d\d:\d\d$/.test(quiet.end)) return MORNING_DEFAULT_MINUTE;
  return Number(quiet.end.slice(0, 2)) * 60 + Number(quiet.end.slice(3, 5));
}
