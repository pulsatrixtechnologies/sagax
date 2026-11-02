/**
 * Durable payload carried by a chat routine confirmation card.
 *
 * Tool input is normalized before it reaches this shape: timestamps are
 * milliseconds, weekly day names are the scheduler's numeric weekday values,
 * and every text field has already been scrubbed for credential-shaped data.
 * Keeping the normalized operation on the card lets a confirmation survive an
 * app restart without asking the model to interpret the request again.
 */

import type { LimitResetRepeat } from "./limit-reset.ts";
import type { RoutineWatchPrecheck } from "./routine-watch.ts";
import type { RoutineCronSchedule } from "./routine-schedule.ts";
import type { RoutineWindowTiming } from "./routine-timing.ts";

export type RoutineRequestRunOn = "maus" | "cloud";

export interface RoutineRequestIntervalWindow {
  start: string;
  end: string;
}

export type RoutineRequestSchedule =
  | { type: "once"; at: number }
  /** The time is the engine's, derived when the routine is saved. */
  | { type: "limit_reset"; engine: string; repeat: LimitResetRepeat }
  | ({ type: "daily"; time: string; weekdays: number[] } & RoutineWindowTiming)
  | (RoutineCronSchedule & RoutineWindowTiming)
  | ({
    type: "interval";
    everyMinutes: number;
    anchorAt?: number;
    /** Local weekdays (Sunday = 0). Missing means every day. */
    weekdays?: number[];
    /** Local wall-clock window. Missing means all day. */
    window?: RoutineRequestIntervalWindow;
    /** Inclusive epoch-millisecond cutoff. Missing means never. */
    endsAt?: number;
  } & RoutineWindowTiming)
  | { type: "webhook" }
  | { type: "event"; source: "email" };

export type RoutineRequestScheduleChanges =
  | Exclude<RoutineRequestSchedule, { type: "interval" }>
  | ({
    type: "interval";
    everyMinutes: number;
    anchorAt?: number;
    /** `null` explicitly restores the every-day default. */
    weekdays?: number[] | null;
    /** `null` explicitly restores the all-day default. */
    window?: RoutineRequestIntervalWindow | null;
    /** `null` explicitly removes an existing end date. */
    endsAt?: number | null;
  } & RoutineWindowTiming);

export interface RoutineRequestDefinition {
  name: string;
  instructions: string;
  schedule: RoutineRequestSchedule;
  runOn: RoutineRequestRunOn;
  /** Legacy calendar/display length. It does not stop an active run. */
  durationMinutes: number;
  /** Optional safety cap for active work. Missing means no timeout. */
  timeoutMinutes?: number;
  /** Carry the previous run's report into the next run. */
  continuity?: boolean;
  /** Skip by default, or keep at most one scheduled run waiting. */
  overlap?: "skip" | "queue";
  /** 2026-10-26: run only when something changes (shared/routine-watch.ts). */
  watch?: RoutineWatchPrecheck;
  /** 2026-10-28: the bot's folder it sits in (shared/routine-folders.ts). */
  folder?: string;
  /** Delete once the schedule ends and the last run settles (#1648). */
  deleteWhenFinished?: boolean;
}

export type RoutineRequestChanges =
  & Omit<Partial<RoutineRequestDefinition>, "schedule" | "timeoutMinutes" | "watch" | "folder">
  & {
    schedule?: RoutineRequestScheduleChanges;
    /** `null` removes an existing safety cap. */
    timeoutMinutes?: number | null;
    /** `null` removes the watch: every due run starts its turn again. */
    watch?: RoutineWatchPrecheck | null;
    /** `null` takes the routine out of its folder. */
    folder?: string | null;
  };

/** Another bot in the proposer's section that this proposal targets: a
 * routine scheduled for it, or one of its routines being changed. Captured
 * (id + display name) when the card is created so the card stays meaningful
 * if the bot is later renamed; authority over the card remains with the
 * proposing conversation. */
export interface RoutineRequestTargetBot {
  botId: string;
  name: string;
}

export type RoutineRequestOperation =
  /** `paused`: decided at proposal time, the routine starts paused. Absent
   * on cards stored before routines could start paused: those start live. */
  | { action: "create"; routine: RoutineRequestDefinition; forBot?: RoutineRequestTargetBot; paused?: true }
  | { action: "update"; routineId: string; expectedUpdatedAt: number; changes: RoutineRequestChanges; forBot?: RoutineRequestTargetBot }
  | { action: "pause"; routineId: string; expectedUpdatedAt: number; forBot?: RoutineRequestTargetBot }
  | { action: "resume"; routineId: string; expectedUpdatedAt: number; forBot?: RoutineRequestTargetBot }
  | { action: "run_now"; routineId: string; expectedUpdatedAt: number; forBot?: RoutineRequestTargetBot }
  | { action: "delete"; routineId: string; expectedUpdatedAt: number; forBot?: RoutineRequestTargetBot }
  /** Mint a new key for the webhook or email trigger this routine owns. */
  | { action: "rotate_webhook_key"; routineId: string; expectedUpdatedAt: number; forBot?: RoutineRequestTargetBot };

/** A routine as it stood before a change applied without a person, so Undo
 * can put it back. Room goals keep their room; attachments are not kept, so
 * a routine that has any is not offered an Undo for its update or delete. */
export interface RoutineRequestSnapshot extends RoutineRequestDefinition {
  enabled: boolean;
  /** The routine's pre-check as it stood (a watch or a condition). */
  precheck?: unknown;
  target?: "room-goal";
  groupId?: string;
  resultsThreadId?: string;
}

/** Written on a card whose change applied without a person (the bot's own
 * routine, or Full access): what the one-line receipt shows, and what its
 * Undo needs. */
export interface RoutineRequestUndo {
  /** The routine's name and schedule as the change left them. */
  name: string;
  schedule?: RoutineRequestSchedule;
  /** The routine's revision right after the change; Undo refuses once it moved. */
  appliedUpdatedAt?: number;
  /** The routine before an update or a delete. */
  before?: RoutineRequestSnapshot;
  /** On a Cloud home: the routine was the owner's before the change. */
  ownersBefore?: boolean;
}

export interface RoutineRequestCardData {
  version: 1;
  /** Also used as the scheduler's idempotency key after confirmation. */
  requestId: string;
  /** Authority is fixed when the card is created; an agent cannot redirect it later. */
  botId: string;
  threadId: string;
  createdAt: number;
  operation: RoutineRequestOperation;
  /** Written after a successful confirmation. Useful for support/debugging. */
  appliedAt?: number;
  resultId?: string;
  undo?: RoutineRequestUndo;
}
