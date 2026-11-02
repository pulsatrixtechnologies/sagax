// Minimal host for limit-reset automations (port of upstream cbef345cb
// LimitResetClock wiring). Keeps each engine's reset from plan usage and
// from refusals; routines with schedule.type === "limit_reset" get their
// `at` from this clock (engine reset + AFTER_RESET_MS).
import { AFTER_RESET_MS, isLimitResetSchedule, type LimitResetSchedule } from "../shared/limit-reset.ts";
import type { RoutineSchedule } from "../shared/routines.ts";
import { LimitResetClock, type LimitClockOptions } from "./limit-resets.ts";

export function createLimitResetHost(options: LimitClockOptions & {
  /** Every saved routine that may need retiming. */
  routines: () => ReadonlyArray<{ id: string; schedule: RoutineSchedule; enabled?: boolean }>;
  /** Apply a new schedule.at for a limit_reset routine. */
  retime: (routineId: string, schedule: LimitResetSchedule) => void;
}) {
  const clock = new LimitResetClock({
    accounts: options.accounts,
    loadUsage: options.loadUsage,
    now: options.now,
    waiting: () => options.routines().some((routine) =>
      isLimitResetSchedule(routine.schedule) && routine.enabled !== false && routine.schedule.at === null),
    onChange: () => {
      options.onChange?.();
      for (const routine of options.routines()) {
        if (!isLimitResetSchedule(routine.schedule) || routine.enabled === false) continue;
        const reset = clock.resetAt(routine.schedule.engine);
        const at = reset === null ? null : reset + AFTER_RESET_MS;
        if (at !== routine.schedule.at) {
          options.retime(routine.id, { ...routine.schedule, at });
        }
      }
    },
  });
  return {
    clock,
    /** Derive `at` when a limit_reset schedule is saved. */
    fill(schedule: LimitResetSchedule): LimitResetSchedule {
      const reset = clock.resetAt(schedule.engine);
      return { ...schedule, at: reset === null ? null : reset + AFTER_RESET_MS };
    },
    noteRefusal(engine: string | undefined, resetsAt: number | undefined): void {
      clock.noteRefusal(engine, resetsAt);
    },
    start(): void { clock.start(); },
    stop(): void { clock.stop(); },
  };
}

export type LimitResetHost = ReturnType<typeof createLimitResetHost>;
