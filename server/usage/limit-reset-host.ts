// Minimal host for limit-reset automations (port of upstream cbef345cb
// LimitResetClock wiring). Keeps each engine's reset from plan usage and
// from refusals; routines with schedule.type === "limit_reset" get their
// `at` from this clock (engine reset + AFTER_RESET_MS).
//
// #1918: limits belong to the account that pays. The server's own engine
// accounts are the SERVER_LIMIT_SCOPE clock: this computer's logins on a solo
// server, the organization's key (no plan windows, refusals only) on an
// organization server, whose own logins never pay anyone's turns; on an organization server each person whose own
// subscription or key pays their turns has a clock of their own
// (`person:<principalId>`), read from their own sign-in. A refusal is noted
// on the clock of the turn's payer, and a turn that succeeds there clears it.
import { AFTER_RESET_MS, isLimitResetSchedule, type EngineLimitsReport, type LimitResetSchedule } from "../../shared/limit-reset.ts";
import type { RoutineSchedule } from "../../shared/routines.ts";
import { LimitResetClock, type LimitClockOptions } from "./limit-resets.ts";
import type { PlanAccount } from "./plan-usage.ts";

/** The server's own engine accounts. */
export const SERVER_LIMIT_SCOPE = "server";

type LimitRoutine = { id: string; botId?: string; schedule: RoutineSchedule; enabled?: boolean };

/** What the routes read: one person's limits, each engine from the clock of whoever pays that person's turns on it. */
export interface LimitResetView {
  ensureFresh(maxAgeMs?: number): Promise<void>;
  report(): EngineLimitsReport;
  resetAt(engine: string): number | null;
}

export function createLimitResetHost(options: LimitClockOptions & {
  /** Every saved routine that may need retiming. */
  routines: () => ReadonlyArray<LimitRoutine>;
  /** Apply a new schedule.at for a limit_reset routine. */
  retime: (routineId: string, schedule: LimitResetSchedule) => void;
  /** The plan accounts of a scope other than the server's (a person's own sign-ins). Absent: only the server's. */
  scopeAccounts?: (scope: string) => PlanAccount[];
  /** Whose clock a limit_reset routine waits on: the scope that pays its runs on its engine. Absent: the server's. */
  routineScope?: (routine: LimitRoutine, engine: string) => string;
  /** Where a scope's clock keeps its refusals across a restart. Absent: memory only. */
  holdsFile?: (scope: string) => string | undefined;
}) {
  const clocks = new Map<string, LimitResetClock>();
  let started = false;
  const scopeOf = (routine: LimitRoutine, engine: string) => options.routineScope?.(routine, engine) ?? SERVER_LIMIT_SCOPE;
  const waitingOn = (routine: LimitRoutine): routine is LimitRoutine & { schedule: LimitResetSchedule } =>
    isLimitResetSchedule(routine.schedule) && routine.enabled !== false;

  function clockFor(scope: string): LimitResetClock {
    const key = scope || SERVER_LIMIT_SCOPE;
    const known = clocks.get(key);
    if (known) return known;
    const clock: LimitResetClock = new LimitResetClock({
      accounts: key === SERVER_LIMIT_SCOPE ? options.accounts : () => options.scopeAccounts?.(key) ?? [],
      loadUsage: options.loadUsage,
      ...(options.describe ? { describe: options.describe } : {}),
      now: options.now,
      ...(options.holdsFile?.(key) ? { file: options.holdsFile(key) } : {}),
      waiting: () => options.routines().some((routine) =>
        waitingOn(routine) && routine.schedule.at === null && scopeOf(routine, routine.schedule.engine) === key),
      onChange: () => {
        options.onChange?.();
        for (const routine of options.routines()) {
          if (!waitingOn(routine) || scopeOf(routine, routine.schedule.engine) !== key) continue;
          const reset = clock.resetAt(routine.schedule.engine);
          const at = reset === null ? null : reset + AFTER_RESET_MS;
          if (at !== routine.schedule.at) {
            options.retime(routine.id, { ...routine.schedule, at });
          }
        }
      },
    });
    clocks.set(key, clock);
    if (started) clock.start();
    return clock;
  }

  const clock = clockFor(SERVER_LIMIT_SCOPE);
  return {
    /** The server's own accounts' clock. */
    clock,
    clockFor,
    /** One person's limits: `own` is their own accounts' scope, and `scopeFor(engine)` says whose account pays
     * their turns on that engine (`own`, or the server's). */
    view(own: string, scopeFor: (engine: string) => string): LimitResetView {
      const scopes = () => [...new Set([SERVER_LIMIT_SCOPE, own || SERVER_LIMIT_SCOPE])];
      return {
        async ensureFresh(maxAgeMs) {
          await Promise.all(scopes().map((scope) => clockFor(scope).ensureFresh(maxAgeMs)));
        },
        report() {
          const reports = scopes().map((scope) => ({ scope, report: clockFor(scope).report() }));
          const engines = reports.flatMap(({ scope, report }) =>
            report.engines.filter((limit) => (scopeFor(limit.engine) || SERVER_LIMIT_SCOPE) === scope));
          return { checkedAt: Math.min(...reports.map(({ report }) => report.checkedAt)), engines };
        },
        resetAt(engine) {
          return clockFor(scopeFor(engine) || SERVER_LIMIT_SCOPE).resetAt(engine);
        },
      };
    },
    /** Derive `at` when a limit_reset schedule is saved. */
    fill(schedule: LimitResetSchedule, scope = SERVER_LIMIT_SCOPE): LimitResetSchedule {
      const reset = clockFor(scope).resetAt(schedule.engine);
      return { ...schedule, at: reset === null ? null : reset + AFTER_RESET_MS };
    },
    /** A turn on this engine was refused by the usage limit of the account `scope` names (its payer). */
    noteRefusal(engine: string | undefined, resetsAt: number | undefined, scope = SERVER_LIMIT_SCOPE): void {
      clockFor(scope).noteRefusal(engine, resetsAt);
    },
    /** A turn on this engine succeeded on the account `scope` names: it is not at its limit. */
    noteSuccess(engine: string | undefined, scope = SERVER_LIMIT_SCOPE): void {
      if (!engine) return;
      clocks.get(scope || SERVER_LIMIT_SCOPE)?.noteSuccess(engine);
    },
    start(): void {
      started = true;
      for (const each of clocks.values()) each.start();
    },
    stop(): void {
      started = false;
      for (const each of clocks.values()) each.stop();
    },
  };
}

export type LimitResetHost = ReturnType<typeof createLimitResetHost>;
