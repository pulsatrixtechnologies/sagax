/**
 * #4098: a bot's outcomes, read from its routines. An outcome is a named
 * result that one or more routines of a bot keep true. It is not a second
 * scheduler and not a second run log: it is a reading of the routines, their
 * goal, their runs and what already waits on the person. Nothing here is
 * stored; the server, the desktop and the phone run this one function over
 * the same cases (shared/outcomes.vectors.json).
 *
 * Every routine is an outcome of its own until a stored outcome groups it
 * (`records` and `outcome` on a routine, a later lot; absent today, each
 * routine stands alone). A routine with a goal is named by its goal.
 *
 * Words are left to the apps: this returns kinds, numbers and the bot's own
 * sentences, never a translated label.
 */
import { ROUTINE_GOAL_STALL_RUNS, type RoutineGoal } from "./routine-goal.ts";
import { routineProblemToldAt } from "./routine-repeat.ts";
import { failureDetail, reportBrief } from "./routine-result.ts";
import { isRoutineProblemRun, type Routine, type RoutineRun } from "./routines.ts";

/** What needs the person, once, with the run it comes from. `needsPerson`
 * on a routine (written by the server in a later lot) is taken as is; until
 * then it is read from what the wire already carries. */
export interface OutcomeNeed {
  kind: "question" | "items" | "problem" | "paused" | "goal";
  /** The sentence that needs the person (the bot's own words); empty when
   * the record carries none, and the app says it in its own words. */
  text: string;
  runId?: string;
  since: number;
  /** `paused`: the failures in a row that paused the routine. */
  failures?: number;
  /** `goal`: why the goal needs the person. */
  goal?: "expired" | "stalled";
  /** `goal` stalled: the checks in a row with the same progress. */
  checks?: number;
}

/** A stored outcome (a later lot): its name, an optional note, its order. */
export interface OutcomeRecord {
  id: string;
  name: string;
  note?: string;
  createdAt: number;
  updatedAt: number;
}

export type OutcomeRoutine = Pick<Routine, "id" | "name" | "enabled" | "schedule" | "nextRunAt" | "createdAt"> &
  Partial<Pick<Routine, "goal" | "autoPaused" | "failureStreak">> & {
    /** The stored outcome it serves (a later lot). Absent: its own. */
    outcome?: string;
    /** What needs the person, as the server decided it (a later lot). */
    needsPerson?: OutcomeNeed;
  };

export type OutcomeRun = Pick<RoutineRun, "id" | "routineId" | "routineName" | "status" | "scheduledFor" | "createdAt"> &
  Partial<Pick<RoutineRun, "startedAt" | "finishedAt" | "quiet" | "problems" | "attention" | "waitingOn" | "output" | "error" | "goalStatus" | "problemRepeat" | "redacted">>;

/** on track: at least one routine is on; paused, finished or reached: none
 * is, and the grey line says which (no pill). */
export type OutcomeStatus = "needs-you" | "on-track" | "paused" | "finished" | "reached";

/** How a recent run reads: Done, Nothing to do, or its own status label. */
export type OutcomeRunWord = "done" | "nothing" | "status";

export interface OutcomeRunLine {
  runId: string;
  routineId: string;
  name: string;
  status: RoutineRun["status"];
  word: OutcomeRunWord;
  at: number;
}

export interface Outcome {
  /** The record's id, or `routine:<id>` for a routine on its own. */
  id: string;
  name: string;
  /** The grey line's words before the schedule: the record's note, or the
   * goal's text when the name is not already it. */
  note?: string;
  /** Its routines, in their order. */
  routineIds: string[];
  status: OutcomeStatus;
  /** `reached`: when the last goal was reached. */
  reachedAt?: number;
  needsPerson?: OutcomeNeed;
  /** Where things stand in one sentence: the goal's progress note, else the
   * brief of the latest run that had something to say. */
  result?: { text: string; at?: number; runId?: string };
  /** Newest first, queued runs left out. */
  recentRuns: OutcomeRunLine[];
}

/** Runs kept per outcome: the apps show five, then the fold. */
export const OUTCOME_RECENT_RUNS = 20;

function runAt(run: OutcomeRun): number {
  return run.finishedAt ?? run.startedAt ?? run.scheduledFor ?? run.createdAt;
}

function finished(routine: OutcomeRoutine, now: number): boolean {
  return routine.schedule.type === "once" && routine.nextRunAt == null && routine.schedule.at <= now;
}

function runWord(run: OutcomeRun): OutcomeRunWord {
  if (run.status === "nothing_to_report" || (run.status === "completed" && run.quiet && !run.problems)) return "nothing";
  if (run.status === "completed" && !run.problems && (!run.goalStatus || run.goalStatus === "completed")) return "done";
  return "status";
}

/** What needs the person for one routine, from today's wire fields: a run
 * waiting on the person (not on teammates), a pause after failures, problem
 * runs in a row once the chat's own rule has told the person
 * (routineProblemToldAt: the first for a routine that runs at most once a
 * day, the third for one that runs several times a day), a goal past its
 * deadline or stalled. */
export function routineNeed(routine: OutcomeRoutine, runs: readonly OutcomeRun[], now = Date.now()): OutcomeNeed | undefined {
  if (routine.needsPerson) return routine.needsPerson;
  const own = runs.filter((run) => run.routineId === routine.id).sort((a, b) => runAt(b) - runAt(a));
  const waiting = own.find((run) => run.status === "waiting" && run.waitingOn !== "teammates");
  if (waiting) return { kind: "question", text: waiting.attention?.trim() ?? "", runId: waiting.id, since: waiting.startedAt ?? runAt(waiting) };
  if (!routine.enabled && routine.autoPaused) {
    return { kind: "paused", text: "", failures: routine.autoPaused.failures, since: routine.autoPaused.at, ...(routine.autoPaused.runId ? { runId: routine.autoPaused.runId } : {}) };
  }
  const settled = own.find((run) => run.status !== "queued" && run.status !== "running" && run.status !== "waiting");
  if (settled && isRoutineProblemRun(settled)
    && Math.max(1, routine.failureStreak ?? 0, settled.problemRepeat?.count ?? 0) >= routineProblemToldAt(routine.schedule, now)) {
    const detail = settled.redacted ? "" : failureDetail(settled.error || settled.problems || "");
    return { kind: "problem", text: detail, runId: settled.id, since: settled.problemRepeat?.since ?? runAt(settled) };
  }
  const goal: RoutineGoal | undefined = routine.goal;
  if (goal?.status === "expired") return { kind: "goal", goal: "expired", text: goal.progress ?? "", since: goal.expiredAt ?? goal.lastCheckedAt ?? routine.createdAt };
  if (goal?.status === "active" && (goal.stalled ?? 0) + 1 >= ROUTINE_GOAL_STALL_RUNS) {
    return { kind: "goal", goal: "stalled", checks: (goal.stalled ?? 0) + 1, text: goal.progress ?? "", since: goal.lastCheckedAt ?? routine.createdAt };
  }
  return undefined;
}

function resultOf(routines: readonly OutcomeRoutine[], runs: readonly OutcomeRun[]): Outcome["result"] {
  const goals = routines.map((routine) => routine.goal).filter((goal): goal is RoutineGoal => Boolean(goal?.progress?.trim()));
  const goal = goals.sort((a, b) => (b.lastCheckedAt ?? 0) - (a.lastCheckedAt ?? 0))[0];
  if (goal) return { text: goal.progress!.trim(), ...(goal.lastCheckedAt ? { at: goal.lastCheckedAt } : {}) };
  for (const run of runs) {
    if (run.status !== "completed" || run.quiet || run.redacted) continue;
    const text = reportBrief(run.output, "end");
    if (text) return { text, at: runAt(run), runId: run.id };
  }
  return undefined;
}

function outcomeOf(id: string, name: string, note: string | undefined, members: readonly OutcomeRoutine[], allRuns: readonly OutcomeRun[], now: number): Outcome {
  const ids = new Set(members.map((routine) => routine.id));
  const runs = allRuns.filter((run) => ids.has(run.routineId) && run.status !== "queued").sort((a, b) => runAt(b) - runAt(a));
  const need = members.map((routine) => routineNeed(routine, allRuns, now)).find(Boolean);
  const reached = members.every((routine) => routine.goal?.status === "achieved");
  const status: OutcomeStatus = need ? "needs-you"
    : members.some((routine) => routine.enabled && !finished(routine, now)) ? "on-track"
      : reached && members.length > 0 ? "reached"
        : members.length > 0 && members.every((routine) => finished(routine, now) || routine.goal?.status === "achieved") ? "finished"
          : "paused";
  const reachedAt = status === "reached" ? Math.max(...members.map((routine) => routine.goal?.achievedAt ?? 0)) || undefined : undefined;
  const result = resultOf(members, runs);
  return {
    id,
    name,
    ...(note ? { note } : {}),
    routineIds: members.map((routine) => routine.id),
    status,
    ...(reachedAt ? { reachedAt } : {}),
    ...(need ? { needsPerson: need } : {}),
    ...(result ? { result } : {}),
    recentRuns: runs.slice(0, OUTCOME_RECENT_RUNS).map((run) => ({ runId: run.id, routineId: run.routineId, name: run.routineName, status: run.status, word: runWord(run), at: runAt(run) })),
  };
}

/**
 * The outcomes of one bot's routines: those that need the person first,
 * then the others in the person's order (stored outcomes in their order,
 * then each routine on its own in the order it was made). Name: the stored
 * name, else the routine's goal, else its name.
 */
export function outcomesOf(routines: readonly OutcomeRoutine[], runs: readonly OutcomeRun[], records: readonly OutcomeRecord[] = [], now = Date.now()): Outcome[] {
  const known = new Set(records.map((record) => record.id));
  const byCreation = [...routines].sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const grouped = records
    .map((record) => ({ record, members: byCreation.filter((routine) => routine.outcome === record.id) }))
    .filter(({ members }) => members.length > 0)
    .map(({ record, members }) => {
      const goal = members.length === 1 ? members[0]!.goal?.text.trim() : undefined;
      return outcomeOf(record.id, record.name, record.note?.trim() || (goal && goal !== record.name ? goal : undefined), members, runs, now);
    });
  const alone = byCreation
    .filter((routine) => !routine.outcome || !known.has(routine.outcome))
    .map((routine) => outcomeOf(`routine:${routine.id}`, routine.goal?.text.trim() || routine.name, undefined, [routine], runs, now));
  const ordered = [...grouped, ...alone];
  return [...ordered.filter((outcome) => outcome.needsPerson), ...ordered.filter((outcome) => !outcome.needsPerson)];
}
