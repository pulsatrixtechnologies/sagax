import { z } from "zod";

import { ROUTINE_WATCH_LIMITS, ROUTINE_WATCH_OPS, type RoutineWatchPrecheck } from "../../shared/routine-watch.ts";
import { watchToolRefusal } from "./routine-watch-tools.ts";

/** A routine's optional pre-check: a deterministic test the scheduler runs
 * before a scheduled run starts any model turn. When it says there is
 * nothing to do, the run is recorded as `nothing_to_report`: no turn, no
 * message, no notification. Absent: every due run starts a turn as before.
 *
 * Two kinds:
 * - `condition` reads facts the scheduler already holds (its own run
 *   receipts): no command, no file, no network.
 * - `watch` (2026-10-26) reads something that may change: a file or folder
 *   of the bot's folder, the output of a command run where the bot works,
 *   or a read-only MCP tool with fixed arguments (server/routines/routine-watch.ts).
 *   It runs beside the scheduler pass, never inside it, under its own
 *   bounds (ROUTINE_WATCH_LIMITS), and wakes the turn only on a change or
 *   a condition. Writes and sends are refused (routine-watch-tools.ts). */

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

const conditionSchema = z.discriminatedUnion("test", [elapsedSinceReport, everyNth]);

const L = ROUTINE_WATCH_LIMITS;
const jsonPath = z.string().trim().min(1).max(200);
const relativePath = z.string().trim().max(L.pathMaxChars).refine((path) => !path.includes("\0"), "Choose a valid path");

const watchSource = z.discriminatedUnion("type", [
  z.object({ type: z.literal("files"), path: relativePath, recursive: z.boolean().optional() }).strict(),
  z.object({ type: z.literal("command"), command: z.string().trim().min(1).max(L.commandMaxChars) }).strict(),
  z.object({
    type: z.literal("tool"),
    tool: z.string().trim().min(1).max(200),
    args: z.record(z.string(), z.unknown()).optional()
      .refine((args) => args === undefined || JSON.stringify(args).length <= L.argsMaxChars, "The tool's arguments are too long"),
  }).strict(),
]);

const watchCondition = z.discriminatedUnion("test", [
  z.object({
    test: z.literal("json_path"),
    path: jsonPath,
    op: z.enum(ROUTINE_WATCH_OPS),
    value: z.union([z.string().max(500), z.number().finite(), z.boolean()]).optional(),
  }).strict().refine((condition) => condition.op === "exists" || condition.value !== undefined, "Choose the value to compare with"),
  z.object({ test: z.literal("contains"), text: z.string().min(1).max(500), negate: z.boolean().optional() }).strict(),
  z.object({ test: z.literal("exit_code"), op: z.enum(["eq", "ne"]), value: z.number().int().min(0).max(255) }).strict(),
]);

const watchSchema = z.object({
  kind: z.literal("watch"),
  source: watchSource,
  wakeOn: z.enum(["change", "match"]).optional(),
  condition: watchCondition.optional(),
  track: z.object({
    items: jsonPath.optional(),
    key: z.string().trim().min(1).max(100).optional(),
    fields: z.array(z.string().trim().min(1).max(100)).min(1).max(20).optional(),
  }).strict().optional(),
  firstRun: z.enum(["baseline", "wake"]).optional(),
  whenAsleep: z.enum(["skip", "wake"]).optional(),
}).strict().superRefine((watch, context) => {
  if (watch.wakeOn === "match" && !watch.condition) {
    context.addIssue({ code: "custom", message: "Waking on every match needs a condition" });
  }
  if (watch.condition?.test === "exit_code" && watch.source.type !== "command") {
    context.addIssue({ code: "custom", message: "An exit code exists only for a command" });
  }
  if (watch.track && watch.source.type === "files") {
    context.addIssue({ code: "custom", message: "A file watch already compares file by file" });
  }
  if (watch.source.type === "files" && watch.condition && watch.condition.test !== "json_path") {
    context.addIssue({ code: "custom", message: "A file watch tests exists, count or bytes" });
  }
  if (watch.source.type === "tool") {
    const refusal = watchToolRefusal(watch.source.tool);
    if (refusal) context.addIssue({ code: "custom", message: refusal });
  }
});

/** 2026-11-05 (#2018): a check Sagax runs as code, by name, before a turn
 * (options.evaluateCode in routines.ts). No LLM call per tick: the turn
 * starts only when the check finds work. `daily_brief` (#3456) is the
 * bot's brief: the check reads and delivers it itself and never starts a
 * turn (server/proactive/brief-routine.ts). */
export const ROUTINE_CODE_CHECKS = ["claude_artifact_comments", "daily_brief"] as const;
export const ROUTINE_CODE_CHECK_TIMEOUT_MS = 180_000;
const codeSchema = z.object({
  kind: z.literal("code"),
  check: z.enum(ROUTINE_CODE_CHECKS),
}).strict();

export const routinePrecheckSchema = z.union([conditionSchema, watchSchema, codeSchema]);

export type RoutineConditionPrecheck = z.infer<typeof conditionSchema>;
export type RoutineCodePrecheck = z.infer<typeof codeSchema>;
export type RoutinePrecheck = RoutineConditionPrecheck | RoutineWatchPrecheck | RoutineCodePrecheck;

/** What the scheduler knows when a run is due. */
export interface RoutinePrecheckFacts {
  now: number;
  /** finishedAt of the routine's latest completed run, if any. */
  lastReportAt?: number;
  /** nothing_to_report runs since that completed run (or since ever). */
  quietRunsSinceReport: number;
}

export type RoutinePrecheckVerdict =
  /** `note`: what a watch saw change, for the woken run (bounded, data). */
  | { wake: true; note?: string }
  | { wake: false; reason: string };

/** Hard cap for one evaluation, so a pre-check never holds the scheduler. */
export const ROUTINE_PRECHECK_TIMEOUT_MS = 5_000;

export class RoutinePrecheckError extends Error {}

/** Validate a pre-check from a request; throws a readable error (a watch's
 * own reason when it has one, say a tool that writes). */
export function parseRoutinePrecheck(value: unknown): RoutinePrecheck {
  const parsed = routinePrecheckSchema.safeParse(value);
  if (!parsed.success) {
    const custom = parsed.error.issues.flatMap((issue) => issue.code === "invalid_union"
      ? (issue as { errors?: Array<Array<{ code: string; message: string }>> }).errors?.flat() ?? []
      : [issue]).find((issue) => issue.code === "custom");
    throw new RoutinePrecheckError(custom ? `Choose a valid pre-check for this routine: ${custom.message}` : "Choose a valid pre-check for this routine");
  }
  return parsed.data as RoutinePrecheck;
}

/** A stored pre-check, or undefined when it does not read (dropped, so a
 * damaged value never blocks a routine forever nor runs something unknown). */
export function loadRoutinePrecheck(value: unknown): RoutinePrecheck | undefined {
  const parsed = routinePrecheckSchema.safeParse(value);
  return parsed.success ? parsed.data as RoutinePrecheck : undefined;
}

export function isCodePrecheck(precheck: RoutinePrecheck | undefined): precheck is RoutineCodePrecheck {
  return precheck?.kind === "code";
}

export function isWatchPrecheck(precheck: RoutinePrecheck | undefined): precheck is RoutineWatchPrecheck {
  return precheck?.kind === "watch";
}

/** Pure: decide a `condition` from the facts. Throws on a pre-check it
 * cannot read, a watch included (it needs the wired evaluator). */
export function evaluateRoutinePrecheck(precheck: RoutinePrecheck, facts: RoutinePrecheckFacts): RoutinePrecheckVerdict {
  const checked = conditionSchema.safeParse(precheck);
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
    if (verdict.wake) {
      const note = typeof verdict.note === "string" ? verdict.note.slice(0, ROUTINE_WATCH_LIMITS.maxNoteChars) : "";
      return note ? { wake: true, note } : { wake: true };
    }
    return { wake: false, reason: String(verdict.reason ?? "Nothing to report").slice(0, 200) };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
