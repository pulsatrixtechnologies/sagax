// Shared schema fragments and call helpers for agents-tools families.
// Definitions and handlers live beside each family; this module holds what
// more than one family imports. Never import server/index.ts.
import { randomUUID } from "node:crypto";
import { normalizeCronSchedule } from "../../../shared/routine-schedule.ts";
import type { Json } from "../agents-client.ts";
import type { HarnessClient } from "../agents-client.ts";
import { boundedAgentResult } from "../agents-result.ts";
import type { ToolCallContext } from "../agents-call-types.ts";
import { renderPeerDeliveryReceipts, type PeerDeliveryOutcome, type PeerDeliveryReceipt } from "../../peers/peer-delivery.ts";

export const WEEKDAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

// One flat object, deliberately free of oneOf/const/format: several agent
// CLIs flatten or drop JSON-Schema composition keywords when converting MCP
// tools into their provider's function-call format, and a model that never
// saw the branches guesses shapes forever (the 0.1.38 field failure). The
// per-type rules live in descriptions and are enforced with guiding errors
// in normalizeScheduleInput below.
export const ROUTINE_SCHEDULE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  description:
    'Use {"type":"cron","expression":"0 9 1 * *","timeZone":"Asia/Kolkata"} for 09:00 on the first of each month, once with at for one future run, weekly with time + weekdays, daily with time, interval with every_minutes for elapsed-time repetition, or limit_reset to run when an AI usage limit resets ("run this when my limit resets", or to finish work your own limit stopped). Intervals can optionally be limited with weekdays, window_start + window_end, and ends_at.',
  properties: {
    type: {
      type: "string",
      enum: ["once", "weekly", "daily", "interval", "cron", "limit_reset"],
      description: "once = a single future run; weekly = chosen weekdays; daily = every day; interval = every N elapsed minutes; cron = a calendar rule in an explicit timezone; limit_reset = when an AI engine's usage limit resets.",
    },
    expression: {
      type: "string",
      maxLength: 256,
      description: "Only for cron: five fields, minute hour day-of-month month weekday. Examples: 0 9 1 * * = monthly on day 1 at 09:00; 0 9 L * * = last day of each month; 0 9 * * MON#2 = second Monday of each month. Lists, ranges and steps are supported. No seconds, year, or @ macros. Never substitute daily AI date checks for a calendar rule.",
    },
    timeZone: {
      type: "string",
      maxLength: 128,
      description: "Required for cron: explicit IANA timezone, for example Asia/Kolkata, America/New_York, or UTC. Use the user's requested zone; resolve ambiguity before proposing. Do not send a numeric offset or local-time abbreviation.",
    },
    at: {
      type: "string",
      description:
        "Only for type once: future RFC3339 date-time with an explicit timezone offset, for example 2026-09-01T09:00:00+05:30 or 2026-09-01T03:30:00Z.",
    },
    engine: {
      type: "string",
      description: "Only for type limit_reset: the engine id whose limit to wait for, for example claude or codex. Omit for your own engine.",
    },
    repeat: {
      type: "string",
      enum: ["once", "every_reset"],
      description: "Only for type limit_reset: once (default) or every_reset.",
    },
    time: {
      type: "string",
      description: "For type weekly or daily: local computer time in 24-hour HH:MM format, for example 09:00.",
    },
    weekdays: {
      type: "array",
      items: { type: "string", enum: WEEKDAYS },
      description:
        "For type weekly: required run days. For type interval: optional allowed days. Values use the computer's local timezone.",
    },
    every_minutes: {
      type: "integer",
      minimum: 5,
      maximum: 1_440,
      description: "Only for type interval: whole minutes between runs, from 5 to 1440.",
    },
    starts_at: {
      type: "string",
      description:
        "Optional for type interval: RFC3339 date-time with an explicit timezone offset that anchors the cadence. Omit to start one interval after the routine is applied.",
    },
    window_start: {
      type: "string",
      description:
        "Optional for type interval, together with window_end: local 24-hour HH:MM when runs may begin, inclusive.",
    },
    window_end: {
      type: "string",
      description:
        "Optional for type interval, together with window_start: local 24-hour HH:MM when the allowed window ends, exclusive. It must be later on the same day.",
    },
    ends_at: {
      type: "string",
      description:
        "Optional for type interval: inclusive RFC3339 date-time cutoff with an explicit timezone offset.",
    },
    every_day: {
      type: "boolean",
      description: "Only for an interval update: true removes an existing weekday restriction.",
    },
    all_day: {
      type: "boolean",
      description: "Only for an interval update: true removes an existing time-window restriction.",
    },
    never_ends: {
      type: "boolean",
      description: "Only for an interval update: true removes an existing end cutoff.",
    },
    timing: {
      type: "string",
      enum: ["exact", "flexible"],
      description: "Optional. exact starts on time. flexible starts inside the early and late windows. Omit for exact.",
    },
    window_early_minutes: {
      type: "integer",
      minimum: 0,
      description: "Flexible only: minutes before the scheduled time. Default 15. Capped with the late window at half the gap between runs.",
    },
    window_late_minutes: {
      type: "integer",
      minimum: 0,
      description: "Flexible only: minutes after the scheduled time. Default 15. 0 means the run is ready by the scheduled time.",
    },
  },
  required: ["type"],
} as const;

// The routine fields are one constant used by both routine tools below:
// spread into propose_routine, and as the `changes` of propose_routine_action.
// On the wire each tool still carries the schema written out in full. Sharing
// it there would need $ref/$defs, which provider conversions do not survive
// (see the note on ROUTINE_SCHEDULE_SCHEMA and #544).
export const ROUTINE_FIELDS_SCHEMA = {
  name: { type: "string", minLength: 1, maxLength: 80, description: "Short name shown in Routines." },
  instructions: {
    type: "string",
    minLength: 1,
    maxLength: 20_000,
    description: "The complete instructions the bot should follow each time the routine runs.",
  },
  schedule: ROUTINE_SCHEDULE_SCHEMA,
  run_on: {
    type: "string",
    // "box" is Boat's historical run_on destination id (agents wire contract).
    enum: ["maus", "box"],
    description: "Default maus keeps the bot's selected model and configured computer, INCLUDING a self-hosted VPS. Omit this field for normal schedules. box runs on the bot's cloud computer, same model; it needs cloud computers set up and is not the generic cloud/VPS option. Legacy cloud values from list_routines mean box, not VPS.",
  },
  timeout_minutes: {
    type: "integer",
    minimum: 5,
    maximum: 240,
    description:
      "Optional safety limit for active work, from 5 to 240 minutes. Omit for no limit.",
  },
  clear_timeout: {
    type: "boolean",
    description: "Only for updates: set true to remove an existing safety limit. Do not combine with timeout_minutes.",
  },
  continuity: {
    type: "boolean",
    description: "Opt in to using the latest completed run's bounded report as historical context. Use it for recurring work that builds on last time, such as QA passes, monitoring or follow-ups. Defaults to false; set false in an update to start fresh again. Included in the applied result or pending confirmation.",
  },
  overlap: {
    type: "string",
    enum: ["skip", "queue"],
    description: "While this routine is still working, skip scheduled occurrences (default) or queue at most one run. Queue skips further occurrences until the pending run starts; it never builds an unlimited backlog. Manual and webhook requests are separate.",
  },
  watch: {
    type: ["object", "null"],
    description: "Run only when something changes: on each due time Sagax checks, with no model turn, and starts the run only on a change (or when condition holds). The run gets a note of what is new, changed or gone. {kind:\"watch\", source:{type:\"files\",path,recursive?} | {type:\"command\",command} (run where you work) | {type:\"tool\",tool:\"server__tool\",args} (read tools only), condition?:{test:\"json_path\",path,op:eq|ne|gt|gte|lt|lte|contains|exists,value} | {test:\"contains\",text,negate?} | {test:\"exit_code\",op:eq|ne,value}, wakeOn?:change|match, track?:{items,key,fields}, firstRun?:baseline|wake, whenAsleep?:skip|wake}. Needs a repeating schedule (checks at most every 5 min). null in an update removes it.",
  },
  folder: {
    type: ["string", "null"],
    maxLength: 60,
    description: "Folder of this bot's Routines list to file it in, such as Reports or Home. A new name makes the folder; reuse a name from list_routines to group with others. null in an update takes it out of its folder. Do not put the folder in the name as a [Prefix].",
  },
  model: {
    type: ["string", "null"],
    maxLength: 200,
    description: "Only if asked: a model id of this bot's engine for its runs and sub-agents; chat keeps the bot's. null resets.",
  },
  subagent_model: {
    type: ["string", "null"],
    maxLength: 200,
    description: "Only if asked: a model id of this bot's engine for the sub-agents of its runs (Claude), overriding model for them. null resets.",
  },
  act_as: {
    type: ["string", "null"],
    maxLength: 120,
    description: "Only if asked: the Perspicax role slug its runs act as (\"Au nom de\"), one the run-as person holds; \"\" is their own access; null resets.",
  },
  delete_when_finished: {
    type: "boolean",
    description: "Delete this routine automatically once its schedule has no more runs and the last run has settled (completed, failed, cancelled or missed). Only for a one-time routine or an interval with an end date. Defaults to false. Past runs stay in the calendar and the run log. Set false in an update to keep it listed after it ends.",
  },
} as const;

// propose_profile's one sentence about for_bot_id, which a bot that is not a
// Primary Bot is not shown (catalogTools), along with the parameter itself.
export const CHIEF_PROFILE_TARGET = " A Primary Bot may pass for_bot_id (from list_bots) for a requested change to any bot of its person.";
// 2026-10-20 ("le bot principal fait tout"): the person's own words,
// for a Primary Bot the person asked now; the change then applies at once.
export const PERSON_QUOTE = {
  type: "string", maxLength: 600,
  description: "Primary Bot: the person's own words asking this now (bot named); applies at once.",
} as const;
export const PROPOSAL_OUTCOME = " Read the result: granted Full Access may apply the change immediately. If applied, continue the requested work without another confirmation. Only a pending result requires ending the turn and waiting for the in-app decision. Never claim success from the permission mode alone; report failed or cancelled results honestly. This does not elevate another bot's execution permissions.";
/** Routines, skills, profile and model: a bot's change to itself applies at
 * any level (server/direct-apply.ts). */
export const SELF_CHANGE_OUTCOME = " Read the result: a change to your own routines, skills, profile or model applies immediately, and the person sees it with an Undo; a change for another bot may wait for the person's confirmation. If applied, continue the requested work without another confirmation. Only a pending result requires ending the turn and waiting for the in-app decision. Never claim success without an applied result; report failed or cancelled results honestly. This does not elevate another bot's execution permissions.";

/** Every tool, in the order it is listed. Four peer tools are worded
 * differently for an external runtime, which may poll inside one process. */

export const EXTERNAL_STATUS_GUIDANCE = "Use check_delegation or wait_delegation with this task id to retrieve the result; polling is allowed without ending this external runtime.";
/** How many entries a memory_update reply names when its write moved some
 * to the archive; the rest are counted. */
export const MOVED_ENTRIES_SHOWN = 5;

export const SHORT_WEEKDAYS = {
  mon: "monday",
  tue: "tuesday",
  tues: "tuesday",
  wed: "wednesday",
  thu: "thursday",
  thur: "thursday",
  thurs: "thursday",
  fri: "friday",
  sat: "saturday",
  sun: "sunday",
} as const satisfies Record<string, (typeof WEEKDAYS)[number]>;

export const SUPPORTED_SCHEDULES =
  'Supported schedules: {"type":"once","at":"2026-09-01T09:00:00+05:30"} (future RFC3339 with explicit offset), ' +
  '{"type":"weekly","time":"09:00","weekdays":["monday","friday"]}, {"type":"daily","time":"09:00"}, ' +
  '{"type":"interval","every_minutes":15,"weekdays":["monday","friday"],"window_start":"09:00","window_end":"17:00"}, ' +
  '{"type":"limit_reset","engine":"claude","repeat":"once"} (run when that AI usage limit resets; omit engine for your own), ' +
  'or {"type":"cron","expression":"0 9 1 * *","timeZone":"Asia/Kolkata"} (monthly at 09:00 on day 1; five fields and an explicit IANA timezone). ' +
  'A repeating schedule may set "timing" to "flexible" with window_early_minutes and window_late_minutes (default 15; together capped at half the gap).';

/** The outcome of coercing a model-sent schedule: the harness-dialect
 * schedule, or a message telling the model exactly what to send instead. */
export interface NormalizedSchedule {
  schedule?: Json;
  error?: string;
}

/** Timing fields the model may send, copied onto the harness schedule. */
export function copiedTiming(raw: Json): Json {
  const out: Json = {};
  if (typeof raw.timing === "string") out.timing = raw.timing;
  const early = raw.window_early_minutes ?? raw.windowEarlyMinutes;
  const late = raw.window_late_minutes ?? raw.windowLateMinutes;
  if (typeof early === "number") out.windowEarlyMinutes = early;
  if (typeof late === "number") out.windowLateMinutes = late;
  return out;
}

/** A schedule as the harness accepts it, or a message telling the model
 * exactly what to send instead. Coercion first, error second: models
 * routinely stringify nested objects, say "daily", or shorten weekday
 * names, and each of those has one obvious meaning. */
export function normalizeScheduleInput(args: Json): NormalizedSchedule {
  let raw = args.schedule;
  if (typeof raw === "string") {
    // Some models deliver nested objects as JSON strings.
    try {
      raw = JSON.parse(raw);
    } catch {
      return { error: `The schedule must be a JSON object, not text. ${SUPPORTED_SCHEDULES}` };
    }
  }
  if (!jsonRecord(raw)) return { error: `The schedule must be a JSON object. ${SUPPORTED_SCHEDULES}` };
  const type = typeof raw.type === "string" ? raw.type.trim().toLowerCase() : "";
  const timingFields = ["timing", "window_early_minutes", "windowEarlyMinutes", "window_late_minutes", "windowLateMinutes"];
  const fields = type === "once"
    ? ["type", "at"]
    : type === "weekly" || type === "daily"
      ? ["type", "time", "weekdays", ...timingFields]
      : type === "interval"
        ? ["type", "every_minutes", "everyMinutes", "starts_at", "anchorAt", "weekdays", "every_day", "window_start", "window_end", "window", "all_day", "ends_at", "endsAt", "never_ends", ...timingFields]
        : type === "cron"
          ? ["type", "expression", "timeZone", ...timingFields]
          : type === "limit_reset"
            ? ["type", "engine", "repeat"]
            : null;
  // Provider conversions may send unused optional fields as null. Ignore
  // those, but never silently discard an actual scheduling constraint (for
  // example timezone or a misspelled starts_at) and approve different work.
  const unsupported = fields && Object.keys(raw).find((key) => raw[key] != null && !fields.includes(key));
  if (unsupported) {
    return { error: `Unsupported ${type} schedule field "${unsupported}". Weekly and daily times use the computer's timezone from list_routines. ${SUPPORTED_SCHEDULES}` };
  }
  if (type === "cron") {
    try {
      return { schedule: { ...normalizeCronSchedule({ type, expression: raw.expression, timeZone: raw.timeZone }), ...copiedTiming(raw) } };
    } catch (error) {
      return { error: `${error instanceof Error ? error.message : "Invalid cron schedule"}. ${SUPPORTED_SCHEDULES}` };
    }
  }
  if (type === "limit_reset") return limitResetSchedule(raw.engine, raw.repeat);
  if (type === "once") {
    if (typeof raw.at !== "string" || !raw.at.trim()) {
      return { error: `A once schedule needs "at": a future RFC3339 date-time with an explicit offset, for example 2026-09-01T09:00:00+05:30.` };
    }
    return { schedule: { type: "once", at: raw.at.trim() } };
  }
  if (type === "weekly" || type === "daily") {
    const time = typeof raw.time === "string" ? raw.time.trim() : "";
    if (!time) return { error: `A ${type} schedule needs "time" in 24-hour HH:MM, for example 09:00.` };
    let weekdays: string[];
    if (type === "daily") {
      // daily = weekly on all seven days; an explicit weekdays list narrows it.
      weekdays = Array.isArray(raw.weekdays) && raw.weekdays.length ? raw.weekdays : [...WEEKDAYS];
    } else {
      if (!Array.isArray(raw.weekdays) || raw.weekdays.length === 0) {
        return { error: `A weekly schedule needs "weekdays", for example ["monday","friday"] — or use {"type":"daily"} to run every day.` };
      }
      weekdays = raw.weekdays;
    }
    const normalized: string[] = [];
    for (const day of weekdays) {
      const lower = String(day).trim().toLowerCase();
      const full = (WEEKDAYS as readonly string[]).includes(lower)
        ? lower
        : Object.hasOwn(SHORT_WEEKDAYS, lower)
          ? SHORT_WEEKDAYS[lower as keyof typeof SHORT_WEEKDAYS]
          : undefined;
      if (!full) return { error: `Unsupported weekday "${String(day)}". Use full names: ${WEEKDAYS.join(", ")}.` };
      if (!normalized.includes(full)) normalized.push(full);
    }
    return { schedule: { type: "weekly", time, weekdays: normalized, ...copiedTiming(raw) } };
  }
  if (type === "interval") {
    for (const flag of ["every_day", "all_day", "never_ends"]) {
      if (raw[flag] != null && typeof raw[flag] !== "boolean") {
        return { error: `"${flag}" must be true or false.` };
      }
    }
    if (raw.window != null && (!jsonRecord(raw.window)
      || Object.keys(raw.window).some((key) => key !== "start" && key !== "end")
      || typeof raw.window.start !== "string" || typeof raw.window.end !== "string")) {
      return { error: '"window" must contain "start" and "end" in HH:MM, for example {"start":"09:00","end":"17:00"}.' };
    }
    const rawMinutes = raw.every_minutes ?? raw.everyMinutes;
    const everyMinutes = Number(rawMinutes);
    if (!Number.isInteger(everyMinutes) || everyMinutes < 5 || everyMinutes > 1_440) {
      return { error: 'An interval schedule needs "every_minutes": a whole number from 5 to 1440.' };
    }
    const rawStart = raw.starts_at ?? raw.anchorAt;
    if (rawStart !== undefined && (typeof rawStart !== "string" || !rawStart.trim())) {
      return { error: '"starts_at" must be an RFC3339 date-time with an explicit timezone offset.' };
    }
    if (raw.every_day === true && Array.isArray(raw.weekdays) && raw.weekdays.length > 0) {
      return { error: 'Choose interval "weekdays" or "every_day", not both.' };
    }
    let intervalWeekdays: string[] | null | undefined;
    if (raw.every_day === true) {
      intervalWeekdays = null;
    } else if (raw.weekdays !== undefined) {
      if (!Array.isArray(raw.weekdays) || raw.weekdays.length === 0) {
        return { error: 'Interval "weekdays" must contain at least one full weekday name.' };
      }
      intervalWeekdays = [];
      for (const day of raw.weekdays) {
        const lower = String(day).trim().toLowerCase();
        const full = (WEEKDAYS as readonly string[]).includes(lower)
          ? lower
          : Object.hasOwn(SHORT_WEEKDAYS, lower)
            ? SHORT_WEEKDAYS[lower as keyof typeof SHORT_WEEKDAYS]
            : undefined;
        if (!full) return { error: `Unsupported weekday "${String(day)}". Use full names: ${WEEKDAYS.join(", ")}.` };
        if (!intervalWeekdays.includes(full)) intervalWeekdays.push(full);
      }
    }
    const rawWindow = jsonRecord(raw.window) ? raw.window : undefined;
    const windowStart = raw.window_start ?? rawWindow?.start;
    const windowEnd = raw.window_end ?? rawWindow?.end;
    if (raw.all_day === true && (windowStart !== undefined || windowEnd !== undefined)) {
      return { error: 'Choose window_start + window_end or "all_day", not both.' };
    }
    let window: Json | null | undefined;
    if (raw.all_day === true) {
      window = null;
    } else if (windowStart !== undefined || windowEnd !== undefined) {
      if (typeof windowStart !== "string" || !windowStart.trim() || typeof windowEnd !== "string" || !windowEnd.trim()) {
        return { error: 'An interval time window needs both "window_start" and "window_end" in 24-hour HH:MM.' };
      }
      window = { start: windowStart.trim(), end: windowEnd.trim() };
    }
    const rawEnd = raw.ends_at ?? raw.endsAt;
    if (raw.never_ends === true && rawEnd !== undefined) {
      return { error: 'Choose "ends_at" or "never_ends", not both.' };
    }
    let endsAt: string | null | undefined;
    if (raw.never_ends === true) endsAt = null;
    else if (rawEnd !== undefined) {
      if (typeof rawEnd !== "string" || !rawEnd.trim()) {
        return { error: '"ends_at" must be an RFC3339 date-time with an explicit timezone offset.' };
      }
      endsAt = rawEnd.trim();
    }
    return {
      schedule: {
        type: "interval",
        everyMinutes,
        ...(typeof rawStart === "string" ? { anchorAt: rawStart.trim() } : {}),
        ...(intervalWeekdays !== undefined ? { weekdays: intervalWeekdays } : {}),
        ...(window !== undefined ? { window } : {}),
        ...(endsAt !== undefined ? { endsAt } : {}),
        ...copiedTiming(raw),
      },
    };
  }
  if (type === "hourly" || type === "minutes") {
    return { error: `Use an interval schedule for every-N-minutes work. ${SUPPORTED_SCHEDULES}` };
  }
  return { error: `Unknown schedule type "${type || "(missing)"}". ${SUPPORTED_SCHEDULES}` };
}

/** No engine means the bot's own, which the harness fills when the request is saved. */
export function limitResetSchedule(engine: unknown, repeat: unknown): NormalizedSchedule {
  if (engine != null && (typeof engine !== "string" || !engine.trim())) {
    return { error: 'engine must be an engine id such as "claude" or "codex"; omit it for your own engine.' };
  }
  if (repeat != null && repeat !== "once" && repeat !== "every_reset") {
    return { error: 'repeat must be "once" or "every_reset".' };
  }
  return {
    schedule: {
      type: "limit_reset",
      ...(typeof engine === "string" ? { engine: engine.trim() } : {}),
      repeat: repeat === "every_reset" ? "every_reset" : "once",
    },
  };
}

export type RoutineAction = "update" | "pause" | "resume" | "run_now" | "delete" | "rotate_webhook_key";

/** Keeps a large result within what a model should be handed, saving the
 * rest in the harness for tool_result_read. */
export const capResult = (text: string, context: ToolCallContext) => boundedAgentResult(text, (retained, truncated) => {
  // The standing capability cannot write/read cached tool results. Keep the
  // normal bounded fallback without making a forbidden request or retrying.
  if (context.externalRuntime) throw new Error("External runtime results are not cached");
  return context.client.api("/api/internal/tool-result", { method: "POST", signal: AbortSignal.timeout(3_000),
    body: JSON.stringify({ text: retained, truncated }) });
});

/** "1st", "2nd", "3rd", "4th" — the queue position as a person says it. */
export function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  const rem10 = n % 10;
  return `${n}${rem10 === 1 ? "st" : rem10 === 2 ? "nd" : rem10 === 3 ? "rd" : "th"}`;
}

export function jsonRecord(value: unknown): value is Json {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function routineAction(value: unknown): RoutineAction | null {
  return value === "update" || value === "pause" || value === "resume" || value === "run_now" || value === "delete" || value === "rotate_webhook_key"
    ? value
    : null;
}

export function normalizeTrigger(raw: unknown): { trigger?: { type: "webhook" | "email" }; error?: string } {
  if (raw === undefined || raw === null) return {};
  let value: unknown = raw;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return { error: "trigger must be { type: \"webhook\" } or { type: \"email\" }." };
    try { value = JSON.parse(trimmed); }
    catch { return { error: "trigger must be { type: \"webhook\" } or { type: \"email\" }." }; }
  }
  if (!jsonRecord(value)) return { error: "trigger must be { type: \"webhook\" } or { type: \"email\" }." };
  const extra = Object.keys(value).filter((key) => key !== "type");
  if (extra.length > 0 || (value.type !== "webhook" && value.type !== "email")) {
    return { error: "trigger must be { type: \"webhook\" } or { type: \"email\" }." };
  }
  return { trigger: { type: value.type } };
}

export function routineFields(args: Json): { fields: Json; error?: string } {
  const fields: Json = {};
  // list_routines returns the harness names. Accept those when a model
  // copies back a definition, as we already do for interval fields.
  const destination = (value: unknown) => value === "box" ? "cloud" : value;
  if (args.run_on != null && args.runOn != null && destination(args.run_on) !== destination(args.runOn)) {
    return { fields, error: "Choose one run_on destination; run_on and runOn disagree." };
  }
  if (args.timeout_minutes != null && args.timeoutMinutes != null && args.timeout_minutes !== args.timeoutMinutes) {
    return { fields, error: "Choose one timeout_minutes limit; timeout_minutes and timeoutMinutes disagree." };
  }
  const runOn = destination(args.run_on ?? args.runOn);
  const timeoutMinutes = args.timeout_minutes ?? args.timeoutMinutes;
  if (runOn != null && runOn !== "maus" && runOn !== "cloud") {
    return { fields, error: 'Use run_on="maus" for the bot’s current model and configured computer (including VPS), or run_on="box" only for the bot’s cloud computer. Legacy "cloud" also means box.' };
  }
  if (timeoutMinutes != null && (
    typeof timeoutMinutes !== "number" || !Number.isInteger(timeoutMinutes) || timeoutMinutes < 5 || timeoutMinutes > 240
  )) {
    return { fields, error: "timeout_minutes must be a whole number from 5 to 240. Use clear_timeout to remove a limit." };
  }
  if (args.continuity != null && typeof args.continuity !== "boolean") {
    return { fields, error: "continuity must be true or false." };
  }
  const deleteWhenFinished = args.delete_when_finished ?? args.deleteWhenFinished;
  if (args.delete_when_finished != null && args.deleteWhenFinished != null && args.delete_when_finished !== args.deleteWhenFinished) {
    return { fields, error: "Choose one delete_when_finished value; delete_when_finished and deleteWhenFinished disagree." };
  }
  if (deleteWhenFinished != null && typeof deleteWhenFinished !== "boolean") {
    return { fields, error: "delete_when_finished must be true or false." };
  }
  if (args.overlap !== undefined && args.overlap !== "skip" && args.overlap !== "queue") {
    return { fields, error: "overlap must be skip or queue." };
  }
  if (args.enabled !== undefined && typeof args.enabled !== "boolean") {
    return { fields, error: "enabled must be true or false." };
  }
  if (args.clear_timeout != null && typeof args.clear_timeout !== "boolean") {
    return { fields, error: "clear_timeout must be true or false." };
  }
  if (args.clear_timeout === true && timeoutMinutes != null) {
    return { fields, error: "Choose timeout_minutes or clear_timeout, not both." };
  }
  if (typeof args.name === "string") fields.name = args.name.trim();
  if (typeof args.instructions === "string") fields.instructions = args.instructions.trim();
  if (args.schedule !== undefined && args.schedule !== null) {
    const normalized = normalizeScheduleInput(args);
    if (normalized.error) return { fields, error: normalized.error };
    fields.schedule = normalized.schedule;
  }
  const trigger = normalizeTrigger(args.trigger);
  if (trigger.error) return { fields, error: trigger.error };
  if (fields.schedule && trigger.trigger) {
    return { fields, error: "Choose exactly one of schedule or trigger." };
  }
  if (trigger.trigger) fields.trigger = trigger.trigger;
  if (runOn != null) fields.runOn = runOn;
  if (args.clear_timeout === true) fields.timeoutMinutes = null;
  else if (timeoutMinutes != null) fields.timeoutMinutes = timeoutMinutes;
  if (typeof args.continuity === "boolean") fields.continuity = args.continuity;
  if (args.overlap !== undefined) fields.overlap = args.overlap;
  if (typeof args.enabled === "boolean") fields.enabled = args.enabled;
  // 2026-10-26: run only when something changes; checked by the service.
  if (args.watch !== undefined) fields.watch = args.watch;
  // 2026-10-28: the bot's folder to file it in (null: out of its folder).
  if (args.folder !== undefined) fields.folder = args.folder;
  if (typeof deleteWhenFinished === "boolean") fields.deleteWhenFinished = deleteWhenFinished;
  // 2026-11-04: the routine's model (shared/routine-model.ts), checked by the service.
  if (args.model !== undefined) {
    if (args.model !== null && typeof args.model !== "string") return { fields, error: "model must be a model id, or null for the bot's model." };
    fields.model = args.model;
  }
  // #2038: the routine's sub-agent model (Claude), checked by the service.
  if (args.subagent_model !== undefined) {
    if (args.subagent_model !== null && typeof args.subagent_model !== "string") return { fields, error: "subagent_model must be a model id, or null." };
    fields.subagentModel = args.subagent_model;
  }
  // 2026-11-05: the routine's "Au nom de" role (shared/routine-act-as.ts).
  if (args.act_as !== undefined) {
    if (args.act_as !== null && typeof args.act_as !== "string") return { fields, error: "act_as must be a role slug, \"\" for the person's own access, or null." };
    fields.actAs = args.act_as;
  }
  return { fields };
}

export const HIDDEN_RESULT_KEYS = new Set([
  "webhookKey", "secret", "signingSecret", "pendingToken", "token", "secretHash", "ownerCopiesKey",
]);

/** The model never sees a trigger key, or any string that carries one. */
export function publicProposalValue(value: unknown): unknown {
  if (typeof value === "string") return value.includes("whsec_") ? "[redacted]" : value;
  if (Array.isArray(value)) return value.map(publicProposalValue);
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (HIDDEN_RESULT_KEYS.has(key)) continue;
    out[key] = publicProposalValue(child);
  }
  return out;
}

export function ownerKeyNote(result: Json): string {
  if (result.ownerCopiesKey !== true) return "";
  return result.action === "rotate_webhook_key"
    ? "\n\nThe trigger key was rotated; the owner copies its key in the app."
    : "\n\nWebhook created; the owner copies its key in the app";
}

/** Full Access is decided by the harness, not inferred from a model claim or
 * local environment flag. Missing state preserves older pending responses. */
export function completedProposalResult(r: Json, subject: string): { text: string; isError?: boolean } | undefined {
  const state = r.state;
  const result = jsonRecord(r.result) ? r.result : undefined;
  const error = typeof r.error === "string" ? r.error : typeof result?.error === "string" ? result.error : undefined;
  const attention = error ?? (r.settlementPending && typeof r.message === "string" ? r.message : undefined);
  if ((!state || state === "pending") && !error) return undefined;
  const summary = typeof r.summary === "string" && r.summary.trim() ? `\n\n${r.summary.trim()}` : "";
  const details = result ? `\n\nResult: ${JSON.stringify(publicProposalValue(result))}` : "";
  const keyNote = result ? ownerKeyNote(result) : "";
  if (state !== "applied" || (result?.state !== undefined && result.state !== "applied")) {
    return { text: `The request for ${subject} did not complete successfully.${error ? ` ${error}` : ""}${summary}${details}\n\nDo not claim it was applied. Address the reported blocker rather than repeating the request or asking for a duplicate confirmation.`, isError: true };
  }
  return { text: `Applied ${subject}.${summary}${keyNote}${details}${attention ? `\n\nNeeds attention: ${attention}` : ""}\n\nNo additional confirmation is needed. Continue the requested work; do not wait for a review card or ask the user to approve this change again.` };
}

export function confirmationResult(r: Json, fallback: string, noun = "routine"): { text: string; isError?: boolean } {
  const completed = completedProposalResult(r, fallback);
  if (completed) return completed;
  const summary = typeof r.summary === "string" && r.summary.trim() ? `\n\n${r.summary.trim()}` : "";
  return {
    text: `A confirmation card is now visible to the user for ${fallback}.${summary}\n\nThis change has not been applied yet. End this turn and wait for the user to confirm or deny the card; do not claim the ${noun} was created or changed before confirmation.`,
  };
}

/** Who said a recalled line, as the header of a hit or a read. A user-role
 * line another bot delivered with ask_bot is labelled as that bot's: the
 * snippet windows past the provenance note in the text, and a peer's ask
 * recalled as the user's request is the misattribution the note exists to
 * prevent. */
export function recallSpeaker(hit: Json): string {
  if (typeof hit.peer === "string" && hit.peer) return `@${hit.peer} (another bot, via ask_bot — not your user)`;
  if (typeof hit.from === "string" && hit.from) return hit.from;
  return hit.role === "user" ? "user" : "you";
}

export const isPeerDeliveryOutcome = (value: unknown): value is PeerDeliveryOutcome =>
  value === "queued" || value === "injected" || value === "failed";

/** The delivery receipt a peer-send answer carries, as one prose line.
 * Unvalidated JSON stays out: a malformed receipt renders nothing rather
 * than half a line of somebody else's text. */
export function deliveryNote(r: Json): string {
  const receipt = (r as { receipt?: unknown }).receipt;
  if (!receipt || typeof receipt !== "object") return "";
  const { botId, botName, outcome, detail, taskId, requestId } = receipt as Record<string, unknown>;
  if (typeof botId !== "string" || !botId || typeof detail !== "string" || !detail) return "";
  if (!isPeerDeliveryOutcome(outcome)) return "";
  const parsed: PeerDeliveryReceipt = {
    botId,
    ...(typeof botName === "string" && botName ? { botName } : {}),
    outcome,
    detail,
    ...(typeof taskId === "string" && taskId ? { taskId } : {}),
    ...(typeof requestId === "string" && requestId ? { requestId } : {}),
  };
  return renderPeerDeliveryReceipts([parsed]);
}

/** When a recalled line was said, on the machine's own clock. `toISOString()`
 * answers in UTC, which disagrees with every other day the bot is shown: a
 * bare `since`/`until` date is read as local midnight (recent-work.ts
 * parseSince), the recent-work brief's times are local (whenLabel), and the
 * daily memory logs are named after the local day. East of UTC a message
 * from this morning was being dated yesterday — so a search for today's work
 * came back stamped with the wrong date. */
export function recallWhen(at: unknown, dateOnly: boolean): string {
  if (typeof at !== "number" || !Number.isFinite(at)) return "";
  const said = new Date(at);
  if (!Number.isFinite(said.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  const day = `${said.getFullYear()}-${pad(said.getMonth() + 1)}-${pad(said.getDate())}`;
  return dateOnly ? day : `${day} ${pad(said.getHours())}:${pad(said.getMinutes())}`;
}

/** The act request a wrapper tool stands for: always a plain /api route, so
 * the person's own rights and the bot's approval mode decide. */
export function wrapperAct(name: string, args: Json): Json | { error: string } {
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  if (name === "answer_approval") {
    const threadId = str(args.thread_id);
    const requestId = str(args.request_id);
    if (!/^[\w-]+$/.test(threadId) || !requestId) return { error: "answer_approval needs thread_id and request_id." };
    if (args.decision !== "allow" && args.decision !== "deny") return { error: "decision is allow or deny." };
    return { method: "POST", path: `/api/threads/${threadId}/respond`, body: { requestId, behavior: args.decision } };
  }
  if (name === "nudge_person") {
    const principalId = str(args.principal_id);
    const groupId = str(args.group_id);
    if (!principalId === !groupId) return { error: "Give principal_id or group_id, not both." };
    return { method: "POST", path: "/api/nudges", body: principalId ? { principalId } : { groupId } };
  }
  if (name === "manage_pairing") {
    if (args.action === "list") return { method: "GET", path: "/api/auth/pairing" };
    if (args.action === "create") return { method: "POST", path: "/api/auth/pairing", body: Array.isArray(args.scopes) ? { scopes: args.scopes } : {} };
    return { error: "action is list or create." };
  }
  if (args.action === "get") return { method: "GET", path: "/api/config" };
  if (args.action === "patch" && args.patch && typeof args.patch === "object" && !Array.isArray(args.patch)) return { method: "PATCH", path: "/api/config", body: args.patch as Json };
  return { error: "action is get, or patch with a patch object." };
}

/** A teammate request (delegate_bot, ask_bot) sent with one idempotency key
 * for the call: a connection that drops before the answer arrives is
 * retried once with the same key, and the server answers the request it
 * already accepted instead of dispatching it again. A refusal is not retried. */
export async function sendTeammateRequest(api: HarnessClient["api"], path: string, body: Record<string, unknown>): Promise<Json> {
  const init = () => ({ method: "POST", body: JSON.stringify(body), headers: { "idempotency-key": String(body.idempotencyKey) } });
  body.idempotencyKey ??= randomUUID();
  try {
    return await api(path, init());
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    return api(path, init());
  }
}

export function githubConnectText(r: Record<string, unknown>): string {
  const login = typeof r.login === "string" ? r.login : "";
  const orgs = typeof r.orgAccessUrl === "string" ? r.orgAccessUrl : "";
  switch (r.state) {
    case "connected":
      return `GitHub is connected as @${login}. Continue the task.${orgs ? ` If a repository of an organization still answers 404 or 403, that organization has not granted access: ask the person to open ${orgs} and click Grant (or Request) next to it, or call connect_github with reconnect true.` : ""}`;
    case "pending": {
      const until = typeof r.expiresAt === "number" ? ` It expires at ${new Date(r.expiresAt).toISOString().slice(11, 16)} UTC.` : "";
      return `Show the person, in one short message in their language: the code ${String(r.userCode)} and the link ${String(r.verificationUri)}. They open the link, sign in to GitHub, type the code and authorize Sagax; on that page, next to each organization, they click Grant (or Request when they are not an owner) so their bots reach its repositories.${until} Then end this turn. When they say it is done, call connect_github again to confirm. Never ask for a token or for gh auth login.`;
    }
    case "group":
      return "Connecting GitHub is done in a 1:1 conversation with the person or in the GitHub plugin's page (Capabilities > Sources > GitHub connection), never in a group. Say so.";
    case "not_person":
      return "GitHub is connected only on the person's own request in their 1:1 conversation, never from a routine, an automation or another bot's turn. Tell them to ask you directly or to use the GitHub plugin's page (Capabilities > Sources > GitHub connection).";
    case "admin_only":
      return "This person's Sagax profile does not include managing their own plugins, skills and MCP servers, so they cannot connect GitHub themselves. Tell them to ask an administrator to add it in Perspicax.";
    case "no_device_flow":
      return `This server has no GitHub OAuth App for the device flow yet.${login ? ` GitHub is connected as @${login} with a token that may not cover their organizations.` : ""} Tell the person to connect in the GitHub plugin's page (Capabilities > Sources > GitHub connection) with a classic personal access token with the repo and read:org scopes (a fine-grained token reaches one owner only), and an administrator to add the OAuth App's client id in Settings > Organization.`;
    case "error":
      return `GitHub is not usable right now${login ? ` for @${login}` : ""}: ${typeof r.message === "string" ? r.message : "the token was refused"}. Tell the person, in their language, to reconnect GitHub in the GitHub plugin's page (Capabilities > Sources > GitHub connection), or call connect_github with reconnect true. Never ask for gh auth login or a token in chat.`;
    default:
      return typeof r.message === "string" ? r.message : "GitHub sign-in is unavailable right now.";
  }
}

