/** Routine wire shapes — the routine and run records as they ride the REST
 * snapshot and the `routine` / `routine.run` live frames. Moved verbatim
 * from the client's hand-maintained mirrors (src/lib/routines.ts) so the
 * frame union and every client consumer share one home; the client file
 * re-exports these under the same names. */
import type { RoutineCronSchedule } from "./routine-schedule.ts";

export interface RoutineIntervalWindow {
  start: string;
  end: string;
}

export type RoutineSchedule =
  | RoutineCronSchedule
  | { type: "once"; at: number }
  | { type: "daily"; time: string; weekdays: number[] }
  | {
    type: "interval";
    everyMinutes: number;
    anchorAt: number;
    /** Local weekdays (Sunday = 0). Missing means every day. */
    weekdays?: number[];
    /** Local wall-clock window. Missing means all day. */
    window?: RoutineIntervalWindow;
    /** Inclusive epoch-millisecond cutoff. Missing means never. */
    endsAt?: number;
  };

export type RoutineScheduleInput =
  | Extract<RoutineSchedule, { type: "once" | "daily" | "cron" }>
  | {
    type: "interval";
    everyMinutes: number;
    anchorAt: number;
    /** `null` explicitly restores the every-day default on updates. */
    weekdays?: number[] | null;
    /** `null` explicitly restores the all-day default on updates. */
    window?: RoutineIntervalWindow | null;
    /** `null` explicitly removes an existing end date on updates. */
    endsAt?: number | null;
  };

export type RoutineRunOn = "maus" | "cloud";

export type RoutineTarget = "bot" | "room-goal";
export type RoutineGoalStatus =
  | "completed"
  | "needs-input"
  | "blocked"
  | "limit-reached"
  | "paused"
  | "stopped"
  | "failed";

export interface RoutineContextAttachment {
  id: string;
  kind: "file" | "image";
  name: string;
  path: string;
  size: number;
}

export type RoutineRunTrigger = "schedule" | "manual" | "webhook" | "startup";

export type RoutineRunStatus =
  | "queued"
  | "running"
  | "waiting"
  | "completed"
  | "failed"
  | "cancelled"
  | "missed";

/** The statuses both failure indicators count: a run that went wrong and has
 * not been acknowledged. One home so the sidebar dot, the errors pill, the
 * logs filter and the bulk-seen sweep cannot drift apart. */
export const ROUTINE_PROBLEM_STATUSES: readonly RoutineRunStatus[] = ["failed", "missed"];

export function isRoutineProblemRun(run: { status: RoutineRunStatus }): boolean {
  return ROUTINE_PROBLEM_STATUSES.includes(run.status);
}

/** The logs view's status filter: every run, the composite problem set the
 * indicators count, or one exact status. */
export type RoutineRunStatusFilter = "all" | "problems" | RoutineRunStatus;

export interface Routine {
  id: string;
  name: string;
  prompt: string;
  target: RoutineTarget;
  botId: string;
  groupId?: string;
  runOn: RoutineRunOn;
  enabled: boolean;
  schedule: RoutineSchedule;
  durationMinutes: number;
  /** Optional wall-clock safety limit. Missing means the run is unlimited. */
  timeoutMinutes?: number;
  overlap?: "skip" | "queue";
  /** Each run starts with the previous run's report. */
  continuity?: boolean;
  /** Also run once each time Sagax starts. */
  runOnStartup?: boolean;
  skippedRuns?: number;
  lastSkippedAt?: number;
  failureStreak?: number;
  attachments?: RoutineContextAttachment[];
  sourceThreadId?: string;
  resultsThreadId?: string;
  /** Slice 6 (organization server): the person this routine runs as. */
  runAs?: { principalId: string; name: string };
  /** Slice 6: paused because its person is out or lost the right to run
   * the bot (never for lack of a delegation since 2026-10-08). */
  suspended?: { reason: RoutineSuspendReason; at: number };
  /** 2026-10-16: runs only while its person is there (server/routine-away.ts). */
  onlyWhenPresent?: boolean;
  /** Occurrences skipped while the person was away; `reportedAt` once they
   * are back. Cleared by POST /api/routines/:id/away-seen. */
  awaySkips?: { count: number; firstAt: number; lastAt: number; reportedAt?: number };
  nextRunAt: number | null;
  createdAt: number;
  updatedAt: number;
  /** 2026-10-09 (GET /api/routines, server/routine-scope.ts): its bot's
   * owner, the teams it belongs to (the owner's and run-as person's teams
   * and the teams its bot is shared with), its bot, and whether this viewer
   * may run it now or edit it. Absent on a live frame or an older server. */
  owner?: { id: string; name: string; avatarUrl?: string };
  teamIds?: string[];
  bot?: { id: string; name: string };
  canRun?: boolean;
  canEdit?: boolean;
  /** Someone else's routine seen through a wider scope: its instructions,
   * attachments and threads are withheld. */
  redacted?: true;
}

/** Slice 6: why an organization routine is paused by the server. A routine
 * always acts in its owner's name (2026-10-08): the old delegation reasons
 * are gone and a routine paused for one resumes when the server starts. */
export type RoutineSuspendReason = "person_out" | "no_right";

export interface RoutineRun {
  id: string;
  routineId: string;
  routineName: string;
  prompt?: string;
  durationMinutes?: number;
  timeoutMinutes?: number;
  attachments?: RoutineContextAttachment[];
  target: RoutineTarget;
  goalStatus?: RoutineGoalStatus;
  botId: string;
  groupId?: string;
  runOn: RoutineRunOn;
  scheduledFor: number;
  status: RoutineRunStatus;
  manual: boolean;
  triggerSource?: RoutineRunTrigger;
  webhookId?: string;
  deliveryId?: string;
  /** Room task created for a team-goal run. */
  executionThreadId?: string;
  sourceThreadId?: string;
  resultsThreadId?: string;
  threadId?: string;
  startedAt?: number;
  finishedAt?: number;
  output?: string;
  error?: string;
  /** Concise, redacted question or approval reason while status is waiting. */
  attention?: string;
  cost?: number | null;
  denials?: string[];
  createdAt: number;
  seenAt?: number;
  /** Slice 6: a queued run Perspicax rate limited waits until then (ms). */
  admitAfter?: number;
  /** Slice 6: how many times admission was retried after a rate limit. */
  admitAttempts?: number;
  /** Someone else's run seen through a wider scope: output, instructions
   * and threads withheld (server/routine-scope.ts). */
  redacted?: true;
}

export interface RoutineInput {
  name: string;
  prompt: string;
  target?: RoutineTarget;
  botId: string;
  groupId?: string | null;
  runOn?: RoutineRunOn;
  enabled?: boolean;
  schedule: RoutineScheduleInput;
  durationMinutes?: number;
  /** `null` explicitly removes the limit; omission preserves it on updates. */
  timeoutMinutes?: number | null;
  overlap?: "skip" | "queue";
  /** Each run starts with the previous run's report. */
  continuity?: boolean;
  /** 2026-10-16: runs only while its person is there (server/routine-away.ts). */
  onlyWhenPresent?: boolean;
  runOnStartup?: boolean;
  attachments?: RoutineContextAttachment[];
  /** Omission preserves routing; null resets it to the bot's main thread. */
  resultsThreadId?: string | null;
}
