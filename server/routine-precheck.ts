import { z } from "zod";

/** A routine's optional pre-check: a deterministic test the scheduler runs
 * before a scheduled run starts any model turn. When it says there is
 * nothing to do, the run is recorded as `nothing_to_report`: no turn, no
 * message, no notification. Absent: every due run starts a turn as before.
 *
 * Only `condition` checks exist: they read facts the scheduler already
 * holds (its own run receipts), never a command, a file or the network. */

const MAX_MINUTES = 7 * 24 * 60;

const elapsedSinceReport = z.object({
  kind: z.literal("condition"),
  /** Wake only when at least `minMinutes` passed since the last run that
   * reported (completed), or when none ever did. */
  test: z.literal("elapsed_since_report"),
  minMinutes: z.number().int().min(1).max(MAX_MINUTES),
}).strict();

const everyNth = z.object({
  kind: z.literal("condition"),
  /** Wake on every `every`-th due occurrence: after `every - 1` quiet runs
   * since the last report, the next one starts a turn. */
  test: z.literal("every_nth"),
  every: z.number().int().min(2).max(1000),
}).strict();

export const routinePrecheckSchema = z.discriminatedUnion("test", [elapsedSinceReport, everyNth]);

export type RoutinePrecheck = z.infer<typeof routinePrecheckSchema>;

/** What the scheduler knows when a run is due. */
export interface RoutinePrecheckFacts {
  now: number;
  /** finishedAt of the routine's latest completed run, if any. */
  lastReportAt?: number;
  /** nothing_to_report runs since that completed run (or since ever). */
  quietRunsSinceReport: number;
}

export type RoutinePrecheckVerdict =
  | { wake: true }
  | { wake: false; reason: string };

/** Hard cap for one evaluation, so a pre-check never holds the scheduler. */
export const ROUTINE_PRECHECK_TIMEOUT_MS = 5_000;

export class RoutinePrecheckError extends Error {}

/** Validate a pre-check from a request; throws a readable error. */
export function parseRoutinePrecheck(value: unknown): RoutinePrecheck {
  const parsed = routinePrecheckSchema.safeParse(value);
  if (!parsed.success) throw new RoutinePrecheckError("Choose a valid pre-check for this routine");
  return parsed.data;
}

/** A stored pre-check, or undefined when it does not read (dropped, so a
 * damaged value never blocks a routine forever nor runs something unknown). */
export function loadRoutinePrecheck(value: unknown): RoutinePrecheck | undefined {
  const parsed = routinePrecheckSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

/** Pure: decide from the facts. Throws on a pre-check it cannot read. */
export function evaluateRoutinePrecheck(precheck: RoutinePrecheck, facts: RoutinePrecheckFacts): RoutinePrecheckVerdict {
  const checked = routinePrecheckSchema.safeParse(precheck);
  if (!checked.success) throw new RoutinePrecheckError("The routine's pre-check is not valid");
  const check = checked.data;
  if (check.test === "elapsed_since_report") {
    if (facts.lastReportAt === undefined) return { wake: true };
    const elapsed = facts.now - facts.lastReportAt;
    if (elapsed >= check.minMinutes * 60_000) return { wake: true };
    return { wake: false, reason: `Less than ${check.minMinutes} min since the last report` };
  }
  if (facts.quietRunsSinceReport + 1 >= check.every) return { wake: true };
  return { wake: false, reason: `Quiet run ${facts.quietRunsSinceReport + 1} of ${check.every}` };
}

/** Run an evaluator (the pure one, or a wired one) under the hard timeout.
 * Errors and timeouts reject: the caller fails the run, never starts a turn. */
export async function runRoutinePrecheck(
  evaluate: () => Promise<RoutinePrecheckVerdict> | RoutinePrecheckVerdict,
  timeoutMs = ROUTINE_PRECHECK_TIMEOUT_MS,
): Promise<RoutinePrecheckVerdict> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new RoutinePrecheckError(`The pre-check did not answer within ${Math.round(timeoutMs / 1000)} s`)), timeoutMs);
  });
  try {
    const verdict = await Promise.race([Promise.resolve().then(evaluate), timeout]);
    if (!verdict || typeof verdict !== "object" || typeof verdict.wake !== "boolean") {
      throw new RoutinePrecheckError("The pre-check gave no answer");
    }
    if (verdict.wake) return { wake: true };
    return { wake: false, reason: String(verdict.reason ?? "Nothing to report").slice(0, 200) };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
