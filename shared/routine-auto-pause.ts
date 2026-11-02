// A routine pauses itself after N failed runs in a row (2026-10-26). N is
// the routine's own setting (`autoPauseAfter`), chosen by the person in the
// routine editor, no admin and no organization permission: absent is the
// default (5), 0 never pauses. The pause is a fact on the routine
// (`autoPaused`) and on the run that tipped it (`RoutineRun.autoPaused`), so
// the history says "Paused after N failures in a row"; every failed run stays.
// Resume (the passing notice's one click, the switch, the editor) turns the
// routine back on and starts the count again from zero.
//
// Read by the server (server/routines/routines.ts), the desktop and, through
// ios/Tests/CompanionCoreTests/Fixtures/transient-notices.json, the iOS core.

export const ROUTINE_AUTO_PAUSE_DEFAULT = 5;
/** The largest count a routine may choose. */
export const ROUTINE_AUTO_PAUSE_MAX = 100;
/** The choices the editors offer (0 = never). Any whole number up to the
 * maximum is accepted on the wire. */
export const ROUTINE_AUTO_PAUSE_CHOICES = [0, 1, 2, 3, 5, 10, 20] as const;

export interface RoutineAutoPause {
  /** When the routine paused itself. */
  at: number;
  /** Failed runs in a row when it paused. */
  failures: number;
  /** The run whose failure paused it. */
  runId: string;
}

/** How many failures in a row pause this routine; 0 never. */
export function routineAutoPauseAfter(routine: { autoPauseAfter?: number | null }): number {
  const value = routine.autoPauseAfter;
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= ROUTINE_AUTO_PAUSE_MAX
    ? value
    : ROUTINE_AUTO_PAUSE_DEFAULT;
}

/** The stored form of a choice: undefined keeps the default, a whole number
 * from 0 to the maximum is kept as given. Anything else is refused. */
export function cleanRoutineAutoPauseAfter(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > ROUTINE_AUTO_PAUSE_MAX) {
    throw new Error(`Choose how many failures in a row pause this routine: a whole number from 0 (never) to ${ROUTINE_AUTO_PAUSE_MAX}`);
  }
  return value === ROUTINE_AUTO_PAUSE_DEFAULT ? undefined : value;
}

/** True when this failure count reaches the routine's own limit. */
export function routineAutoPauseDue(routine: { autoPauseAfter?: number | null }, failures: number): boolean {
  const after = routineAutoPauseAfter(routine);
  return after > 0 && failures >= after;
}
