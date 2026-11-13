import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import { z } from "zod";

import { cronScheduleLabel } from "../../shared/cron-label.ts";
import { plainClock, plainTimeZone, plainWeekdays } from "../../shared/plain-time-zone.ts";
import { normalizeCronSchedule, nextCronRuns } from "../../shared/routine-schedule.ts";
import { presentTiming, storedTiming } from "../../shared/routine-timing.ts";
import { isTriggerSchedule } from "../../shared/routines.ts";
import { cleanGithubEventSchedule, githubEventScheduleLabel, type RoutineGithubEventSchedule } from "../../shared/routine-github.ts";
import { newId } from "../contracts.ts";
import { SELF_ROUTINE_CAP, UNDO_STALE, grantAfterQuote, type DirectApply, type DirectApplyCheck } from "../direct-apply.ts";
import { redactSecretsInText } from "../redact.ts";
import { loadRoutinePrecheck, parseRoutinePrecheck } from "./routine-precheck.ts";
import type { RoutineWatchPrecheck } from "../../shared/routine-watch.ts";
import { cleanRoutineFolder, ROUTINE_FOLDER_MAX } from "../../shared/routine-folders.ts";
import { EFFORT_LEVELS } from "../../shared/model-selection.ts";
import { parseRoutineModel } from "../../shared/routine-model.ts";
import { parseRoutineActAs } from "../../shared/routine-act-as.ts";
import { parseRoutineGoal, readRoutineGoalLines, ROUTINE_GOAL_MAX_CHARS, type RoutineGoal } from "../../shared/routine-goal.ts";
import { withRequiredComputer, type RoutineRequirements } from "../../shared/routine-readiness.ts";
import { describeCondition } from "./routine-watch.ts";
import { parseJson, schemaIssue, type JsonObject, type JsonValue } from "../schema.ts";
import {
  intervalHasRestrictions,
  nextOccurrence,
  type Routine,
  type RoutineInput,
  type RoutineManager,
  type RoutineRequestCommit,
  type RoutineSchedule,
  type RoutineScheduleInput,
} from "./routines.ts";
import type {
  RoutineRequestCardData,
  RoutineRequestChanges,
  RoutineRequestDefinition,
  RoutineRequestOperation,
  RoutineRequestRunOn,
  RoutineRequestSchedule,
  RoutineRequestScheduleChanges,
  RoutineRequestSnapshot,
  RoutineRequestUndo,
} from "../../shared/routine-request.ts";

const WEEKDAY_NUMBER = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
} as const;

const RFC3339_WITH_OFFSET =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-](\d{2}):(\d{2}))$/i;
const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const ROUTINE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const MAX_DATE_MS = 8_640_000_000_000_000;
const ACTION_COPY = {
  create: { title: "Schedule", detail: "Create routine" },
  update: { title: "Update", detail: "Update routine" },
  pause: { title: "Pause", detail: "Pause routine" },
  resume: { title: "Resume", detail: "Resume routine" },
  run_now: { title: "Run now", detail: "Run routine now" },
  delete: { title: "Delete", detail: "Delete routine" },
  rotate_webhook_key: { title: "Rotate key", detail: "Rotate the trigger key" },
} as const satisfies Record<RoutineRequestOperation["action"], { title: string; detail: string }>;
const ROUTINE_REQUEST_FINGERPRINT_VERSION = 1 as const;
const jsonObjectSchema = z.record(z.string(), z.custom<JsonValue>());
const toolIntervalWindowSchema = z.object({
  start: z.string().max(5),
  end: z.string().max(5),
}).strict();

const toolTimingFields = {
  timing: z.enum(["exact", "flexible"]).optional(),
  windowEarlyMinutes: z.number().int().min(0).max(366 * 24 * 60).optional(),
  windowLateMinutes: z.number().int().min(0).max(366 * 24 * 60).optional(),
};

const routineToolScheduleSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("cron"), expression: z.string().max(1024), timeZone: z.string().max(128), ...toolTimingFields }).strict(),
  z.object({ type: z.literal("once"), at: z.string().max(64) }).strict(),
  z.object({
    type: z.literal("limit_reset"),
    engine: z.string().trim().min(1).max(128).optional(),
    repeat: z.enum(["once", "every_reset"]).optional(),
  }).strict(),
  z.object({
    type: z.literal("weekly"),
    time: z.string().max(5),
    weekdays: z.array(z.string().max(9)).min(1).max(7),
    ...toolTimingFields,
  }).strict(),
  z.object({
    type: z.literal("interval"),
    everyMinutes: z.number(),
    anchorAt: z.string().max(64).optional(),
    weekdays: z.array(z.string().max(9)).min(1).max(7).nullable().optional(),
    window: toolIntervalWindowSchema.nullable().optional(),
    endsAt: z.string().max(64).nullable().optional(),
    ...toolTimingFields,
  }).strict(),
]);

const routineToolTriggerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("webhook") }).strict(),
  z.object({ type: z.literal("email") }).strict(),
  // I3: GitHub events (issue.opened, issue.labeled, pr.opened,
  // pr.review_requested...) with optional filters (repo, label, branch...).
  z.object({
    type: z.literal("github"),
    events: z.array(z.string().max(80)).max(64).optional(),
    filters: z.record(z.string(), z.array(z.string().max(200)).max(50)).optional(),
  }).strict(),
]);

/** #2696: a goal as a sentence or { text, deadline }; stored as { text, deadline? }. */
const routineGoalSchema = z.union([
  z.string().trim().min(1).max(ROUTINE_GOAL_MAX_CHARS),
  z.object({ text: z.string().trim().min(1).max(ROUTINE_GOAL_MAX_CHARS), deadline: z.union([z.number().int().positive(), z.string().min(1)]).nullable().optional() }).strict(),
]).transform((value, ctx) => {
  const parsed = parseRoutineGoal(value);
  if (!parsed.ok || !parsed.goal) {
    ctx.addIssue({ code: "custom", message: parsed.ok ? "A goal needs text." : parsed.error });
    return z.NEVER;
  }
  return goalOf(parsed.goal);
});

/** The card's view of a goal: what the person wrote, not its runtime state. */
function goalOf(goal: RoutineGoal): { text: string; deadline?: number } {
  return { text: goal.text, ...(goal.deadline ? { deadline: goal.deadline } : {}) };
}

/** #4098: a definition's goal and instructions as the routine will hold
 * them: the `goal` field when given, else the instructions' `/goal` line,
 * which then leaves the instructions so the card says the goal once. */
function goalView(definition: Pick<RoutineRequestDefinition, "instructions" | "goal">): { instructions: string; goal?: { text: string; deadline?: number } } {
  const lines = readRoutineGoalLines(definition.instructions);
  if (definition.goal) return { instructions: lines.instructions, goal: definition.goal };
  const parsed = parseRoutineGoal(lines.goal);
  return { instructions: lines.instructions, ...(parsed.ok && parsed.goal ? { goal: goalOf(parsed.goal) } : {}) };
}

function saysGoal(instructions: string): boolean {
  return readRoutineGoalLines(instructions).goal !== undefined;
}

/** Fields a create or an update may name. The XOR of schedule and trigger
 * lives on the create schema only: an update cannot retarget a trigger. */
const routineToolFieldsSchema = z.object({
  name: z.string().max(80),
  instructions: z.string().max(20_000),
  schedule: routineToolScheduleSchema.optional(),
  trigger: routineToolTriggerSchema.optional(),
  runOn: z.enum(["maus", "cloud"]).optional(),
  durationMinutes: z.number().optional(),
  timeoutMinutes: z.number().nullable().optional(),
  continuity: z.boolean().optional(),
  overlap: z.enum(["skip", "queue"]).optional(),
  /** 2026-10-26: a watch pre-check (server/routines/routine-precheck.ts); null in an
   * update removes it. */
  watch: z.unknown().optional(),
  /** 2026-10-28: the bot's folder (shared/routine-folders.ts); null in an
   * update takes it out of its folder. */
  folder: z.string().max(200).nullable().optional(),
  /** Delete once the schedule ends and the last run settles (#1648). */
  deleteWhenFinished: z.boolean().optional(),
  /** 2026-11-04: the model its runs use; null in an update goes back to the bot's. */
  model: z.string().max(200).nullable().optional(),
  /** #2038: Claude sub-agent model; null in an update clears it. */
  subagentModel: z.string().max(200).nullable().optional(),
  /** 2026-11-05: the Perspicax role its runs act as ("" = Moi); null in an update clears it. */
  actAs: z.string().max(120).nullable().optional(),
  /** #1996: the routine needs its bot's computer online (Automations >
   * Requirements > computer); skills and MCP requirements are kept. */
  requiresComputer: z.boolean().optional(),
  effort: z.union([z.enum(EFFORT_LEVELS), z.literal("")]).nullable().optional(),
  /** #2696: the goal its runs pursue; null in an update removes it. */
  goal: routineGoalSchema.nullable().optional(),
  runOnStartup: z.boolean().optional(),
  /** Create only: true starts the routine live, false paused; absent
   * follows `routines.newPaused`. A webhook or email trigger follows the
   * same rule. Pause and resume are actions of their own. */
  enabled: z.boolean().optional(),
}).strict();

const routineToolDefinitionSchema = routineToolFieldsSchema.superRefine((input, context) => {
  if ((input.schedule === undefined) === (input.trigger === undefined)) {
    context.addIssue({
      code: "custom",
      message: "Choose exactly one of schedule or trigger",
    });
  }
});

const routineToolChangesSchema = routineToolFieldsSchema
  .omit({ timeoutMinutes: true, enabled: true, trigger: true })
  .partial()
  .extend({ timeoutMinutes: z.number().nullable().optional() })
  .strict()
  .refine(
  (changes) => Object.values(changes).some((value) => value !== undefined),
  "Choose at least one routine field to update",
);

/** Resolved and authorized by the harness route (existence + same section)
 * before it reaches this service; re-authorized again at confirm time. */
const targetBotSchema = z.object({
  botId: z.string().min(1).max(128),
  name: z.string().min(1).max(80),
}).strict();
const routineProposalSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), routine: routineToolDefinitionSchema, forBot: targetBotSchema.optional() }).strict(),
  z.object({ action: z.literal("update"), routineId: z.string().max(128), changes: routineToolChangesSchema, forBot: targetBotSchema.optional() }).strict(),
  z.object({ action: z.literal("pause"), routineId: z.string().max(128), forBot: targetBotSchema.optional() }).strict(),
  z.object({ action: z.literal("resume"), routineId: z.string().max(128), forBot: targetBotSchema.optional() }).strict(),
  z.object({ action: z.literal("run_now"), routineId: z.string().max(128), forBot: targetBotSchema.optional() }).strict(),
  z.object({ action: z.literal("delete"), routineId: z.string().max(128), forBot: targetBotSchema.optional() }).strict(),
  z.object({ action: z.literal("rotate_webhook_key"), routineId: z.string().max(128), forBot: targetBotSchema.optional() }).strict(),
]);

const storedWeekdaysSchema = z.array(z.number().int().min(0).max(6)).min(1).max(7).refine(
  (weekdays) => new Set(weekdays).size === weekdays.length,
  "Stored routine weekdays must be unique",
);
const storedIntervalWindowSchema = z.object({
  start: z.string().regex(TIME),
  end: z.string().regex(TIME),
}).strict().refine(
  ({ start, end }) => start < end,
  "Stored interval window must end later on the same day",
);
const storedTimingFields = {
  timing: z.enum(["exact", "flexible"]).optional(),
  windowEarlyMinutes: z.number().int().min(0).max(366 * 24 * 60).optional(),
  windowLateMinutes: z.number().int().min(0).max(366 * 24 * 60).optional(),
};
const storedCronScheduleSchema = z.object({
  type: z.literal("cron"),
  expression: z.string().max(1024),
  timeZone: z.string().max(128),
  ...storedTimingFields,
}).strict().superRefine((schedule, context) => {
  try {
    normalizeCronSchedule(schedule);
  } catch (error) {
    context.addIssue({ code: "custom", message: error instanceof Error ? error.message : "Invalid stored cron schedule" });
  }
});
/** A trigger routine started by email or by GitHub events (I3). GitHub
 * carries its kinds and filters; email carries neither. */
const storedEventScheduleSchema = z.object({
  type: z.literal("event"),
  source: z.enum(["email", "github"]),
  events: z.array(z.string().max(80)).max(64).optional(),
  filters: z.record(z.string(), z.array(z.string().max(200)).max(50)).optional(),
}).strict().superRefine((schedule, context) => {
  if (schedule.source === "email") {
    if (schedule.events !== undefined || schedule.filters !== undefined) {
      context.addIssue({ code: "custom", message: "An email trigger has no events or filters" });
    }
    return;
  }
  try {
    cleanGithubEventSchedule(schedule);
  } catch (error) {
    context.addIssue({ code: "custom", message: error instanceof Error ? error.message : "Invalid GitHub events" });
  }
}).transform((schedule): RoutineGithubEventSchedule | { type: "event"; source: "email" } =>
  schedule.source === "github" ? cleanGithubEventSchedule(schedule) : { type: "event", source: "email" });
const storedLimitResetScheduleSchema = z.object({
  type: z.literal("limit_reset"),
  engine: z.string().trim().min(1).max(128),
  repeat: z.enum(["once", "every_reset"]),
}).strict();

const storedScheduleSchema = z.discriminatedUnion("type", [
  storedCronScheduleSchema,
  z.object({ type: z.literal("once"), at: z.number().int().nonnegative() }).strict(),
  storedLimitResetScheduleSchema,
  z.object({
    type: z.literal("daily"),
    time: z.string().regex(TIME),
    weekdays: storedWeekdaysSchema,
    ...storedTimingFields,
  }).strict(),
  z.object({
    type: z.literal("interval"),
    everyMinutes: z.number().int().min(5).max(1_440),
    anchorAt: z.number().int().nonnegative().max(MAX_DATE_MS).optional(),
    weekdays: storedWeekdaysSchema.optional(),
    window: storedIntervalWindowSchema.optional(),
    endsAt: z.number().int().nonnegative().max(MAX_DATE_MS).optional(),
    ...storedTimingFields,
  }).strict(),
  z.object({ type: z.literal("webhook") }).strict(),
  storedEventScheduleSchema,
]).superRefine((schedule, context) => {
  if (schedule.type !== "interval") return;
  if (schedule.window && intervalWindowMinutes(schedule.window) < schedule.everyMinutes) {
    context.addIssue({
      code: "custom",
      message: "Stored interval window must be at least as long as the cadence",
      path: ["window"],
    });
  }
  if (schedule.endsAt !== undefined && schedule.anchorAt !== undefined && schedule.endsAt < schedule.anchorAt) {
    context.addIssue({
      code: "custom",
      message: "Stored interval end must not be before its anchor",
      path: ["endsAt"],
    });
  }
});
const storedScheduleChangesSchema = z.discriminatedUnion("type", [
  storedCronScheduleSchema,
  z.object({ type: z.literal("once"), at: z.number().int().nonnegative() }).strict(),
  storedLimitResetScheduleSchema,
  z.object({
    type: z.literal("daily"),
    time: z.string().regex(TIME),
    weekdays: storedWeekdaysSchema,
    ...storedTimingFields,
  }).strict(),
  z.object({
    type: z.literal("interval"),
    everyMinutes: z.number().int().min(5).max(1_440),
    anchorAt: z.number().int().nonnegative().max(MAX_DATE_MS).optional(),
    weekdays: storedWeekdaysSchema.nullable().optional(),
    window: storedIntervalWindowSchema.nullable().optional(),
    endsAt: z.number().int().nonnegative().max(MAX_DATE_MS).nullable().optional(),
    ...storedTimingFields,
  }).strict(),
  z.object({ type: z.literal("webhook") }).strict(),
  storedEventScheduleSchema,
]).superRefine((schedule, context) => {
  if (schedule.type !== "interval") return;
  if (schedule.window && intervalWindowMinutes(schedule.window) < schedule.everyMinutes) {
    context.addIssue({
      code: "custom",
      message: "Stored interval window must be at least as long as the cadence",
      path: ["window"],
    });
  }
  if (
    schedule.endsAt !== undefined &&
    schedule.endsAt !== null &&
    schedule.anchorAt !== undefined &&
    schedule.endsAt < schedule.anchorAt
  ) {
    context.addIssue({
      code: "custom",
      message: "Stored interval end must not be before its anchor",
      path: ["endsAt"],
    });
  }
});
const storedDefinitionSchema = z.object({
  name: z.string().trim().min(1).max(80),
  instructions: z.string().trim().min(1).max(20_000),
  schedule: storedScheduleSchema,
  runOn: z.enum(["maus", "cloud"]),
  durationMinutes: z.number().int().min(5).max(240),
  timeoutMinutes: z.number().int().min(5).max(240).optional(),
  continuity: z.boolean().optional(),
  overlap: z.enum(["skip", "queue"]).optional(),
  watch: z.custom<RoutineWatchPrecheck>((value) => loadRoutinePrecheck(value)?.kind === "watch").optional(),
  folder: z.string().min(1).max(ROUTINE_FOLDER_MAX).optional(),
  deleteWhenFinished: z.boolean().optional(),
  model: z.string().min(1).max(200).optional(),
  subagentModel: z.string().min(1).max(200).optional(),
  actAs: z.string().max(120).optional(),
  requiresComputer: z.boolean().optional(),
  effort: z.enum(EFFORT_LEVELS).optional(),
  goal: routineGoalSchema.optional(),
  runOnStartup: z.boolean().optional(),
}).strict();
const storedChangesSchema = storedDefinitionSchema
  .omit({ schedule: true, timeoutMinutes: true, watch: true, folder: true, model: true, subagentModel: true, actAs: true, effort: true, goal: true })
  .partial()
  .extend({
    schedule: storedScheduleChangesSchema.optional(),
    timeoutMinutes: z.number().int().min(5).max(240).nullable().optional(),
    watch: z.custom<RoutineWatchPrecheck | null>((value) => value === null || loadRoutinePrecheck(value)?.kind === "watch").optional(),
    folder: z.string().min(1).max(ROUTINE_FOLDER_MAX).nullable().optional(),
    model: z.string().min(1).max(200).nullable().optional(),
    subagentModel: z.string().min(1).max(200).nullable().optional(),
    actAs: z.string().max(120).nullable().optional(),
    effort: z.enum(EFFORT_LEVELS).nullable().optional(),
    goal: routineGoalSchema.nullable().optional(),
  })
  .strict()
  .refine(
  (changes) => Object.values(changes).some((value) => value !== undefined),
  "Stored routine update must change at least one field",
);
const storedManageBase = {
  routineId: z.string().regex(ROUTINE_ID),
  expectedUpdatedAt: z.number().int().nonnegative(),
  forBot: targetBotSchema.optional(),
};
const storedOperationSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    routine: storedDefinitionSchema,
    forBot: targetBotSchema.optional(),
    paused: z.literal(true).optional(),
  }).strict(),
  z.object({ action: z.literal("update"), ...storedManageBase, changes: storedChangesSchema }).strict(),
  z.object({ action: z.literal("pause"), ...storedManageBase }).strict(),
  z.object({ action: z.literal("resume"), ...storedManageBase }).strict(),
  z.object({ action: z.literal("run_now"), ...storedManageBase }).strict(),
  z.object({ action: z.literal("delete"), ...storedManageBase }).strict(),
  z.object({ action: z.literal("rotate_webhook_key"), ...storedManageBase }).strict(),
]);
const storedSnapshotSchema = storedDefinitionSchema.extend({
  enabled: z.boolean(),
  precheck: z.custom<unknown>((value) => loadRoutinePrecheck(value) !== undefined).optional(),
  target: z.literal("room-goal").optional(),
  groupId: z.string().min(1).max(128).optional(),
  resultsThreadId: z.string().min(1).max(128).optional(),
}).strict();
const storedUndoSchema = z.object({
  name: z.string().max(200),
  schedule: storedScheduleSchema.optional(),
  appliedUpdatedAt: z.number().int().nonnegative().optional(),
  before: storedSnapshotSchema.optional(),
  ownersBefore: z.boolean().optional(),
}).strict();
const routineRequestCardDataSchema = z.object({
  version: z.literal(1),
  requestId: z.string().min(1).max(128),
  botId: z.string().min(1).max(128),
  threadId: z.string().min(1).max(128),
  createdAt: z.number().int().nonnegative(),
  operation: storedOperationSchema,
  appliedAt: z.number().int().nonnegative().optional(),
  resultId: z.string().min(1).max(128).optional(),
  undo: storedUndoSchema.optional(),
}).strict();

export type RoutineToolScheduleInput = z.infer<typeof routineToolScheduleSchema>;
export type RoutineToolDefinitionInput = z.infer<typeof routineToolDefinitionSchema>;
export type RoutineToolChangesInput = z.infer<typeof routineToolChangesSchema>;
export type RoutineProposalInput = z.input<typeof routineProposalSchema>;
type ParsedRoutineProposal = z.output<typeof routineProposalSchema>;

export interface RoutineRequestOptionCard {
  title: string;
  subtitle: string;
  options: string[];
  answered?: string;
  dismissed?: boolean;
  expired?: boolean;
  requestId?: string;
  tool?: string;
  held?: string;
  autoApplied?: boolean;
  undone?: boolean;
  routineRequest?: RoutineRequestCardData;
}

export interface RoutineRequestMessage {
  id: string;
  card?: RoutineRequestOptionCard;
}

/** Kept narrow so the domain can be tested without constructing the full app store. */
export interface RoutineRequestStore {
  messagesFor(threadId: string): RoutineRequestMessage[];
  appendMessage(
    threadId: string,
    message: {
      role: "bot";
      kind: "options";
      card: RoutineRequestOptionCard;
      from?: { botId: string; name: string; color: string };
    },
  ): RoutineRequestMessage;
  patchMessage(
    threadId: string,
    messageId: string,
    patch: { card: RoutineRequestOptionCard },
  ): RoutineRequestMessage | null;
}

export interface RoutineRequestServiceOptions {
  store: RoutineRequestStore;
  routines: RoutineManager;
  now?: () => number;
  timeZone?: () => string;
  /** The language the card's details are written in for the person who
   * answers it (the bot owner): "fr" or "en". English when omitted (#2805). */
  language?: (botId: string, threadId: string) => string;
  /** Whether a submitted change applies without a person, and why
   * (server/direct-apply.ts). Server-owned, never request input. */
  autoApply?: DirectApplyCheck;
  /** Harness-owned readiness check for proposals that would execute in cloud. */
  cloudReady?: (botId: string) => Promise<{ ready: boolean; reason?: string }>;
  /** Revalidates conversation ownership and capacity synchronously, directly
   * before the card append. This closes races across an async cloud probe. */
  canPersist?: (
    botId: string,
    threadId: string,
    /** False for a change that applies directly: it opens no card. */
    opensCard: boolean,
  ) => { ok: true } | { ok: false; status: number; error: string };
  /** Re-authorizes a cross-bot target (the card can sit open while the target
   * bot is deleted or moved to another section). Returns the sentence to
   * refuse with, or null to allow. Checked at propose AND confirm time. */
  validateTarget?: (proposerBotId: string, target: { botId: string; name: string }) => string | null;
  /** Whether a created routine starts paused (config `routines.newPaused`,
   * default false). Read once per proposal and carried on the operation, so
   * the card and the applied routine never disagree. */
  newPaused?: () => boolean;
  /** Attaches the webhook or email trigger a confirmed create owns. The
   * key stays in the webhook store; this callback returns nothing. */
  bindTrigger?: (routine: Routine) => void;
  /** Mints a new key for the trigger the routine owns. The new key stays
   * in the webhook store for the owner to copy. */
  rotateTrigger?: (routine: Routine) => void;
  /** Admin journal for a trigger create or key rotation. No secret. */
  onAudit?: (action: "routine.trigger.create" | "routine.trigger.rotate", routine: Routine) => void;
}

export interface ProposeRoutineRequestArgs {
  /** 2026-10-20: the person asked their Primary Bot for this now (server/index.ts primaryAskedProposal). */
  primaryAsked?: boolean;
  botId: string;
  threadId: string;
  /** Untrusted model output; normalized by routineProposalSchema in propose(). */
  proposal: unknown;
  /** Room cards retain the member attribution used by every other bot message. */
  from?: { botId: string; name: string; color: string };
  /** Exact caller/turn lease checked synchronously after any readiness await
   * and immediately before the durable card append. */
  canCommit?: () => boolean;
  /** Safety review: do not apply a Full-access grant until the person accepts. */
  explicitConfirm?: boolean;
  /** A quote was given and did not prove the ask: no quote fast path and no
   * self grant, but Full access still applies (grantAfterQuote). */
  quoteRefused?: boolean;
}

export interface RoutineProposalResult {
  requestId: string;
  messageId: string;
  title: string;
  /** Short response returned to the proposing agent. */
  summary: string;
  /** Exact approval text persisted in the card. */
  detail: string;
  nextRunAt: number | null;
  timeZone: string;
}

interface RoutineCardCopy {
  title: string;
  summary: string;
  detail: string;
  nextRunAt: number | null;
  tool: "schedule_routine" | "manage_routine";
}

export type ResolveRoutineRequestResult =
  | { claimed: false; state: "not_found" }
  | { claimed: true; state: "invalid"; error: string; status: number }
  | { claimed: true; state: "already_settled"; behavior: string }
  | { claimed: true; state: "denied" }
  | {
      claimed: true;
      state: "applied";
      action: RoutineRequestOperation["action"];
      resultId: string;
      settlementPending?: true;
      message?: string;
      /** The owner copies the new key in the app. Never the key itself. */
      ownerCopiesKey?: true;
    };

export type UndoRoutineRequestResult =
  | { claimed: false }
  | { claimed: true; state: "already_undone" }
  | { claimed: true; state: "invalid"; error: string; status: number; stale?: true }
  | {
      claimed: true;
      state: "undone";
      action: RoutineRequestOperation["action"];
      routineId: string;
      /** A deleted routine comes back under a new id. */
      restoredId?: string;
      ownersBefore?: boolean;
    };

export class RoutineRequestError extends Error {
  readonly status: number;
  /** True when no retry of this card can ever succeed — the routine moved
   * under the proposal — so the card must settle as expired rather than
   * staying actionable. */
  readonly terminal: boolean;

  constructor(message: string, status = 400, options?: { terminal?: boolean }) {
    super(message);
    this.name = "RoutineRequestError";
    this.status = status;
    this.terminal = options?.terminal === true;
  }
}

function text(value: string, field: string, max: number): string {
  const trimmed = value.trim();
  if (!trimmed) throw new RoutineRequestError(`${field} is required`);
  if (trimmed.length > max) throw new RoutineRequestError(`${field} must be ${max.toLocaleString("en-US")} characters or fewer`);
  // This payload is hidden under the visible card fields, so the store's
  // shallow card redaction cannot reach it. Scrub before it is persisted.
  const redacted = redactSecretsInText(trimmed);
  if (redacted.length > max) {
    throw new RoutineRequestError(
      `${field} must remain ${max.toLocaleString("en-US")} characters or fewer after credentials are removed`,
    );
  }
  return redacted;
}

function runOn(value: RoutineRequestRunOn | undefined): RoutineRequestRunOn {
  return value ?? "maus";
}

function duration(value: number | undefined): number {
  const normalized = value ?? 30;
  if (!Number.isInteger(normalized) || normalized < 5 || normalized > 240) {
    throw new RoutineRequestError("durationMinutes must be a whole number from 5 to 240");
  }
  return normalized;
}

function timeout(value: number | null | undefined): number | null | undefined {
  if (value == null) return value;
  if (!Number.isInteger(value) || value < 5 || value > 240) {
    throw new RoutineRequestError("timeoutMinutes must be a whole number from 5 to 240");
  }
  return value;
}

function intervalWindowMinutes(window: { start: string; end: string }): number {
  const [startHour, startMinute] = window.start.split(":").map(Number);
  const [endHour, endMinute] = window.end.split(":").map(Number);
  return endHour * 60 + endMinute - (startHour * 60 + startMinute);
}

function intervalWeekdays(values: string[]): number[] {
  const weekdays = values.map((day) => {
    const number = WEEKDAY_NUMBER[day.toLowerCase() as keyof typeof WEEKDAY_NUMBER];
    if (number === undefined) throw new RoutineRequestError(`Unsupported weekday: ${day}`);
    return number;
  });
  return [...new Set(weekdays)].sort();
}

function intervalWindow(
  value: { start: string; end: string },
  everyMinutes: number,
): { start: string; end: string } {
  if (!TIME.test(value.start) || !TIME.test(value.end)) {
    throw new RoutineRequestError("Interval windows must use 24-hour HH:MM");
  }
  if (value.start >= value.end) {
    throw new RoutineRequestError("Interval windows must end later on the same day");
  }
  if (intervalWindowMinutes(value) < everyMinutes) {
    throw new RoutineRequestError("The interval window must be at least as long as everyMinutes");
  }
  return { start: value.start, end: value.end };
}

function rfc3339Instant(value: string, offsetMessage: string): number {
  const parts = RFC3339_WITH_OFFSET.exec(value);
  if (!parts) throw new RoutineRequestError(offsetMessage);
  const year = Number(parts[1]);
  const month = Number(parts[2]);
  const day = Number(parts[3]);
  const hour = Number(parts[4]);
  const minute = Number(parts[5]);
  const second = Number(parts[6]);
  const offsetHour = Number(parts[7] ?? 0);
  const offsetMinute = Number(parts[8] ?? 0);
  const daysInMonth = month >= 1 && month <= 12
    ? new Date(Date.UTC(year, month, 0)).getUTCDate()
    : 0;
  if (
    day < 1 ||
    day > daysInMonth ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    offsetHour > 23 ||
    offsetMinute > 59
  ) {
    throw new RoutineRequestError("Choose a valid RFC3339 date and time");
  }
  const at = Date.parse(value);
  if (!Number.isFinite(at)) throw new RoutineRequestError("Choose a valid RFC3339 date and time");
  return at;
}

function timed<T extends { type: string }>(schedule: T, source: unknown): T {
  try {
    return presentTiming(schedule, source);
  } catch (error) {
    throw new RoutineRequestError(error instanceof Error ? error.message : "Choose a valid schedule");
  }
}

function timingCarry(schedule: {
  type: string;
  timing?: "exact" | "flexible";
  windowEarlyMinutes?: number;
  windowLateMinutes?: number;
}): { timing?: "exact" | "flexible"; windowEarlyMinutes?: number; windowLateMinutes?: number } {
  return {
    ...storedTiming(schedule),
    ...(schedule.timing === "exact" ? { timing: "exact" as const } : {}),
  };
}

/** Keep the routine's flexible window when an update does not name a timing. */
function keptTiming(
  current: RoutineRequestSchedule,
  incoming: object,
): { timing?: "exact" | "flexible"; windowEarlyMinutes?: number; windowLateMinutes?: number } {
  if (isTriggerSchedule(current) || isTriggerSchedule(incoming as { type: string })) return {};
  if (current.type === "limit_reset" || (incoming as { type?: string }).type === "limit_reset") return {};
  if (Object.hasOwn(incoming, "timing")) return timingCarry(incoming as Parameters<typeof timingCarry>[0]);
  if (current.type !== "once" && "timing" in current && current.timing === "flexible") return storedTiming(current);
  return {};
}

/** Window minutes on an update of a flexible routine, with no timing key, keep that mode. */
function flexibleWindowUpdate(
  schedule: RoutineToolScheduleInput,
  current: { type: string; timing?: string; windowEarlyMinutes?: number; windowLateMinutes?: number } | undefined,
): RoutineToolScheduleInput {
  if (schedule.type === "once" || schedule.type === "limit_reset" || !current || current.type === "once" || current.timing !== "flexible") return schedule;
  if (schedule.timing != null) return schedule;
  if (schedule.windowEarlyMinutes == null && schedule.windowLateMinutes == null) return schedule;
  return {
    ...schedule,
    timing: "flexible",
    windowEarlyMinutes: schedule.windowEarlyMinutes ?? current.windowEarlyMinutes,
    windowLateMinutes: schedule.windowLateMinutes ?? current.windowLateMinutes,
  };
}

function normalizeSchedule(
  schedule: RoutineToolScheduleInput,
  now: number,
  current?: { type: string; timing?: string; windowEarlyMinutes?: number; windowLateMinutes?: number },
  ownEngine?: string,
): RoutineRequestSchedule {
  const source = flexibleWindowUpdate(schedule, current);
  if (schedule.type === "cron") {
    try {
      const base = normalizeCronSchedule({ type: "cron", expression: schedule.expression, timeZone: schedule.timeZone }, now);
      return timed(base, source);
    } catch (error) {
      if (error instanceof RoutineRequestError) throw error;
      throw new RoutineRequestError(error instanceof Error ? error.message : "Invalid cron schedule");
    }
  }
  if (schedule.type === "limit_reset") {
    const engine = (schedule.engine ?? ownEngine ?? "").trim();
    if (!engine || engine.length > 128) throw new RoutineRequestError("engine must be an engine id such as claude or codex");
    return { type: "limit_reset", engine, repeat: schedule.repeat ?? "once" };
  }
  if (schedule.type === "once") {
    const at = rfc3339Instant(
      schedule.at,
      "One-time schedules need an RFC3339 date-time with an explicit timezone offset",
    );
    if (at <= now) throw new RoutineRequestError("The scheduled date and time must be in the future");
    return { type: "once", at };
  }
  if (schedule.type === "interval") {
    if (!Number.isInteger(schedule.everyMinutes) || schedule.everyMinutes < 5 || schedule.everyMinutes > 1_440) {
      throw new RoutineRequestError("everyMinutes must be a whole number from 5 to 1440");
    }
    let anchorAt: number | undefined;
    if (schedule.anchorAt !== undefined) {
      anchorAt = rfc3339Instant(
        schedule.anchorAt,
        "Interval starts need an RFC3339 date-time with an explicit timezone offset",
      );
      if (!Number.isSafeInteger(anchorAt) || anchorAt < 0 || anchorAt > MAX_DATE_MS) {
        throw new RoutineRequestError("Choose a valid interval start time");
      }
    }
    let endsAt: number | undefined;
    if (schedule.endsAt !== undefined && schedule.endsAt !== null) {
      endsAt = rfc3339Instant(
        schedule.endsAt,
        "Interval ends need an RFC3339 date-time with an explicit timezone offset",
      );
      if (!Number.isSafeInteger(endsAt) || endsAt < 0 || endsAt > MAX_DATE_MS) {
        throw new RoutineRequestError("Choose a valid interval end time");
      }
      if (endsAt < (anchorAt ?? now)) {
        throw new RoutineRequestError("The interval end must not be before its start");
      }
    }
    return timed({
      type: "interval",
      everyMinutes: schedule.everyMinutes,
      ...(anchorAt === undefined ? {} : { anchorAt }),
      ...(schedule.weekdays == null ? {} : { weekdays: intervalWeekdays(schedule.weekdays) }),
      ...(schedule.window == null ? {} : { window: intervalWindow(schedule.window, schedule.everyMinutes) }),
      ...(endsAt === undefined ? {} : { endsAt }),
    }, source);
  }
  if (!TIME.test(schedule.time)) {
    throw new RoutineRequestError("Weekly schedule time must use 24-hour HH:MM");
  }
  if (schedule.weekdays.length === 0) throw new RoutineRequestError("Choose at least one weekday");
  const weekdays = [...new Set(schedule.weekdays.map((day) => {
    // SAFETY: every key in WEEKDAY_NUMBER is lower-case; membership is
    // checked immediately below before the numeric value is retained.
    const number = WEEKDAY_NUMBER[day.toLowerCase() as keyof typeof WEEKDAY_NUMBER];
    if (number === undefined) throw new RoutineRequestError(`Unsupported weekday: ${day}`);
    return number;
  }))].sort();
  return timed({ type: "daily", time: schedule.time, weekdays }, source);
}

function normalizeScheduleChanges(
  schedule: RoutineToolScheduleInput,
  now: number,
  current?: { type: string; timing?: string; windowEarlyMinutes?: number; windowLateMinutes?: number },
): RoutineRequestScheduleChanges {
  const normalized = normalizeSchedule(schedule, now, current);
  if (schedule.type !== "interval" || normalized.type !== "interval") return normalized;
  return {
    ...normalized,
    ...(schedule.weekdays === null ? { weekdays: null } : {}),
    ...(schedule.window === null ? { window: null } : {}),
    ...(schedule.endsAt === null ? { endsAt: null } : {}),
  };
}

function triggerSchedule(trigger: z.infer<typeof routineToolTriggerSchema>): RoutineRequestSchedule {
  if (trigger.type === "webhook") return { type: "webhook" };
  if (trigger.type === "github") {
    try {
      return cleanGithubEventSchedule(trigger);
    } catch (error) {
      throw new RoutineRequestError(error instanceof Error ? error.message : "Choose GitHub events");
    }
  }
  return { type: "event", source: "email" };
}

/** A routine tool's `model`: a model id, or undefined for the bot's model. */
function modelInput(value: unknown): string | undefined {
  const parsed = parseRoutineModel(value);
  if (!parsed.ok) throw new RoutineRequestError(parsed.error);
  return parsed.model;
}

/** A routine tool's `actAs`: a role slug, "" for "Moi", undefined for none. */
function actAsInput(value: unknown): string | undefined {
  const parsed = parseRoutineActAs(value);
  if (!parsed.ok) throw new RoutineRequestError(parsed.error);
  return parsed.actAs;
}

/** A routine tool's `watch`: a watch pre-check, or null to remove one. */
function watchInput(value: unknown): RoutineWatchPrecheck | null {
  if (value === null) return null;
  let parsed;
  try {
    parsed = parseRoutinePrecheck(value);
  } catch (error) {
    throw new RoutineRequestError(error instanceof Error ? error.message.replace("pre-check", "watch") : "Choose a valid watch");
  }
  if (parsed.kind !== "watch") throw new RoutineRequestError("Choose a valid watch: kind must be watch");
  return parsed;
}

function normalizeDefinition(input: RoutineToolDefinitionInput, now: number): RoutineRequestDefinition {
  if ((input.schedule === undefined) === (input.trigger === undefined)) {
    throw new RoutineRequestError("Choose exactly one of schedule or trigger");
  }
  const timeoutMinutes = timeout(input.timeoutMinutes);
  return {
    name: text(input.name, "name", 80),
    instructions: text(input.instructions, "instructions", 20_000),
    schedule: input.trigger ? triggerSchedule(input.trigger) : normalizeSchedule(input.schedule!, now),
    runOn: runOn(input.runOn),
    durationMinutes: duration(input.durationMinutes),
    ...(timeoutMinutes == null ? {} : { timeoutMinutes }),
    ...(input.continuity === true ? { continuity: true } : {}),
    ...(input.overlap === "queue" ? { overlap: "queue" as const } : {}),
    ...(input.watch != null ? { watch: watchInput(input.watch)! } : {}),
    ...(cleanRoutineFolder(input.folder) ? { folder: cleanRoutineFolder(input.folder)! } : {}),
    ...(input.deleteWhenFinished === true ? { deleteWhenFinished: true } : {}),
    ...(modelInput(input.model) ? { model: modelInput(input.model)! } : {}),
    ...(modelInput(input.subagentModel) ? { subagentModel: modelInput(input.subagentModel)! } : {}),
    ...(actAsInput(input.actAs) !== undefined ? { actAs: actAsInput(input.actAs)! } : {}),
    ...(input.requiresComputer === true ? { requiresComputer: true } : {}),
    ...(input.effort ? { effort: input.effort } : {}),
    ...(input.goal ? { goal: { ...input.goal } } : {}),
    ...(input.runOnStartup === true ? { runOnStartup: true } : {}),
  };
}

function normalizeChanges(
  input: RoutineToolChangesInput,
  now: number,
  current?: { type: string; timing?: string; windowEarlyMinutes?: number; windowLateMinutes?: number },
): RoutineRequestChanges {
  const changes: RoutineRequestChanges = {};
  if (input.name !== undefined) changes.name = text(input.name, "name", 80);
  if (input.instructions !== undefined) changes.instructions = text(input.instructions, "instructions", 20_000);
  if (input.schedule !== undefined) changes.schedule = normalizeScheduleChanges(input.schedule, now, current);
  if (input.runOn !== undefined) changes.runOn = runOn(input.runOn);
  if (input.durationMinutes !== undefined) changes.durationMinutes = duration(input.durationMinutes);
  if (input.timeoutMinutes !== undefined) changes.timeoutMinutes = timeout(input.timeoutMinutes);
  if (input.continuity !== undefined) changes.continuity = input.continuity === true;
  if (input.overlap !== undefined) changes.overlap = input.overlap;
  if (input.watch !== undefined) changes.watch = watchInput(input.watch);
  if (input.folder !== undefined) changes.folder = cleanRoutineFolder(input.folder) ?? null;
  if (input.deleteWhenFinished !== undefined) changes.deleteWhenFinished = input.deleteWhenFinished === true;
  if (input.model !== undefined) changes.model = modelInput(input.model) ?? null;
  if (input.subagentModel !== undefined) changes.subagentModel = modelInput(input.subagentModel) ?? null;
  if (input.actAs !== undefined) changes.actAs = actAsInput(input.actAs) ?? null;
  if (input.requiresComputer !== undefined) changes.requiresComputer = input.requiresComputer === true;
  if (input.effort !== undefined) changes.effort = input.effort || null;
  if (input.goal !== undefined) changes.goal = input.goal ? { ...input.goal } : null;
  if (input.runOnStartup !== undefined) changes.runOnStartup = input.runOnStartup === true;
  return changes;
}

function routineId(value: string): string {
  if (!ROUTINE_ID.test(value)) throw new RoutineRequestError("Choose a valid routine id");
  return value;
}

function ownedRoutine(manager: RoutineManager, id: string, botId: string): Routine | null {
  return manager.listRoutines().find((routine) => routine.id === id && routine.botId === botId) ?? null;
}

function noFutureResumeMessage(schedule: RoutineSchedule): string {
  if (schedule.type === "interval") {
    return "That interval routine has no future runs. Choose a later end time or remove the end restriction before resuming.";
  }
  if (schedule.type === "once") {
    return "That one-time routine's scheduled time has passed. Update it to a new future time before resuming.";
  }
  return "That routine has no future runs. Update its schedule before resuming.";
}

function normalizedOperation(
  manager: RoutineManager,
  botId: string,
  validated: ParsedRoutineProposal,
  now: number,
  newPaused = false,
): RoutineRequestOperation {
  if (validated.action === "create") {
    const operation: Extract<RoutineRequestOperation, { action: "create" }> = {
      action: "create",
      routine: normalizeDefinition(validated.routine, now),
    };
    if (validated.forBot) operation.forBot = validated.forBot;
    // An explicit choice of the creator wins over the server default, for a
    // schedule and a webhook or email trigger alike. A live trigger still
    // needs its key (webhook) and still runs a confined turn.
    if (validated.routine.enabled === undefined ? newPaused : !validated.routine.enabled) {
      operation.paused = true;
    }
    return operation;
  }
  const id = routineId(validated.routineId);
  // A targeted action manages the named bot's routine: ownership and every
  // run's permissions stay with that bot, exactly as a routine created
  // through the for_bot_id path keeps them.
  const ownerBotId = validated.forBot?.botId ?? botId;
  const current = ownedRoutine(manager, id, ownerBotId);
  if (!current) throw new RoutineRequestError("That routine does not exist", 404);
  if (validated.action === "update") {
    return {
      action: "update",
      routineId: id,
      expectedUpdatedAt: current.updatedAt,
      changes: normalizeChanges(validated.changes, now, current.schedule),
      ...(validated.forBot ? { forBot: validated.forBot } : {}),
    };
  }
  if (validated.action === "rotate_webhook_key" && !isTriggerSchedule(current.schedule)) {
    throw new RoutineRequestError("That routine has no webhook or email trigger", 409);
  }
  // A trigger has no clock, so a null next run is not a reason to refuse resume.
  if (validated.action === "resume" && current.schedule.type !== "limit_reset" && !isTriggerSchedule(current.schedule) && nextOccurrence(current.schedule, now) === null) {
    throw new RoutineRequestError(noFutureResumeMessage(current.schedule), 409);
  }
  return {
    action: validated.action,
    routineId: id,
    expectedUpdatedAt: current.updatedAt,
    ...(validated.forBot ? { forBot: validated.forBot } : {}),
  };
}

export function asSchedule(schedule: RoutineRequestSchedule, now: number): RoutineSchedule {
  if (schedule.type === "cron") return { ...schedule };
  if (schedule.type === "limit_reset") return { type: "limit_reset", engine: schedule.engine, repeat: schedule.repeat, at: null };
  if (schedule.type === "once") return { type: "once", at: schedule.at };
  if (schedule.type === "interval") {
    return {
      type: "interval",
      everyMinutes: schedule.everyMinutes,
      anchorAt: schedule.anchorAt ?? now,
      ...(schedule.weekdays === undefined ? {} : { weekdays: [...schedule.weekdays] }),
      ...(schedule.window === undefined ? {} : { window: { ...schedule.window } }),
      ...(schedule.endsAt === undefined ? {} : { endsAt: schedule.endsAt }),
      ...timingCarry(schedule),
    };
  }
  if (schedule.type === "webhook") return { type: "webhook" };
  if (schedule.type === "event") return schedule.source === "github" ? cleanGithubEventSchedule(schedule) : { type: "event", source: "email" };
  return { type: "daily", time: schedule.time, weekdays: [...schedule.weekdays], ...timingCarry(schedule) };
}

function schedulePatch(
  schedule: RoutineRequestScheduleChanges,
  now: number,
  current: RoutineSchedule,
): RoutineScheduleInput {
  if (schedule.type !== "interval") return asSchedule(schedule, now);
  return {
    type: "interval",
    everyMinutes: schedule.everyMinutes,
    anchorAt: schedule.anchorAt ?? (current.type === "interval" ? current.anchorAt : now),
    ...(Object.hasOwn(schedule, "weekdays")
      ? { weekdays: schedule.weekdays === null ? null : [...schedule.weekdays!] }
      : {}),
    ...(Object.hasOwn(schedule, "window")
      ? { window: schedule.window === null ? null : { ...schedule.window! } }
      : {}),
    ...(Object.hasOwn(schedule, "endsAt") ? { endsAt: schedule.endsAt } : {}),
    ...(Object.hasOwn(schedule, "timing") ? timingCarry(schedule) : {}),
  };
}

function effectiveSchedule(
  current: RoutineRequestSchedule,
  incoming: RoutineRequestScheduleChanges,
): RoutineRequestSchedule {
  if (incoming.type === "cron") return { ...incoming, ...keptTiming(current, incoming) };
  if (incoming.type === "limit_reset") return { ...incoming };
  if (incoming.type === "webhook") return { type: "webhook" };
  if (incoming.type === "event") return incoming.source === "github" ? cleanGithubEventSchedule(incoming) : { type: "event", source: "email" };
  if (incoming.type !== "interval") {
    return incoming.type === "once"
      ? { type: "once", at: incoming.at }
      : { type: "daily", time: incoming.time, weekdays: [...incoming.weekdays], ...keptTiming(current, incoming) };
  }
  const previous = current.type === "interval" ? current : undefined;
  const merged: Extract<RoutineRequestSchedule, { type: "interval" }> = {
    type: "interval",
    everyMinutes: incoming.everyMinutes,
    ...(incoming.anchorAt !== undefined
      ? { anchorAt: incoming.anchorAt }
      : previous?.anchorAt !== undefined
        ? { anchorAt: previous.anchorAt }
        : {}),
  };
  const weekdays = incoming.weekdays === undefined ? previous?.weekdays : incoming.weekdays;
  if (weekdays !== undefined && weekdays !== null) merged.weekdays = [...weekdays];
  const window = incoming.window === undefined ? previous?.window : incoming.window;
  if (window !== undefined && window !== null) merged.window = { ...window };
  const endsAt = incoming.endsAt === undefined ? previous?.endsAt : incoming.endsAt;
  if (endsAt !== undefined && endsAt !== null) merged.endsAt = endsAt;
  Object.assign(merged, keptTiming(current, incoming));
  return merged;
}

function nextForOperation(operation: RoutineRequestOperation, manager: RoutineManager, now: number): number | null {
  if (operation.action === "create") {
    if (operation.routine.schedule.type === "interval" && operation.routine.schedule.anchorAt === undefined) return null;
    const schedule = asSchedule(operation.routine.schedule, now);
    return schedule.type === "once" ? nextOccurrence(schedule, now) : manager.nextExactStart(schedule, now);
  }
  const current = manager.listRoutines().find((routine) => routine.id === operation.routineId);
  if (!current) return null;
  if (operation.action === "pause" || operation.action === "delete") return null;
  if (operation.action === "run_now") return now;
  if (operation.action === "resume") {
    return current.schedule.type === "once"
      ? nextOccurrence(current.schedule, now)
      : manager.nextExactStart(current.schedule, now, current);
  }
  if (!("changes" in operation)) return null;
  if (!current.enabled) return null;
  const definition = effectiveDefinition(operation, manager);
  if (!definition) return null;
  if (definition.schedule.type === "interval" && definition.schedule.anchorAt === undefined) return null;
  const schedule = asSchedule(definition.schedule, now);
  return schedule.type === "once" ? nextOccurrence(schedule, now) : manager.nextExactStart(schedule, now, current);
}

/** The card's language: French for any "fr" tag, else English. */
export type CardLocale = "en" | "fr";
export function cardLocale(language: string | null | undefined): CardLocale {
  return language?.trim().toLowerCase().startsWith("fr") ? "fr" : "en";
}

const FR_WEEKDAYS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];

/** plainWeekdays in the card's language. */
function weekdaysText(weekdays: readonly number[], locale: CardLocale): string {
  if (locale === "en") return plainWeekdays(weekdays);
  const days = [...weekdays].sort((a, b) => a - b).join(",");
  return days === "0,1,2,3,4,5,6" ? "tous les jours" : days === "1,2,3,4,5" ? "en semaine" : weekdays.map((day) => FR_WEEKDAYS[day]).join(", ");
}

/** "09:00" as the card's reader writes it: "9:00", or "9 h 00" in French. */
function clockText(time: string, locale: CardLocale): string {
  if (locale === "en") return plainClock(time);
  const [hour, minute] = time.split(":");
  return `${Number(hour)} h ${minute ?? "00"}`;
}

function formatInstant(at: number, timeZone: string, locale: CardLocale = "en"): string {
  try {
    return new Intl.DateTimeFormat(locale === "fr" ? "fr-CA" : "en-US", {
      timeZone,
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(at));
  } catch {
    return new Date(at).toISOString();
  }
}

function timingPhrase(schedule: RoutineRequestSchedule): string {
  if (schedule.type === "once" || schedule.type === "limit_reset" || isTriggerSchedule(schedule) || schedule.timing !== "flexible") return "";
  return ` (-${schedule.windowEarlyMinutes ?? 0}/+${schedule.windowLateMinutes ?? 0} min)`;
}

export function scheduleText(schedule: RoutineRequestSchedule, timeZone: string, locale: CardLocale = "en"): string {
  const fr = locale === "fr";
  const phrase = timingPhrase(schedule);
  const around = fr ? "vers l’heure" : "around the time";
  if (schedule.type === "cron") {
    // The card says it in words; the expression stays under the hood (2026-10-29).
    const label = cronScheduleLabel(schedule, locale);
    return phrase ? `${label} · ${around}${phrase}` : label;
  }
  if (schedule.type === "limit_reset") {
    if (fr) {
      return schedule.repeat === "every_reset"
        ? `Chaque fois que la limite d’utilisation de ${schedule.engine} se réinitialise`
        : `Quand la limite d’utilisation de ${schedule.engine} se réinitialise`;
    }
    return schedule.repeat === "every_reset"
      ? `Each time the ${schedule.engine} usage limit resets`
      : `When the ${schedule.engine} usage limit resets`;
  }
  const zone = plainTimeZone(timeZone, locale);
  if (schedule.type === "once") return `${formatInstant(schedule.at, timeZone, locale)} ${zone}`;
  if (schedule.type === "interval") {
    const restricted = intervalHasRestrictions(schedule);
    const every = fr ? `Toutes les ${schedule.everyMinutes} minutes` : `Every ${schedule.everyMinutes} minutes`;
    const cadence = schedule.anchorAt === undefined
      ? restricted
        ? fr
          ? `${every}, cadence lancée à la confirmation; première exécution au prochain moment permis`
          : `${every}, cadence starting at confirmation; first run is the next allowed time`
        : fr
          ? `${every}, à partir d’un intervalle après la confirmation`
          : `${every}, starting one interval after confirmation`
      : fr
        ? `${every}, à partir du ${formatInstant(schedule.anchorAt, timeZone, locale)} ${zone}`
        : `${every}, anchored at ${formatInstant(schedule.anchorAt, timeZone, locale)} ${zone}`;
    const restrictions = [
      schedule.weekdays?.length
        ? `${fr ? "le" : "on"} ${weekdaysText(schedule.weekdays, locale)} (${zone})`
        : null,
      schedule.window ? `${fr ? "entre" : "during"} ${clockText(schedule.window.start, locale)}-${clockText(schedule.window.end, locale)} ${zone}` : null,
      schedule.endsAt !== undefined ? `${fr ? "jusqu’au" : "until"} ${formatInstant(schedule.endsAt, timeZone, locale)} ${zone}` : null,
    ].filter((part): part is string => part !== null);
    const text = restrictions.length ? `${cadence} · ${restrictions.join(" · ")}` : cadence;
    return phrase ? `${text} · ${around}${phrase}` : text;
  }
  if (schedule.type === "webhook") {
    return fr
      ? "Déclencheur : webhook entrant (l’URL et la clé te sont montrées après l’approbation)"
      : "Trigger: incoming webhook (URL and key are shown to you after approval)";
  }
  if (schedule.type === "event" && schedule.source === "github") {
    const events = githubEventScheduleLabel(schedule).slice("GitHub: ".length);
    return fr
      ? `Déclencheur : événements GitHub (${events}); l’URL et le secret du webhook GitHub te sont montrés après l’approbation`
      : `Trigger: GitHub events (${events}); the GitHub webhook URL and secret are shown to you after approval`;
  }
  if (schedule.type === "event") {
    return fr
      ? "Déclencheur : courriel entrant (la configuration de la boîte t’est montrée après l’approbation)"
      : "Trigger: incoming email (the mailbox setup is shown to you after approval)";
  }
  const days = weekdaysText(schedule.weekdays, locale);
  if (fr) {
    return phrase
      ? `${days} vers ${clockText(schedule.time, locale)}${phrase} ${zone}`
      : `${days} à ${clockText(schedule.time, locale)} ${zone}`;
  }
  return phrase
    ? `${days} around ${plainClock(schedule.time)}${phrase} ${zone}`
    : `${days} at ${plainClock(schedule.time)} ${zone}`;
}

/** One plain sentence describing how often a routine will actually run, so
 * the approval card states the consequence rather than just the schedule. */
export function consequenceLine(schedule: RoutineRequestSchedule, continuity = false, locale: CardLocale = "en"): string {
  if (locale === "fr") return frenchConsequenceLine(schedule, continuity);
  // A continuity routine still gets a fresh session per run; what carries
  // over is the previous run's report, so say that rather than contradict
  // the Continuity line above it.
  const session = continuity ? "each run starts a fresh session with the previous run's report" : "each run starts a fresh session";
  const window = schedule.type !== "once" && schedule.type !== "limit_reset" && !isTriggerSchedule(schedule) && schedule.timing === "flexible"
    ? ` Starts up to ${schedule.windowEarlyMinutes ?? 0} min early and ${schedule.windowLateMinutes ?? 0} min late.`
    : "";
  if (schedule.type === "webhook") return "Runs when a webhook delivery arrives.";
  if (schedule.type === "event" && schedule.source === "github") return `Runs on ${githubEventScheduleLabel(schedule)}.`;
  if (schedule.type === "event") return "Runs when email arrives.";
  if (schedule.type === "limit_reset") {
    return schedule.repeat === "every_reset"
      ? `Will run each time the ${schedule.engine} usage limit resets; ${session}.`
      : `Will run once when the ${schedule.engine} usage limit resets; that run starts a fresh session.`;
  }
  if (schedule.type === "cron") return `Will run at matching calendar times, ${plainTimeZone(schedule.timeZone)}; ${session}.${window}`;
  if (schedule.type === "once") return "Will run once; that run starts a fresh session.";
  if (schedule.type === "interval") {
    if (intervalHasRestrictions(schedule)) {
      return `Will run every ${schedule.everyMinutes} minutes when its day, time, and end restrictions allow; ${session}.${window}`;
    }
    const runsPerDay = Math.round(1440 / schedule.everyMinutes);
    const cadence = runsPerDay <= 1 ? "about once a day" : `about ${runsPerDay} times a day`;
    return `Will run ${cadence}; ${session}.${window}`;
  }
  const days = schedule.weekdays.length;
  const cadence = days === 7 ? "every day" : days === 1 ? "one day a week" : `${days} days a week`;
  return `Will run ${cadence}; ${session}.${window}`;
}

/** consequenceLine in French (#2805). */
function frenchConsequenceLine(schedule: RoutineRequestSchedule, continuity: boolean): string {
  const session = continuity ? "chaque exécution ouvre une nouvelle session avec le rapport de la précédente" : "chaque exécution ouvre une nouvelle session";
  const window = schedule.type !== "once" && schedule.type !== "limit_reset" && !isTriggerSchedule(schedule) && schedule.timing === "flexible"
    ? ` Démarre jusqu’à ${schedule.windowEarlyMinutes ?? 0} min plus tôt et ${schedule.windowLateMinutes ?? 0} min plus tard.`
    : "";
  if (schedule.type === "webhook") return "S’exécute à l’arrivée d’une livraison du webhook.";
  if (schedule.type === "event" && schedule.source === "github") return `S’exécute sur ${githubEventScheduleLabel(schedule)}.`;
  if (schedule.type === "event") return "S’exécute à l’arrivée d’un courriel.";
  if (schedule.type === "limit_reset") {
    return schedule.repeat === "every_reset"
      ? `S’exécutera chaque fois que la limite d’utilisation de ${schedule.engine} se réinitialise; ${session}.`
      : `S’exécutera une fois quand la limite d’utilisation de ${schedule.engine} se réinitialise; cette exécution ouvre une nouvelle session.`;
  }
  if (schedule.type === "cron") return `S’exécutera aux heures prévues au calendrier, ${plainTimeZone(schedule.timeZone, "fr")}; ${session}.${window}`;
  if (schedule.type === "once") return "S’exécutera une fois; cette exécution ouvre une nouvelle session.";
  if (schedule.type === "interval") {
    if (intervalHasRestrictions(schedule)) {
      return `S’exécutera toutes les ${schedule.everyMinutes} minutes quand ses restrictions de jour, d’heure et de fin le permettent; ${session}.${window}`;
    }
    const runsPerDay = Math.round(1440 / schedule.everyMinutes);
    const cadence = runsPerDay <= 1 ? "environ une fois par jour" : `environ ${runsPerDay} fois par jour`;
    return `S’exécutera ${cadence}; ${session}.${window}`;
  }
  const days = schedule.weekdays.length;
  const cadence = days === 7 ? "tous les jours" : days === 1 ? "un jour par semaine" : `${days} jours par semaine`;
  return `S’exécutera ${cadence}; ${session}.${window}`;
}

/** A stored routine's schedule as a request names it: a limit-reset time is the engine's, never part of the request. */
function asRequestSchedule(schedule: RoutineSchedule): RoutineRequestSchedule | undefined {
  if (schedule.type === "limit_reset") return { type: "limit_reset", engine: schedule.engine, repeat: schedule.repeat };
  if (schedule.type === "interval") {
    return {
      ...schedule,
      ...(schedule.weekdays ? { weekdays: [...schedule.weekdays] } : {}),
      ...(schedule.window ? { window: { ...schedule.window } } : {}),
    };
  }
  if (schedule.type === "daily") return { ...schedule, weekdays: [...schedule.weekdays] };
  return { ...schedule };
}

function effectiveDefinition(operation: RoutineRequestOperation, manager: RoutineManager): RoutineRequestDefinition | null {
  if (operation.action === "create") return operation.routine;
  const existing = manager.listRoutines().find((routine) => routine.id === operation.routineId);
  if (!existing) return null;
  const requestSchedule = asRequestSchedule(existing.schedule);
  if (!requestSchedule) return null;
  const base: RoutineRequestDefinition = {
    name: existing.name,
    instructions: existing.prompt,
    schedule: requestSchedule,
    runOn: existing.runOn,
    durationMinutes: existing.durationMinutes,
    ...(existing.timeoutMinutes === undefined ? {} : { timeoutMinutes: existing.timeoutMinutes }),
    ...(existing.continuity ? { continuity: true } : {}),
    ...(existing.overlap ? { overlap: existing.overlap } : {}),
    ...(existing.precheck?.kind === "watch" ? { watch: structuredClone(existing.precheck) } : {}),
    ...(existing.folder ? { folder: existing.folder } : {}),
    ...(existing.deleteWhenFinished ? { deleteWhenFinished: true } : {}),
    ...(existing.model ? { model: existing.model } : {}),
    ...(existing.subagentModel ? { subagentModel: existing.subagentModel } : {}),
    ...(existing.actAs !== undefined ? { actAs: existing.actAs } : {}),
    ...(existing.requires?.computer ? { requiresComputer: true } : {}),
    ...(existing.effort ? { effort: existing.effort } : {}),
    ...(existing.goal ? { goal: goalOf(existing.goal) } : {}),
    ...(existing.runOnStartup ? { runOnStartup: true } : {}),
  };
  if (operation.action !== "update") return base;
  const { schedule, timeoutMinutes, watch, folder, model, subagentModel, actAs, effort, goal, ...changes } = operation.changes;
  const merged: RoutineRequestDefinition = {
    ...base,
    ...changes,
    ...(schedule === undefined ? {} : { schedule: effectiveSchedule(base.schedule, schedule) }),
  };
  if (timeoutMinutes === null) delete merged.timeoutMinutes;
  else if (timeoutMinutes !== undefined) merged.timeoutMinutes = timeoutMinutes;
  if (watch === null) delete merged.watch;
  else if (watch !== undefined) merged.watch = watch;
  if (folder === null) delete merged.folder;
  else if (folder !== undefined) merged.folder = folder;
  if (model === null) delete merged.model;
  else if (model !== undefined) merged.model = model;
  if (subagentModel === null) delete merged.subagentModel;
  else if (subagentModel !== undefined) merged.subagentModel = subagentModel;
  if (actAs === null) delete merged.actAs;
  else if (actAs !== undefined) merged.actAs = actAs;
  if (effort === null) delete merged.effort;
  else if (effort !== undefined) merged.effort = effort;
  if (goal === null) delete merged.goal;
  else if (goal !== undefined) merged.goal = goal;
  // New instructions with their own `/goal` line say the goal themselves.
  else if (changes.instructions !== undefined && saysGoal(changes.instructions)) delete merged.goal;
  // Becoming a one-time routine drops it, as the routine itself does.
  if (merged.schedule.type === "once") delete merged.runOnStartup;
  return merged;
}

/** The card's line for a watch: what it reads and when the run starts. */
function watchLine(watch: RoutineWatchPrecheck | undefined, locale: CardLocale = "en"): string {
  if (locale === "fr") return frenchWatchLine(watch);
  if (!watch) return "Runs: on every due time";
  const source = watch.source.type === "files"
    ? `the files in ${watch.source.path.trim() || "the bot's folder"}${watch.source.recursive ? " and its subfolders" : ""}`
    : watch.source.type === "command"
      ? `the output of: ${redactSecretsInText(watch.source.command)}`
      : `the tool ${watch.source.tool}`;
  const when = watch.wakeOn === "match" && watch.condition
    ? `each time ${describeCondition(watch.condition)}`
    : watch.condition ? `when it changes and ${describeCondition(watch.condition)}` : "when it changes";
  return `Runs only ${when}: checks ${source}, no model until then${watch.firstRun === "wake" ? "; the first check runs once" : ""}${watch.whenAsleep === "wake" ? "; wakes an asleep computer to check" : ""}`;
}

/** watchLine in French; the condition and the command keep their own words (#2805). */
function frenchWatchLine(watch: RoutineWatchPrecheck | undefined): string {
  if (!watch) return "Exécution : à chaque échéance";
  const source = watch.source.type === "files"
    ? `les fichiers de ${watch.source.path.trim() || "le dossier du bot"}${watch.source.recursive ? " et ses sous-dossiers" : ""}`
    : watch.source.type === "command"
      ? `la sortie de : ${redactSecretsInText(watch.source.command)}`
      : `l’outil ${watch.source.tool}`;
  const when = watch.wakeOn === "match" && watch.condition
    ? `chaque fois que ${describeCondition(watch.condition)}`
    : watch.condition ? `quand ça change et que ${describeCondition(watch.condition)}` : "quand ça change";
  return `S’exécute seulement ${when} : vérifie ${source}, aucun modèle d’ici là${watch.firstRun === "wake" ? "; la première vérification roule une fois" : ""}${watch.whenAsleep === "wake" ? "; réveille un ordinateur en veille pour vérifier" : ""}`;
}

/** The line a create card carries when new routines start paused. */
export const CREATED_PAUSED_LINE = "Created paused; resume it when ready.";
const CREATED_PAUSED_LINE_FR = "Créée en pause; reprends-la quand tu seras prêt.";

const ACTION_DETAIL_FR: Record<RoutineRequestOperation["action"], string> = {
  create: "Créer la routine",
  update: "Modifier la routine",
  pause: "Mettre la routine en pause",
  resume: "Reprendre la routine",
  run_now: "Exécuter la routine maintenant",
  delete: "Supprimer la routine",
  rotate_webhook_key: "Renouveler la clé du déclencheur",
};

function cardCopy(
  operation: RoutineRequestOperation,
  manager: RoutineManager,
  timeZone: string,
  now: number,
  locale: CardLocale = "en",
): RoutineCardCopy {
  // The details panel is the person's to read: in their language (#2805).
  // The title and summary stay as before (the client words its own heading).
  const fr = locale === "fr";
  const definition = effectiveDefinition(operation, manager);
  const actionCopy = ACTION_COPY[operation.action];
  const actionLabel = actionCopy.title;
  const name = redactSecretsInText(definition?.name ?? "routine");
  const forBot = operation.forBot;
  const forSuffix = forBot ? ` for @${redactSecretsInText(forBot.name)}` : "";
  const title = `${actionLabel} “${name}”${forSuffix}?`;
  if (!definition) {
    return {
      title,
      summary: title,
      detail: fr ? `Action : ${ACTION_DETAIL_FR[operation.action]}\nNom : ${name}` : `Action: ${actionCopy.detail}\nName: ${name}`,
      nextRunAt: null,
      tool: "manage_routine",
    };
  }
  const createsPaused = operation.action === "create" && operation.paused === true;
  // A routine created paused has no pending run until its owner resumes it.
  const nextRunAt = createsPaused ? null : nextForOperation(operation, manager, now);
  const scheduleTimeZone = definition.schedule.type === "cron" ? definition.schedule.timeZone : timeZone;
  const when = operation.action === "run_now" ? "Now" : scheduleText(definition.schedule, timeZone);
  const destination = definition.runOn === "cloud" ? "Bot’s current model on its cloud computer" : "Bot’s current model and configured computer";
  const whenText = fr ? (operation.action === "run_now" ? "Maintenant" : scheduleText(definition.schedule, timeZone, locale)) : when;
  const destinationText = fr
    ? definition.runOn === "cloud" ? "Modèle actuel du bot sur son ordinateur infonuagique" : "Modèle actuel du bot et ordinateur configuré"
    : destination;
  const current = operation.action === "create"
    ? null
    : manager.listRoutines().find((routine) => routine.id === operation.routineId) ?? null;
  const remainsPaused = operation.action === "update" && current?.enabled === false;
  const deferredInterval = definition.schedule.type === "interval" && definition.schedule.anchorAt === undefined;
  const deferredRestrictedInterval = deferredInterval &&
    definition.schedule.type === "interval" &&
    intervalHasRestrictions(definition.schedule);
  const nextDescription = remainsPaused
    ? "None — this routine remains paused"
    : createsPaused
      ? "None — created paused; resume it when ready"
    : deferredInterval
      ? deferredRestrictedInterval
        ? `Next allowed time after confirmation (${plainTimeZone(timeZone)})`
        : "One interval after confirmation"
      : nextRunAt !== null
        ? formatInstant(nextRunAt, scheduleTimeZone)
        : operation.action === "pause"
          ? "None — this routine will be paused"
          : operation.action === "delete"
            ? "None — this routine will be deleted"
            : "None";
  const nextDescriptionFr = remainsPaused
    ? "Aucune : cette routine reste en pause"
    : createsPaused
      ? "Aucune : créée en pause; reprends-la quand tu seras prêt"
    : deferredInterval
      ? deferredRestrictedInterval
        ? `Prochain moment permis après la confirmation (${plainTimeZone(timeZone, locale)})`
        : "Un intervalle après la confirmation"
      : nextRunAt !== null
        ? formatInstant(nextRunAt, scheduleTimeZone, locale)
        : operation.action === "pause"
          ? "Aucune : cette routine sera mise en pause"
          : operation.action === "delete"
            ? "Aucune : cette routine sera supprimée"
            : "Aucune";
  const status = remainsPaused ? " · Remains paused" : createsPaused ? " · Created paused" : "";
  // Existing routines may predate nested-card redaction. The approval still
  // shows every instruction, but credential-shaped values never travel back
  // through the bot's MCP response or into the transcript.
  const goalOnCard = goalView(definition);
  const visibleInstructions = redactSecretsInText(goalOnCard.instructions);
  const runLimit = definition.timeoutMinutes === undefined
    ? "no run limit"
    : `${definition.timeoutMinutes} min limit`;
  return {
    title,
    summary: `${actionLabel} “${name}”${forSuffix} · ${when} · ${destination} · ${runLimit}${status}`,
    detail: fr ? [
      `Action : ${ACTION_DETAIL_FR[operation.action]}`,
      `Nom : ${name}`,
      ...(forBot ? [`Pour : @${redactSecretsInText(forBot.name)}, chaque exécution utilise le moteur et les permissions de ce bot`] : []),
      `Horaire : ${whenText}`,
      `Prochaine exécution : ${nextDescriptionFr}`,
      ...(definition.schedule.type === "cron" && nextRunAt !== null && operation.action !== "run_now" && !createsPaused
        ? [`3 prochaines exécutions (${plainTimeZone(scheduleTimeZone, locale)}) : ${nextCronRuns(definition.schedule, nextRunAt - 1, 3).map((at) => formatInstant(at, scheduleTimeZone, locale)).join(" · ")}`]
        : []),
      `S’exécute sur : ${destinationText}`,
      `Durée maximale : ${definition.timeoutMinutes === undefined ? "Aucune limite" : `${definition.timeoutMinutes} minutes`}`,
      `Continuité : ${definition.continuity ? "Transmet le rapport de l’exécution précédente à la suivante" : "Chaque exécution repart à neuf"}`,
      `Si occupé : ${definition.overlap === "queue" ? "Met une exécution prévue en file; saute les suivantes jusqu’à son départ" : "Saute les exécutions prévues qui se chevauchent"}`,
      ...(definition.watch ? [watchLine(definition.watch, locale)] : []),
      ...(definition.folder ? [`Dossier : ${redactSecretsInText(definition.folder)}`] : []),
      ...(definition.deleteWhenFinished ? ["Supprimer une fois terminée : oui"] : []),
      ...(definition.model ? [`Modèle : ${redactSecretsInText(definition.model)} (le moteur du bot; le clavardage garde le modèle du bot)`] : []),
      ...(definition.subagentModel ? [`Modèle des sous-agents : ${redactSecretsInText(definition.subagentModel)} (Claude Agent / travailleurs Flow; modèle principal inchangé)`] : []),
      ...(definition.actAs !== undefined ? [`Agit en tant que : ${definition.actAs ? redactSecretsInText(definition.actAs) : "l’accès de la personne"} (rôle Perspicax)`] : []),
      ...(definition.requiresComputer ? ["Besoin de son ordinateur : oui (la vérification avant l’exécution attend que l’ordinateur du bot soit en ligne)"] : []),
      ...(definition.effort ? [`Effort : ${definition.effort} (le clavardage garde l’effort du bot)`] : []),
      ...(goalOnCard.goal ? [`Objectif : ${redactSecretsInText(goalOnCard.goal.text)}${goalOnCard.goal.deadline ? ` (d’ici le ${new Date(goalOnCard.goal.deadline).toISOString()})` : ""}; le bot choisit quand vérifier et la routine s’arrête une fois l’objectif atteint`] : []),
      ...(definition.runOnStartup || (operation.action === "update" && operation.changes.runOnStartup !== undefined)
        ? [`Au démarrage : ${definition.runOnStartup ? "S’exécute aussi une fois à chaque démarrage de Sagax" : "S’exécute seulement selon son horaire"}`]
        : []),
      ...(operation.action === "create" || operation.action === "update"
        ? [consequenceLine(definition.schedule, Boolean(definition.continuity), locale)]
        : []),
      ...(createsPaused ? [CREATED_PAUSED_LINE_FR] : []),
      "",
      "Instructions :",
      visibleInstructions,
    ].join("\n") : [
      `Action: ${actionCopy.detail}`,
      `Name: ${name}`,
      ...(forBot ? [`For: @${redactSecretsInText(forBot.name)} — each run uses that bot's engine and permissions`] : []),
      `Schedule: ${when}`,
      `Next run: ${nextDescription}`,
      ...(definition.schedule.type === "cron" && nextRunAt !== null && operation.action !== "run_now" && !createsPaused
        ? [`Next 3 runs (${plainTimeZone(scheduleTimeZone)}): ${nextCronRuns(definition.schedule, nextRunAt - 1, 3).map((at) => formatInstant(at, scheduleTimeZone)).join(" · ")}`]
        : []),
      `Runs on: ${destination}`,
      `Run limit: ${definition.timeoutMinutes === undefined ? "No limit" : `${definition.timeoutMinutes} minutes`}`,
      `Continuity: ${definition.continuity ? "Carries the previous run's report into the next run" : "Each run starts fresh"}`,
      `While busy: ${definition.overlap === "queue" ? "Queue one scheduled run; skip further occurrences until it starts" : "Skip overlapping scheduled occurrences"}`,
      ...(definition.watch ? [watchLine(definition.watch)] : []),
      ...(definition.folder ? [`Folder: ${redactSecretsInText(definition.folder)}`] : []),
      ...(definition.deleteWhenFinished ? ["Delete once finished: yes"] : []),
      ...(definition.model ? [`Model: ${redactSecretsInText(definition.model)} (the bot's engine; chat keeps the bot's model)`] : []),
      ...(definition.subagentModel ? [`Sub-agent model: ${redactSecretsInText(definition.subagentModel)} (Claude Agent / Flow workers; main model unchanged)`] : []),
      ...(definition.actAs !== undefined ? [`Acts as: ${definition.actAs ? redactSecretsInText(definition.actAs) : "the person's own access"} (Perspicax role)`] : []),
      ...(definition.requiresComputer ? ["Needs its computer: yes (the pre-run check waits for the bot's computer to be online)"] : []),
      ...(definition.effort ? [`Effort: ${definition.effort} (chat keeps the bot's effort)`] : []),
      ...(goalOnCard.goal ? [`Goal: ${redactSecretsInText(goalOnCard.goal.text)}${goalOnCard.goal.deadline ? ` (by ${new Date(goalOnCard.goal.deadline).toISOString()})` : ""}; the bot picks when to check and the routine stops once it is reached`] : []),
      ...(definition.runOnStartup || (operation.action === "update" && operation.changes.runOnStartup !== undefined)
        ? [`On startup: ${definition.runOnStartup ? "Also runs once each time Sagax starts" : "Runs only on its schedule"}`]
        : []),
      // Last before the instructions: the one sentence that says what
      // confirming actually does, in the reader's terms.
      ...(operation.action === "create" || operation.action === "update"
        ? [consequenceLine(definition.schedule, Boolean(definition.continuity))]
        : []),
      ...(createsPaused ? [CREATED_PAUSED_LINE] : []),
      "",
      "Instructions:",
      visibleInstructions,
    ].join("\n"),
    nextRunAt,
    tool: operation.action === "create" ? "schedule_routine" : "manage_routine",
  };
}

function inputFromDefinition(definition: RoutineRequestDefinition, botId: string, now: number, paused: boolean): RoutineInput {
  return {
    name: definition.name,
    prompt: definition.instructions,
    botId,
    runOn: definition.runOn,
    // Paused: no pending run until the owner resumes it (propose_routine_action).
    enabled: !paused,
    schedule: asSchedule(definition.schedule, now),
    durationMinutes: definition.durationMinutes,
    ...(definition.timeoutMinutes === undefined ? {} : { timeoutMinutes: definition.timeoutMinutes }),
    ...(definition.continuity ? { continuity: true } : {}),
    ...(definition.overlap === "queue" ? { overlap: "queue" as const } : {}),
    ...(definition.watch ? { precheck: structuredClone(definition.watch) } : {}),
    ...(definition.folder ? { folder: definition.folder } : {}),
    ...(definition.deleteWhenFinished ? { deleteWhenFinished: true } : {}),
    ...(definition.model ? { model: definition.model } : {}),
    ...(definition.subagentModel ? { subagentModel: definition.subagentModel } : {}),
    ...(definition.actAs !== undefined ? { actAs: definition.actAs } : {}),
    ...(definition.requiresComputer ? { requires: { computer: true } } : {}),
    ...(definition.effort ? { effort: definition.effort } : {}),
    ...(definition.goal ? { goal: { ...definition.goal } } : {}),
    ...(definition.runOnStartup ? { runOnStartup: true } : {}),
  };
}

function updateFromChanges(
  changes: RoutineRequestChanges,
  now: number,
  currentSchedule: RoutineSchedule,
  currentRequires?: RoutineRequirements,
  currentGoal?: RoutineGoal,
): Partial<RoutineInput> {
  const patch: Partial<RoutineInput> = {};
  if (changes.name !== undefined) patch.name = changes.name;
  if (changes.instructions !== undefined) patch.prompt = changes.instructions;
  if (changes.schedule !== undefined) patch.schedule = schedulePatch(changes.schedule, now, currentSchedule);
  if (changes.runOn !== undefined) patch.runOn = changes.runOn;
  if (changes.durationMinutes !== undefined) patch.durationMinutes = changes.durationMinutes;
  if (changes.timeoutMinutes !== undefined) patch.timeoutMinutes = changes.timeoutMinutes;
  if (changes.continuity !== undefined) patch.continuity = changes.continuity;
  if (changes.overlap !== undefined) patch.overlap = changes.overlap;
  if (changes.watch !== undefined) patch.precheck = changes.watch === null ? null : structuredClone(changes.watch);
  if (changes.folder !== undefined) patch.folder = changes.folder;
  if (changes.deleteWhenFinished !== undefined) patch.deleteWhenFinished = changes.deleteWhenFinished;
  if (changes.model !== undefined) patch.model = changes.model;
  if (changes.subagentModel !== undefined) patch.subagentModel = changes.subagentModel;
  if (changes.actAs !== undefined) patch.actAs = changes.actAs;
  if (changes.requiresComputer !== undefined) patch.requires = withRequiredComputer(currentRequires, changes.requiresComputer);
  if (changes.effort !== undefined) patch.effort = changes.effort;
  if (changes.goal !== undefined) patch.goal = changes.goal;
  // #4098: new instructions without a `/goal` line keep the goal (the card
  // said it kept); a line in them is the goal.
  else if (changes.instructions !== undefined && currentGoal && !saysGoal(changes.instructions)) patch.goal = goalOf(currentGoal);
  if (changes.runOnStartup !== undefined) patch.runOnStartup = changes.runOnStartup;
  return patch;
}

function canonicalValue(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(canonicalValue);
  const parsedObject = jsonObjectSchema.safeParse(value);
  if (!parsedObject.success) return value;
  const sorted: JsonObject = {};
  for (const key of Object.keys(parsedObject.data).sort()) {
    const child = parsedObject.data[key];
    if (child !== undefined) sorted[key] = canonicalValue(child);
  }
  return sorted;
}

/** Bind exact-once recovery to the immutable card owner as well as its
 * operation. Recursive key sorting keeps old receipts valid if a future
 * schema refactor changes object construction order. */
export function routineRequestFingerprint(
  payload: Pick<RoutineRequestCardData, "version" | "requestId" | "botId" | "threadId" | "operation">,
  messageId: string,
): string {
  const document = parseJson(JSON.stringify({
    fingerprintVersion: ROUTINE_REQUEST_FINGERPRINT_VERSION,
    cardVersion: payload.version,
    requestId: payload.requestId,
    messageId,
    botId: payload.botId,
    threadId: payload.threadId,
    operation: payload.operation,
  }));
  return createHash("sha256").update(JSON.stringify(canonicalValue(document))).digest("hex");
}

function verifyManageSnapshot(
  operation: Exclude<RoutineRequestOperation, { action: "create" }>,
  manager: RoutineManager,
  botId: string,
): Routine {
  const current = ownedRoutine(manager, operation.routineId, botId);
  if (!current) throw new RoutineRequestError("That routine no longer exists", 404, { terminal: true });
  if (current.updatedAt !== operation.expectedUpdatedAt) {
    throw new RoutineRequestError(
      "That routine changed after this confirmation card was prepared. Ask the bot to review it and propose the action again.",
      409,
      { terminal: true },
    );
  }
  return current;
}

function requestCommit(payload: RoutineRequestCardData, messageId: string): RoutineRequestCommit {
  return {
    requestId: payload.requestId,
    messageId,
    botId: payload.botId,
    threadId: payload.threadId,
    action: payload.operation.action,
    fingerprintVersion: ROUTINE_REQUEST_FINGERPRINT_VERSION,
    fingerprint: routineRequestFingerprint(payload, messageId),
  };
}

function revalidateOperation(operation: RoutineRequestOperation, manager: RoutineManager, botId: string, now: number): void {
  if (operation.action === "create") {
    const definition = operation.routine;
    // A create that starts paused counts a paused copy as a duplicate too
    // (otherwise every retried proposal would add another).
    const includePaused = operation.paused === true;
    const owner = operation.forBot?.botId ?? botId;
    const schedule = asSchedule(definition.schedule, now);
    const asked = goalView(definition);
    const duplicate = manager.listRoutines().find((routine) => {
      if ((!routine.enabled && !includePaused) || routine.target !== "bot" || routine.botId !== owner
        || routine.runOn !== definition.runOn || readRoutineGoalLines(routine.prompt).instructions !== asked.instructions
        || routine.durationMinutes !== definition.durationMinutes
        || routine.timeoutMinutes !== definition.timeoutMinutes
        || Boolean(routine.continuity) !== Boolean(definition.continuity)
        || (routine.overlap ?? "skip") !== (definition.overlap ?? "skip")
        || Boolean(routine.deleteWhenFinished) !== Boolean(definition.deleteWhenFinished)
        || (routine.model ?? "") !== (definition.model ?? "")
        || (routine.subagentModel ?? "") !== (definition.subagentModel ?? "")
        || routine.actAs !== definition.actAs
        || Boolean(routine.requires?.computer) !== Boolean(definition.requiresComputer)
        || routine.effort !== definition.effort
        || !isDeepStrictEqual(routine.goal ? goalOf(routine.goal) : undefined, asked.goal)
        || !isDeepStrictEqual(routine.precheck?.kind === "watch" ? routine.precheck : undefined, definition.watch)
        || Boolean(routine.runOnStartup) !== Boolean(definition.runOnStartup)
        || (routine.attachments?.length ?? 0) > 0) return false;
      // An omitted start means "every N minutes", not a new phase each time
      // the model retries. Explicit starts and all other constraints stay exact.
      const candidate = schedule.type === "interval" && routine.schedule.type === "interval"
        && definition.schedule.type === "interval" && definition.schedule.anchorAt === undefined
        ? { ...schedule, anchorAt: routine.schedule.anchorAt }
        : schedule;
      return isDeepStrictEqual(candidate, routine.schedule);
    });
    if (duplicate) {
      // The tool cannot choose a result destination. Return the existing ID,
      // without moving its reports or treating a renamed request as new work.
      throw new RoutineRequestError(
        `${duplicate.enabled ? "An enabled" : "A paused"} routine with the same instructions and execution settings already exists (${duplicate.id}). Use list_routines to review it, then update or run that routine instead.`,
        409,
        { terminal: true },
      );
    }
  }
  const current = operation.action === "create"
    ? null
    : verifyManageSnapshot(operation, manager, operation.forBot?.botId ?? botId);
  const schedule = operation.action === "create"
    ? operation.routine.schedule
    : operation.action === "update"
      ? operation.changes.schedule
      : undefined;
  if (schedule?.type === "cron") {
    try {
      normalizeCronSchedule(schedule, now);
    } catch (error) {
      throw new RoutineRequestError(error instanceof Error ? error.message : "Invalid cron schedule", 409);
    }
  }
  const startsWithApp = operation.action === "create"
    ? operation.routine.runOnStartup === true
    : operation.action === "update" && operation.changes.runOnStartup === true;
  if (startsWithApp && (schedule ?? current?.schedule)?.type === "once") {
    throw new RoutineRequestError("Only a repeating routine can also run when Sagax starts. A one-time routine just runs at its time.");
  }
  if (schedule?.type === "once" && schedule.at <= now) {
    throw new RoutineRequestError("That one-time schedule is now in the past. Ask the bot to propose a new time.", 409, { terminal: true });
  }
  if (schedule?.type === "interval") {
    const currentRequest = current ? asRequestSchedule(current.schedule) : null;
    const base = operation.action === "create"
      ? operation.routine.schedule
      : currentRequest
        ? effectiveSchedule(currentRequest, schedule)
        : null;
    const concrete = base ? asSchedule(base, now) : null;
    if (concrete) {
      const valid = storedScheduleSchema.safeParse(concrete);
      if (!valid.success) {
        throw new RoutineRequestError(schemaIssue(valid.error, "Invalid interval schedule"));
      }
    }
    if (concrete && nextOccurrence(concrete, now) === null) {
      throw new RoutineRequestError(
        "That interval no longer has a future run. Choose a later end time or remove the end restriction.",
        409,
      );
    }
  }
  if (operation.action === "resume") {
    if (!current) throw new RoutineRequestError("That routine no longer exists", 404);
    if (!isTriggerSchedule(current.schedule) && nextOccurrence(current.schedule, now) === null) {
      throw new RoutineRequestError(noFutureResumeMessage(current.schedule), 409);
    }
  }
  if (operation.action === "rotate_webhook_key") {
    if (!current || !isTriggerSchedule(current.schedule)) {
      throw new RoutineRequestError("That routine has no webhook or email trigger", 409);
    }
  }
}

/** The routine as it stands, kept for Undo. None when it carries what a
 * card cannot hold exactly: attachments, or credential-shaped text the
 * transcript scrubs. */
function routineSnapshot(routine: Routine): RoutineRequestSnapshot | undefined {
  if (routine.attachments?.length) return undefined;
  if (redactSecretsInText(routine.name) !== routine.name || redactSecretsInText(routine.prompt) !== routine.prompt) return undefined;
  const schedule = asRequestSchedule(routine.schedule);
  if (!schedule) return undefined;
  const snapshot: RoutineRequestSnapshot = {
    name: routine.name,
    instructions: routine.prompt,
    schedule: structuredClone(schedule),
    runOn: routine.runOn,
    durationMinutes: routine.durationMinutes,
    ...(routine.timeoutMinutes === undefined ? {} : { timeoutMinutes: routine.timeoutMinutes }),
    ...(routine.continuity ? { continuity: true } : {}),
    ...(routine.overlap === "queue" ? { overlap: "queue" as const } : {}),
    ...(routine.precheck ? { precheck: structuredClone(routine.precheck) } : {}),
    ...(routine.folder ? { folder: routine.folder } : {}),
    ...(routine.model ? { model: routine.model } : {}),
    ...(routine.subagentModel ? { subagentModel: routine.subagentModel } : {}),
    ...(routine.actAs !== undefined ? { actAs: routine.actAs } : {}),
    ...(routine.requires?.computer ? { requiresComputer: true } : {}),
    ...(routine.effort ? { effort: routine.effort } : {}),
    ...(routine.goal ? { goal: goalOf(routine.goal) } : {}),
    ...(routine.runOnStartup ? { runOnStartup: true } : {}),
    enabled: routine.enabled,
    ...(routine.target === "room-goal" ? { target: "room-goal" as const } : {}),
    ...(routine.groupId ? { groupId: routine.groupId } : {}),
    ...(routine.resultsThreadId ? { resultsThreadId: routine.resultsThreadId } : {}),
  };
  return storedSnapshotSchema.safeParse(snapshot).success ? snapshot : undefined;
}

/** Puts an updated routine's definition back exactly: an interval's
 * restrictions are cleared explicitly, since an omitted one is kept. */
function restorePatch(before: RoutineRequestSnapshot, now: number, currentRequires?: RoutineRequirements): Partial<RoutineInput> {
  const schedule = asSchedule(before.schedule, now);
  return {
    name: before.name,
    prompt: before.instructions,
    runOn: before.runOn,
    schedule: schedule.type === "interval"
      ? { ...schedule, weekdays: schedule.weekdays ?? null, window: schedule.window ?? null, endsAt: schedule.endsAt ?? null }
      : schedule,
    durationMinutes: before.durationMinutes,
    timeoutMinutes: before.timeoutMinutes ?? null,
    continuity: before.continuity === true,
    overlap: before.overlap ?? "skip",
    precheck: before.precheck === undefined ? null : structuredClone(before.precheck) as RoutineInput["precheck"],
    folder: before.folder ?? null,
    model: before.model ?? null,
    subagentModel: before.subagentModel ?? null,
    actAs: before.actAs ?? null,
    requires: withRequiredComputer(currentRequires, before.requiresComputer === true),
    effort: before.effort ?? null,
    goal: before.goal ? { ...before.goal } : null,
    runOnStartup: before.runOnStartup === true,
  };
}

export class RoutineRequestService {
  private readonly store: RoutineRequestStore;
  private readonly routines: RoutineManager;
  private readonly now: () => number;
  private readonly timeZone: () => string;
  private readonly language?: RoutineRequestServiceOptions["language"];
  private readonly cloudReady?: (botId: string) => Promise<{ ready: boolean; reason?: string }>;
  private readonly canPersist?: RoutineRequestServiceOptions["canPersist"];
  private readonly validateTarget?: RoutineRequestServiceOptions["validateTarget"];
  private readonly autoApply?: RoutineRequestServiceOptions["autoApply"];
  private readonly newPaused: () => boolean;
  private readonly bindTrigger?: RoutineRequestServiceOptions["bindTrigger"];
  private readonly rotateTrigger?: RoutineRequestServiceOptions["rotateTrigger"];
  private readonly onAudit?: RoutineRequestServiceOptions["onAudit"];

  constructor(options: RoutineRequestServiceOptions) {
    this.store = options.store;
    this.routines = options.routines;
    this.now = options.now ?? Date.now;
    this.timeZone = options.timeZone ?? (() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
    this.language = options.language;
    this.cloudReady = options.cloudReady;
    this.canPersist = options.canPersist;
    this.validateTarget = options.validateTarget;
    this.autoApply = options.autoApply;
    // Same default as config.ts DEFAULT_NEW_ROUTINES_PAUSED.
    this.newPaused = options.newPaused ?? (() => false);
    this.bindTrigger = options.bindTrigger;
    this.rotateTrigger = options.rotateTrigger;
    this.onAudit = options.onAudit;
  }

  async propose(args: ProposeRoutineRequestArgs): Promise<RoutineProposalResult> {
    return this.prepare(args);
  }

  async submit(args: ProposeRoutineRequestArgs) {
    const proposal = await this.prepare(args, true);
    return { ...proposal, state: proposal.result ? "applied" as const : "pending" as const };
  }

  private async prepare(args: ProposeRoutineRequestArgs, submitted = false): Promise<RoutineProposalResult & {
    result?: Extract<ResolveRoutineRequestResult, { state: "applied" }>;
    /** Why it applied without a person. */
    appliedBy?: DirectApply;
  }> {
    const botId = text(args.botId, "botId", 128);
    const threadId = text(args.threadId, "threadId", 128);
    const at = this.now();
    const parsedProposal = routineProposalSchema.safeParse(args.proposal);
    if (!parsedProposal.success) {
      throw new RoutineRequestError(schemaIssue(parsedProposal.error, "Invalid routine proposal"));
    }
    const operation = normalizedOperation(this.routines, botId, parsedProposal.data, at, this.newPaused());
    if (operation.forBot && this.validateTarget) {
      const refusal = this.validateTarget(botId, operation.forBot);
      if (refusal) throw new RoutineRequestError(refusal, 403);
    }
    await this.requireCloudReadiness(operation, botId);
    // The readiness probe is asynchronous. Another request can edit or
    // delete the routine while it is in flight, so re-check the captured
    // revision before rendering and persisting the confirmation snapshot.
    const cardAt = this.now();
    revalidateOperation(operation, this.routines, botId, cardAt);
    const requestId = newId();
    const payload: RoutineRequestCardData = {
      version: 1,
      requestId,
      botId,
      threadId,
      createdAt: cardAt,
      operation,
    };
    const definition = effectiveDefinition(operation, this.routines);
    const timeZone = definition?.schedule.type === "cron" ? definition.schedule.timeZone : this.timeZone();
    const copy = cardCopy(operation, this.routines, timeZone, cardAt, cardLocale(this.language?.(botId, threadId)));
    // applied without a card at Full (index.ts fullAccessForSource); full-access: proposal
    const messageInput: Parameters<RoutineRequestStore["appendMessage"]>[1] = {
      role: "bot",
      kind: "options",
      card: {
        title: copy.title,
        subtitle: copy.detail,
        options: ["Confirm", "Cancel"],
        requestId,
        tool: copy.tool,
        routineRequest: payload,
      },
    };
    if (args.from) messageInput.from = args.from;
    // Resolve the current source-thread grant after the asynchronous probe.
    const owner = operation.forBot?.botId ?? botId;
    const grant = submitted ? grantAfterQuote(args.quoteRefused ? (this.autoApply?.(botId, threadId, owner) ?? null) : (args.primaryAsked ? "primary-bot" as const : this.autoApply?.(botId, threadId, owner) ?? null), args.quoteRefused) : null;
    // A bot applying its own routines keeps at most SELF_ROUTINE_CAP of them
    // on; a create or resume past that shows the card, as before. Full
    // access has no cap.
    const automatic = !args.explicitConfirm && (grant === "full-access" || grant === "primary-bot" || (grant === "self" && !this.overSelfCap(operation, owner)));
    // This check and append are deliberately adjacent and synchronous. JS
    // cannot interleave another completed proposal between the capacity /
    // ownership decision and the durable transcript write.
    const persistence = this.canPersist?.(botId, threadId, !automatic);
    if (persistence && !persistence.ok) {
      throw new RoutineRequestError(persistence.error, persistence.status);
    }
    if (args.canCommit && !args.canCommit()) {
      throw new RoutineRequestError("The requesting turn ended before this proposal could be saved", 401);
    }
    // What Undo puts back, taken before the change.
    const before = automatic && (operation.action === "update" || operation.action === "delete")
      ? this.snapshotOf(operation.routineId, owner)
      : undefined;
    if (automatic) {
      messageInput.card.options = [];
      messageInput.card.dismissed = true;
    }
    const message = this.store.appendMessage(threadId, messageInput);
    const proposal = {
      requestId,
      messageId: message.id,
      title: copy.title,
      summary: copy.summary,
      detail: copy.detail,
      nextRunAt: copy.nextRunAt,
      timeZone,
    };
    if (!automatic) return proposal;
    // Persist a hidden receipt first, then use the existing validated,
    // idempotent commit path without exposing a pending confirmation.
    let result: ResolveRoutineRequestResult;
    try {
      result = this.resolve({ botId, threadId, requestId, behavior: "allow" });
    } catch (error) {
      result = { claimed: true, state: "invalid", error: error instanceof Error ? error.message : String(error), status: error instanceof RoutineRequestError ? error.status : 400 };
    }
    if (result.state === "applied") {
      this.recordAutoApplied(threadId, message.id, definition, before);
      return { ...proposal, result, ...(grant ? { appliedBy: grant } : {}) };
    }
    // The scheduler commit can succeed even if settling its transcript
    // fails. Report that exact result; a retry only finishes the receipt.
    const receipt = this.routines.routineRequestReceipt(requestId);
    if (receipt && receipt.botId === botId && receipt.threadId === threadId && receipt.messageId === message.id &&
      receipt.fingerprintVersion === ROUTINE_REQUEST_FINGERPRINT_VERSION && receipt.fingerprint === routineRequestFingerprint(payload, message.id)) {
      return { ...proposal, result: {
        claimed: true, state: "applied", action: receipt.action, resultId: receipt.resultId,
        settlementPending: true, message: "Routine change applied. Recording the operation receipt could not finish; the change will not be applied again.",
      }, ...(grant ? { appliedBy: grant } : {}) };
    }
    throw new RoutineRequestError(result.state === "invalid" ? result.error : "The routine change could not be applied", result.state === "invalid" ? result.status : 409);
  }

  /** Whether one more enabled routine would take the bot past the cap. */
  private overSelfCap(operation: RoutineRequestOperation, owner: string): boolean {
    if (operation.action !== "create" && operation.action !== "resume") return false;
    // A create that starts paused adds no enabled routine.
    if (operation.action === "create" && operation.paused === true) return false;
    const enabled = this.routines.listRoutines().filter((routine) => routine.botId === owner && routine.enabled).length;
    return enabled + 1 > SELF_ROUTINE_CAP;
  }

  private snapshotOf(routineId: string, owner: string): RoutineRequestSnapshot | undefined {
    const routine = ownedRoutine(this.routines, routineId, owner);
    return routine ? routineSnapshot(routine) : undefined;
  }

  /** Marks a card whose change applied without a person, with what its
   * one-line receipt and Undo need. A failure here leaves the change
   * applied and the card as it was, only without Undo. */
  private recordAutoApplied(
    threadId: string,
    messageId: string,
    definition: RoutineRequestDefinition | null,
    before: RoutineRequestSnapshot | undefined,
  ): void {
    try {
      const message = this.store.messagesFor(threadId).find((candidate) => candidate.id === messageId);
      const card = message?.card;
      const payload = card?.routineRequest;
      if (!message || !card || !payload) return;
      const action = payload.operation.action;
      const routineId = payload.operation.action === "create" ? payload.resultId : payload.operation.routineId;
      const after = routineId ? this.routines.listRoutines().find((routine) => routine.id === routineId) : undefined;
      const undoSchedule = after ? asRequestSchedule(after.schedule) : definition?.schedule;
      const undo: RoutineRequestUndo = {
        name: redactSecretsInText(after?.name ?? definition?.name ?? before?.name ?? "routine"),
        ...(action === "create" || action === "update" || action === "resume"
          ? { schedule: undoSchedule ? structuredClone(undoSchedule) : undefined }
          : {}),
        ...(after && (action === "update" || action === "pause" || action === "resume") ? { appliedUpdatedAt: after.updatedAt } : {}),
        ...(before ? { before } : {}),
      };
      if (!storedUndoSchema.safeParse(undo).success) delete undo.schedule;
      this.store.patchMessage(threadId, messageId, {
        card: { ...card, autoApplied: true, routineRequest: { ...payload, undo } },
      });
    } catch {
      // The routine change itself is durable; only its Undo is lost.
    }
  }

  /** Puts back a change that applied without a person. Authorized by the
   * caller exactly like answering the card; refuses, applying nothing, once
   * the routine changed since. A second Undo reports already undone. */
  undo(args: { botId: string; threadId: string; requestId: string }): UndoRoutineRequestResult {
    const message = this.store
      .messagesFor(args.threadId)
      .find((candidate) => candidate.card?.requestId === args.requestId && candidate.card.routineRequest);
    const card = message?.card;
    if (!message || !card) return { claimed: false };
    if (card.undone) return { claimed: true, state: "already_undone" };
    const cannot = (error: string, status = 409): UndoRoutineRequestResult => ({ claimed: true, state: "invalid", error, status });
    if (!card.autoApplied || card.answered !== "allow") return cannot("Only a change that applied on its own can be undone here.");
    const parsed = routineRequestCardDataSchema.safeParse(card.routineRequest);
    if (!parsed.success) return cannot("This change can't be undone here.");
    const payload: RoutineRequestCardData = parsed.data;
    if (payload.botId !== args.botId || payload.threadId !== args.threadId) {
      return cannot("This routine change belongs to another conversation", 403);
    }
    const operation = payload.operation;
    const owner = operation.forBot?.botId ?? payload.botId;
    const undo = payload.undo;
    const stale: UndoRoutineRequestResult = { claimed: true, state: "invalid", error: UNDO_STALE, status: 409, stale: true };
    const now = this.now();
    let routineId: string;
    let restoredId: string | undefined;
    try {
      switch (operation.action) {
        case "run_now":
          return cannot("A routine run can't be undone.");
        case "create": {
          routineId = payload.resultId ?? "";
          if (!routineId || !ownedRoutine(this.routines, routineId, owner)) return stale;
          this.routines.remove(routineId);
          break;
        }
        case "update":
        case "pause":
        case "resume": {
          routineId = operation.routineId;
          if (undo?.appliedUpdatedAt === undefined || (operation.action === "update" && !undo.before)) {
            return cannot("This change can't be undone here.");
          }
          const current = ownedRoutine(this.routines, routineId, owner);
          if (!current || current.updatedAt !== undo.appliedUpdatedAt) return stale;
          const patch = operation.action === "update"
            ? restorePatch(undo.before!, now, current.requires)
            : { enabled: operation.action === "pause" };
          // The Undo is said in this conversation: its line says so too.
          if (!this.routines.update(routineId, patch, undefined, { conversation: { threadId: args.threadId, messageId: message.id } })) return stale;
          break;
        }
        case "delete": {
          routineId = operation.routineId;
          const before = undo?.before;
          if (!before) return cannot("This change can't be undone here.");
          restoredId = this.routines.create({
            name: before.name,
            prompt: before.instructions,
            botId: owner,
            ...(before.target ? { target: before.target, groupId: before.groupId } : {}),
            runOn: before.runOn,
            enabled: before.enabled,
            schedule: asSchedule(before.schedule, now),
            durationMinutes: before.durationMinutes,
            ...(before.timeoutMinutes === undefined ? {} : { timeoutMinutes: before.timeoutMinutes }),
            ...(before.continuity ? { continuity: true } : {}),
            ...(before.overlap === "queue" ? { overlap: "queue" as const } : {}),
            ...(before.precheck !== undefined ? { precheck: structuredClone(before.precheck) as RoutineInput["precheck"] } : {}),
            ...(before.runOnStartup ? { runOnStartup: true } : {}),
            ...(before.resultsThreadId ? { resultsThreadId: before.resultsThreadId } : {}),
            ...(before.folder ? { folder: before.folder } : {}),
            ...(before.requiresComputer ? { requires: { computer: true } } : {}),
            ...(before.model ? { model: before.model } : {}),
            ...(before.effort ? { effort: before.effort } : {}),
            ...(before.goal ? { goal: { ...before.goal } } : {}),
          }).id;
          break;
        }
        case "rotate_webhook_key":
          return cannot("A rotated trigger key can't be undone.");
        default: {
          const unexpected: never = operation;
          void unexpected;
          return cannot("This change can't be undone here.");
        }
      }
    } catch (error) {
      return cannot(redactSecretsInText(error instanceof Error ? error.message : String(error)).slice(0, 500));
    }
    this.store.patchMessage(args.threadId, message.id, { card: { ...card, undone: true } });
    return {
      claimed: true,
      state: "undone",
      action: operation.action,
      routineId,
      ...(restoredId ? { restoredId } : {}),
      ...(undo?.ownersBefore !== undefined ? { ownersBefore: undo.ownersBefore } : {}),
    };
  }

  private async requireCloudReadiness(operation: RoutineRequestOperation, proposerBotId: string): Promise<void> {
    if (!this.cloudReady || operation.action === "pause" || operation.action === "delete") return;
    const definition = effectiveDefinition(operation, this.routines);
    if (definition?.runOn !== "cloud") return;
    let readiness: { ready: boolean; reason?: string };
    try {
      const targetBotId = operation.action === "create"
        ? operation.forBot?.botId ?? proposerBotId
        : this.routines.listRoutines().find(routine => routine.id === operation.routineId)?.botId ?? proposerBotId;
      readiness = await this.cloudReady(targetBotId);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new RoutineRequestError(`Could not verify cloud readiness: ${detail}`, 503);
    }
    if (readiness.ready) return;
    throw new RoutineRequestError(
      readiness.reason?.trim() || "Cloud execution is not configured yet. Set up a cloud computer first.",
      409,
    );
  }

  /**
   * Claims a routine card even after it was settled. That distinction is
   * important: duplicate clicks must never fall through to a provider that
   * did not create the request id.
   */
  resolve(args: {
    botId: string;
    threadId: string;
    requestId: string;
    behavior: string | undefined;
    /** Slice 6: the principal who answered the card (runAs of what it writes). */
    actorPrincipalId?: string;
  }): ResolveRoutineRequestResult {
    const message = this.store
      .messagesFor(args.threadId)
      .find((candidate) => candidate.card?.requestId === args.requestId && candidate.card.routineRequest);
    const card = message?.card;
    const rawPayload = card?.routineRequest;
    if (!message || !card || !rawPayload) return { claimed: false, state: "not_found" };
    if (args.behavior !== "allow" && args.behavior !== "deny") {
      return {
        claimed: true,
        state: "invalid",
        error: "Routine confirmations must be confirmed or cancelled",
        status: 400,
      };
    }
    const parsedPayload = routineRequestCardDataSchema.safeParse(rawPayload);
    if (!parsedPayload.success) {
      if (card.answered) return { claimed: true, state: "already_settled", behavior: card.answered };
      const recovered = this.settleCommittedReceipt(args, message.id, card);
      if (recovered) return recovered;
      // Cancelling is always safe and must remain possible even if an older
      // persisted payload no longer passes today's schema. Otherwise that
      // durable card would own the composer forever with no escape hatch.
      if (args.behavior === "deny") {
        this.store.patchMessage(args.threadId, message.id, { card: { ...card, answered: "deny", held: undefined } });
        return { claimed: true, state: "denied" };
      }
      const detail = schemaIssue(parsedPayload.error, "This routine request is invalid");
      this.store.patchMessage(args.threadId, message.id, {
        card: { ...card, held: redactSecretsInText(detail).slice(0, 500) },
      });
      return { claimed: true, state: "invalid", error: detail, status: 400 };
    }
    const payload: RoutineRequestCardData = parsedPayload.data;
    if (payload.requestId !== args.requestId) {
      const recovered = this.settleCommittedReceipt(args, message.id, card);
      if (recovered) return recovered;
      if (args.behavior === "deny") {
        this.store.patchMessage(args.threadId, message.id, { card: { ...card, answered: "deny", held: undefined } });
        return { claimed: true, state: "denied" };
      }
      return { claimed: true, state: "invalid", error: "This routine request id does not match its confirmation card", status: 400 };
    }
    if (payload.botId !== args.botId || payload.threadId !== args.threadId) {
      const recovered = this.settleCommittedReceipt(args, message.id, card);
      if (recovered) return recovered;
      if (args.behavior === "deny") {
        this.store.patchMessage(args.threadId, message.id, { card: { ...card, answered: "deny", held: undefined } });
        return { claimed: true, state: "denied" };
      }
      return { claimed: true, state: "invalid", error: "This routine request belongs to another conversation", status: 403 };
    }
    if (card.answered) {
      this.forgetSettledReceipt(payload, message.id);
      return { claimed: true, state: "already_settled", behavior: card.answered };
    }

    try {
      const fingerprint = routineRequestFingerprint(payload, message.id);
      const receipt = this.routines.routineRequestReceipt(payload.requestId);
      if (receipt) {
        if (
          receipt.botId !== payload.botId ||
          receipt.threadId !== payload.threadId ||
          receipt.messageId !== message.id ||
          receipt.action !== payload.operation.action ||
          receipt.fingerprintVersion !== ROUTINE_REQUEST_FINGERPRINT_VERSION ||
          receipt.fingerprint !== fingerprint
        ) {
          throw new RoutineRequestError("This routine request does not match its durable commit receipt", 409);
        }
        return this.settleApplied(
          args.threadId,
          message.id,
          card,
          payload,
          receipt.resultId,
          receipt.appliedAt,
        );
      }
      // An expired card is settled terminal state, not a decision waiting on
      // a slower click: the proposal it carried can never be confirmed as
      // prepared, even when the routine moves back under it. The committed
      // receipt above still recovers a write that already happened; nothing
      // past this point can.
      if (card.expired) {
        return {
          claimed: true,
          state: "invalid",
          error: "This routine request expired before it was confirmed. Ask for a fresh proposal.",
          status: 409,
        };
      }
      if (args.behavior === "deny") {
        this.store.patchMessage(args.threadId, message.id, { card: { ...card, answered: "deny", held: undefined } });
        return { claimed: true, state: "denied" };
      }
      revalidateOperation(payload.operation, this.routines, payload.botId, this.now());
      if (payload.operation.forBot && this.validateTarget) {
        const refusal = this.validateTarget(payload.botId, payload.operation.forBot);
        if (refusal) throw new RoutineRequestError(refusal, 404, { terminal: true });
      }
      const resultId = this.apply(payload, message.id, fingerprint, args.actorPrincipalId);
      return this.settleApplied(args.threadId, message.id, card, payload, resultId);
    } catch (error) {
      const status = error instanceof RoutineRequestError ? error.status : 400;
      const detail = error instanceof Error ? error.message : String(error);
      // A terminal failure (the routine moved under the proposal) can never
      // be confirmed as prepared: settle the card as expired with its
      // options removed so it stops looking actionable.
      const expired = error instanceof RoutineRequestError && error.terminal;
      this.store.patchMessage(args.threadId, message.id, {
        card: { ...card, ...(expired ? { expired: true, options: [] } : {}), held: redactSecretsInText(detail).slice(0, 500) },
      });
      return {
        claimed: true,
        state: "invalid",
        error: detail,
        status,
      };
    }
  }

  private settleApplied(
    threadId: string,
    messageId: string,
    card: RoutineRequestOptionCard,
    payload: RoutineRequestCardData,
    resultId: string,
    appliedAt = this.now(),
  ): ResolveRoutineRequestResult {
    const applied: RoutineRequestCardData = {
      ...payload,
      appliedAt,
      resultId,
    };
    const settled = this.store.patchMessage(threadId, messageId, {
      card: { ...card, answered: "allow", held: undefined, routineRequest: applied },
    });
    if (!settled) throw new RoutineRequestError("This routine confirmation card is no longer available", 409);
    this.forgetSettledReceipt(payload, messageId);
    const copiesKey = payload.operation.action === "rotate_webhook_key"
      || (payload.operation.action === "create" && isTriggerSchedule(payload.operation.routine.schedule));
    return {
      claimed: true,
      state: "applied",
      action: payload.operation.action,
      resultId,
      ...(copiesKey ? { ownerCopiesKey: true as const } : {}),
    };
  }

  private forgetSettledReceipt(payload: RoutineRequestCardData, messageId: string): void {
    this.forgetReceipt(requestCommit(payload, messageId));
  }

  private settleCommittedReceipt(
    args: { botId: string; threadId: string; requestId: string },
    messageId: string,
    card: RoutineRequestOptionCard,
  ): ResolveRoutineRequestResult | null {
    const receipt = this.routines.routineRequestReceipt(args.requestId);
    if (!receipt) return null;
    if (receipt.botId !== args.botId || receipt.threadId !== args.threadId || receipt.messageId !== messageId) {
      return {
        claimed: true,
        state: "invalid",
        error: "This committed routine request belongs to another conversation",
        status: 403,
      };
    }
    const settled = this.store.patchMessage(args.threadId, messageId, {
      card: { ...card, answered: "allow", held: undefined },
    });
    if (!settled) {
      return {
        claimed: true,
        state: "invalid",
        error: "This routine confirmation card is no longer available",
        status: 409,
      };
    }
    this.forgetReceipt(receipt);
    return {
      claimed: true,
      state: "applied",
      action: receipt.action,
      resultId: receipt.resultId,
    };
  }

  private forgetReceipt(request: RoutineRequestCommit): void {
    try {
      this.routines.forgetRoutineRequestReceipt(request);
    } catch {
      // The transcript is already durably settled. Retaining a redundant
      // receipt after a cleanup write failure is safe and a later duplicate
      // response will retry this cleanup.
    }
  }

  private apply(payload: RoutineRequestCardData, messageId: string, fingerprint: string, actorPrincipalId?: string): string {
    const meta = actorPrincipalId ? { actorPrincipalId } : undefined;
    const operation = payload.operation;
    const confirmationAt = this.now();
    switch (operation.action) {
      case "create": {
        const created = this.routines.create(inputFromDefinition(
          operation.routine,
          operation.forBot?.botId ?? payload.botId,
          confirmationAt,
          operation.paused === true,
        ), {
          requestId: payload.requestId,
          messageId,
          botId: payload.botId,
          threadId: payload.threadId,
          action: "create",
          fingerprintVersion: ROUTINE_REQUEST_FINGERPRINT_VERSION,
          fingerprint,
        }, meta);
        if (isTriggerSchedule(created.schedule)) this.attachTrigger(created);
        return created.id;
      }
      case "update": {
        const current = verifyManageSnapshot(operation, this.routines, operation.forBot?.botId ?? payload.botId);
        const updated = this.routines.update(
          operation.routineId,
          updateFromChanges(operation.changes, confirmationAt, current.schedule, current.requires, current.goal),
          {
            requestId: payload.requestId,
            messageId,
            botId: payload.botId,
            threadId: payload.threadId,
            action: "update",
            fingerprintVersion: ROUTINE_REQUEST_FINGERPRINT_VERSION,
            fingerprint,
          },
          meta,
        );
        if (!updated) throw new RoutineRequestError("That routine no longer exists", 404);
        return updated.id;
      }
      case "pause":
      case "resume": {
        verifyManageSnapshot(operation, this.routines, operation.forBot?.botId ?? payload.botId);
        const updated = this.routines.update(operation.routineId, { enabled: operation.action === "resume" }, {
          requestId: payload.requestId,
          messageId,
          botId: payload.botId,
          threadId: payload.threadId,
          action: operation.action,
          fingerprintVersion: ROUTINE_REQUEST_FINGERPRINT_VERSION,
          fingerprint,
        });
        if (!updated) throw new RoutineRequestError("That routine no longer exists", 404);
        return updated.id;
      }
      case "run_now": {
        verifyManageSnapshot(operation, this.routines, operation.forBot?.botId ?? payload.botId);
        const run = this.routines.runNow(operation.routineId, {
          requestId: payload.requestId,
          messageId,
          botId: payload.botId,
          threadId: payload.threadId,
          action: "run_now",
          fingerprintVersion: ROUTINE_REQUEST_FINGERPRINT_VERSION,
          fingerprint,
        });
        if (!run) throw new RoutineRequestError("That routine no longer exists", 404);
        return run.id;
      }
      case "delete":
        verifyManageSnapshot(operation, this.routines, operation.forBot?.botId ?? payload.botId);
        if (!this.routines.remove(operation.routineId, {
          requestId: payload.requestId,
          messageId,
          botId: payload.botId,
          threadId: payload.threadId,
          action: "delete",
          fingerprintVersion: ROUTINE_REQUEST_FINGERPRINT_VERSION,
          fingerprint,
        })) {
          throw new RoutineRequestError("That routine no longer exists", 404);
        }
        return operation.routineId;
      case "rotate_webhook_key": {
        const current = verifyManageSnapshot(operation, this.routines, operation.forBot?.botId ?? payload.botId);
        if (!isTriggerSchedule(current.schedule)) {
          throw new RoutineRequestError("That routine has no webhook or email trigger", 409);
        }
        if (!this.rotateTrigger) {
          throw new RoutineRequestError("This server cannot rotate a trigger key", 503);
        }
        this.rotateTrigger(current);
        this.onAudit?.("routine.trigger.rotate", current);
        return current.id;
      }
      default: {
        const unexpected: never = operation;
        void unexpected;
        throw new RoutineRequestError("Unsupported persisted routine action");
      }
    }
  }

  /** Binds the owned trigger after create. A failure removes the routine
   * so a trigger is never left without its webhook. */
  private attachTrigger(routine: Routine): void {
    if (!this.bindTrigger) {
      this.routines.remove(routine.id);
      throw new RoutineRequestError("This server cannot attach a trigger to a routine", 503);
    }
    try {
      this.bindTrigger(routine);
      this.onAudit?.("routine.trigger.create", routine);
    } catch (error) {
      this.routines.remove(routine.id);
      throw error instanceof RoutineRequestError
        ? error
        : new RoutineRequestError(error instanceof Error ? error.message : "The trigger could not be attached", 503);
    }
  }
}
