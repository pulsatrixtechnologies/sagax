/** Routine wire shapes — the routine and run records as they ride the REST
 * snapshot and the `routine` / `routine.run` live frames. Moved verbatim
 * from the client's hand-maintained mirrors (src/lib/routines.ts) so the
 * frame union and every client consumer share one home; the client file
 * re-exports these under the same names. */
import type { LimitResetSchedule, LimitResetScheduleInput } from "./limit-reset.ts";
import type { RoutineWatchPrecheck } from "./routine-watch.ts";
import type { RoutineCronSchedule } from "./routine-schedule.ts";
import type { RoutineWindowTiming } from "./routine-timing.ts";
import type { RoutineAutoPause } from "./routine-auto-pause.ts";

export interface RoutineIntervalWindow {
  start: string;
  end: string;
}

export type RoutineSchedule =
  | (RoutineCronSchedule & RoutineWindowTiming)
  | { type: "once"; at: number }
  | ({ type: "daily"; time: string; weekdays: number[] } & RoutineWindowTiming)
  | ({
    type: "interval";
    everyMinutes: number;
    anchorAt: number;
    /** Local weekdays (Sunday = 0). Missing means every day. */
    weekdays?: number[];
    /** Local wall-clock window. Missing means all day. */
    window?: RoutineIntervalWindow;
    /** Inclusive epoch-millisecond cutoff. Missing means never. */
    endsAt?: number;
  } & RoutineWindowTiming)
  /** Runs when an engine's usage limit resets (shared/limit-reset.ts). */
  | LimitResetSchedule
  | { type: "webhook" }
  | { type: "event"; source: "email" };

/** A routine that starts from a delivery, never from the clock. */
export type RoutineTriggerSchedule = Extract<RoutineSchedule, { type: "webhook" | "event" }>;

/** True for a webhook or email trigger. Both shapes have no time, so every
 * clock path (the tick, a resume, a label) must handle them before it reads
 * `.time`. */
export function isTriggerSchedule(
  schedule: { type: string; source?: unknown } | null | undefined,
): schedule is RoutineTriggerSchedule {
  if (!schedule) return false;
  if (schedule.type === "webhook") return true;
  return schedule.type === "event" && schedule.source === "email";
}

export type RoutineScheduleInput =
  | Extract<RoutineSchedule, { type: "once" | "daily" | "cron" | "webhook" | "event" }>
  | LimitResetScheduleInput
  | ({
    type: "interval";
    everyMinutes: number;
    anchorAt: number;
    /** `null` explicitly restores the every-day default on updates. */
    weekdays?: number[] | null;
    /** `null` explicitly restores the all-day default on updates. */
    window?: RoutineIntervalWindow | null;
    /** `null` explicitly removes an existing end date on updates. */
    endsAt?: number | null;
  } & RoutineWindowTiming);

export type RoutineRunOn = "maus" | "cloud";

/** What a routine's runs may do. `read-and-draft`: read Gmail and Google Calendar and write reply drafts; every other
 * tool is refused outright, never turned into a card. Missing means the bot's own level. */
export type RoutineAccess = "read-and-draft";

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

export type RoutineRunTrigger = "schedule" | "manual" | "webhook" | "proactive";

export type RoutineRunStatus =
  | "queued"
  | "running"
  | "waiting"
  | "completed"
  | "failed"
  /** Flow refused run init (previous unclosed / unknown routine / run_exists). */
  | "blocked"
  | "cancelled"
  | "missed"
  /** The routine's pre-check found nothing to do; no turn started. */
  | "nothing_to_report";

/** Why a run started a second time by itself: its engine stalled, Sagax
 * restarted while it ran, the provider rate-limited it or failed for a moment,
 * or it waited for its engine's usage limit to reset. A run gets one. */
export type RoutineRetryCause = "stalled" | "restarted" | "rate_limited" | "provider" | "usage_limit";

/** The statuses both failure indicators count: a run that went wrong and has
 * not been acknowledged. One home so the sidebar dot, the errors pill, the
 * logs filter and the bulk-seen sweep cannot drift apart. */
export const ROUTINE_PROBLEM_STATUSES: readonly RoutineRunStatus[] = ["failed", "blocked", "missed"];

export function isRoutineProblemRun(run: { status: RoutineRunStatus; problems?: string }): boolean {
  // 2026-11-01: a run that completed with problems counts as a problem too.
  return ROUTINE_PROBLEM_STATUSES.includes(run.status) || (run.status === "completed" && Boolean(run.problems));
}

/** The logs view's status filter: every run, the composite problem set the
 * indicators count, or one exact status. */
export type RoutineRunStatusFilter = "all" | "problems" | RoutineRunStatus;

/** Whether a run shows under a logs status filter. A completed run that had
 * nothing for the person (`quiet`, 2026-10-22) is listed as Nothing to
 * report, with the pre-check's quiet runs. */
export function routineRunMatchesStatus(run: { status: RoutineRunStatus; quiet?: true; problems?: string }, filter: RoutineRunStatusFilter): boolean {
  if (filter === "all") return true;
  if (filter === "problems") return isRoutineProblemRun(run);
  const status = run.status === "completed" && run.quiet ? "nothing_to_report" : run.status;
  return status === filter;
}

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
  skippedRuns?: number;
  lastSkippedAt?: number;
  failureStreak?: number;
  /** 2026-10-26 (shared/routine-auto-pause.ts): failed runs in a row that
   * pause this routine. Absent: the default (5); 0 never pauses. */
  autoPauseAfter?: number;
  /** The routine paused itself after this many failures in a row. */
  autoPaused?: RoutineAutoPause;
  /** Failures before this no longer count (turned back on). */
  failuresClearedAt?: number;
  /** Runs that finished in the last seven days, and how many of them completed. */
  weekRuns?: { ok: number; total: number };
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
  /** 2026-10-22 whether this routine's completed runs post their
   * result message in the person's conversation. `true` posts (as a visible
   * report, never the prompt); `false`/absent is silent and the result lives
   * only in Automations. Approvals, questions and errors always surface, and
   * a NOTHING_TO_REPORT run stays silent, whichever this is. Absent on a new
   * routine inherits the installation default (features.routinesInConversation);
   * existing routines were migrated to true so nothing went silent. */
  postResults?: boolean;
  /** Tag after + on the bot's mail address. Inbound mail with that tag is
   * marked for this routine. Sends still leave from the connector. */
  mailAlias?: string;
  /** Occurrences skipped while the person was away; `reportedAt` once they
   * are back. Cleared by POST /api/routines/:id/away-seen. */
  awaySkips?: { count: number; firstAt: number; lastAt: number; reportedAt?: number };
  /** A pre-check run before each scheduled turn (server/routine-precheck.ts):
   * a condition on its own receipts, or (2026-10-26) a watch that starts the
   * run only when something changes (shared/routine-watch.ts). */
  precheck?: RoutineWatchPrecheck | { kind: "condition"; test: string; [field: string]: unknown };
  /** 2026-10-28 (shared/routine-folders.ts): the folder of its bot it sits
   * in. Absent: no folder. */
  folder?: string;
  /** Delete this routine once its schedule has no more runs and the last
   * run has settled (completed, failed, cancelled or missed). Only for a
   * schedule with a known end (once, or interval with endsAt). Off by
   * default. Past runs stay in the calendar and the run log. */
  deleteWhenFinished?: boolean;
  /** Confined runs: read Gmail/Calendar and write reply drafts only. */
  access?: RoutineAccess;
  nextRunAt: number | null;
  /** Scheduled slot a flexible routine advances from. Absent for exact timing. */
  nominalRunAt?: number;
  /** Nominal slot already consumed. Later placement never chooses it or an earlier slot. */
  lastFiredNominalAt?: number;
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
  /** 2026-10-22: a completed run that had nothing for the person; nothing
   * was posted to their conversation (server/routine-report.ts). */
  quiet?: true;
  /** 2026-11-01: completed, but not all of it went right: why ("Completed
   * with problems"). Counts as a problem run. */
  problems?: string;
  /** 2026-11-01: a person started this run; its card shows from the start. */
  startedBy?: "person";
  /** 2026-11-01: a waiting run waits on its teammates' work, not on the person. */
  waitingOn?: "teammates";
  error?: string;
  /** Set when the run used its one automatic second start, and why. */
  retried?: RoutineRetryCause;
  /** A queued run starts no earlier than this. */
  retryAt?: number;
  /** Concise, redacted question or approval reason while status is waiting,
   * or why a queued run starts later. */
  attention?: string;
  cost?: number | null;
  denials?: string[];
  createdAt: number;
  /** 2026-10-26: this failure paused its routine after this many failures in a row. */
  autoPaused?: { failures: number };
  seenAt?: number;
  /** Slice 6: a queued run Perspicax rate limited waits until then (ms). */
  admitAfter?: number;
  /** Slice 6: how many times admission was retried after a rate limit. */
  admitAttempts?: number;
  /** Someone else's run seen through a wider scope: output, instructions
   * and threads withheld (server/routine-scope.ts). */
  redacted?: true;
  /** Snapshot of the routine's confined access for this run. */
  access?: RoutineAccess;
  /** Items its routine's checks handed this run, so they are kept or released once it ends. */
  checkKey?: string;
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
  /** 2026-10-22: post this routine's results in the conversation. `null`
   * clears it back to the installation default; omission preserves it. */
  postResults?: boolean | null;
  /** Tag after + on the bot's mail address. Null clears it. */
  mailAlias?: string | null;
  /** 2026-10-26: failed runs in a row that pause the routine (0 never);
   * `null` goes back to the default, omission preserves it. */
  autoPauseAfter?: number | null;
  attachments?: RoutineContextAttachment[];
  /** Omission preserves routing; null resets it to the bot's main thread. */
  resultsThreadId?: string | null;
  /** Omission preserves it; null removes it (every due time starts a turn). */
  precheck?: Routine["precheck"] | null;
  /** 2026-10-28: the bot's folder to put it in; null takes it out of its
   * folder, omission preserves it. */
  folder?: string | null;
  /** Delete once the schedule ends and the last run settles. Off unless true. */
  deleteWhenFinished?: boolean;
  /** `null` clears confined access; omission preserves it on updates. */
  access?: RoutineAccess | null;
}

/** True when the schedule has a known last occurrence: a one-time run, or
 * an interval with an endsAt cutoff. Cron, daily, webhook and email triggers
 * do not. */
export function scheduleHasKnownEnd(schedule: { type: string; endsAt?: number | null; repeat?: unknown } | null | undefined): boolean {
  if (!schedule) return false;
  if (schedule.type === "once") return true;
  if (schedule.type === "limit_reset") return schedule.repeat !== "every_reset";
  return schedule.type === "interval" && typeof schedule.endsAt === "number";
}
