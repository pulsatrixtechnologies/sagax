// Agents tool family: Routines: propose, change, list and run.
// Definitions and handlers. Assembled in order by agents-catalog.ts;
// dispatched by agents-call.ts. Never import server/index.ts.

import { TRIGGER_SOURCES } from "../../../shared/trigger-sources.ts";
import { formatRoutinePage, type RoutinePage } from "../../../shared/routine-listing.ts";
import { BOT_EVENT_TYPES } from "../../../shared/bot-event-subscriptions.ts";
import type { ToolCallContext, ToolCallResult } from "../agents-call-types.ts";
import type { Json } from "../agents-client.ts";
import {
  PERSON_QUOTE,
  SELF_CHANGE_OUTCOME,
  ROUTINE_FIELDS_SCHEMA,
  jsonRecord,
  routineAction,
  routineFields,
  confirmationResult,
} from "./shared.ts";

export const DEF_LIST_ROUTINES = {
    name: "list_routines",
    description:
      "This bot's routines a page at a time, with the current time and timezone for relative dates. Read every page (offset) before counting; routine_id gives one in full (also accepts an owned webhook id from the Webhooks list, and a sibling bot's routine id when you can reach that bot). Short rows include webhookId when the routine starts from a delivery. Only when asked about routines.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { offset: { type: "integer" }, routine_id: { type: "string", minLength: 1, description: "Routine id from list_routines, or that routine's owned webhook id." } },
    },
  };

export const DEF_RUN_ROUTINE = {
    name: "run_routine",
    description:
      "Check one of this bot's routines with action check (readiness only, no run or model turn), or run it now, once. Get the routine id from list_routines. The schedule and the Active switch stay as they are; a paused routine runs and stays paused. It waits while busy, then starts; a run already in progress is returned, never doubled.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { routine_id: { type: "string", minLength: 1, description: "Routine id from list_routines." }, action: { type: "string", enum: ["run", "check"], description: "check reads readiness without creating a run; its warnings list the paths the instructions cite that cannot be found (a warning never blocks a run). Omit to run." } },
      required: ["routine_id"],
    },
  };

export const DEF_EVENT_SUBSCRIPTIONS = {
    name: "event_subscriptions",
    description:
      "This bot's event subscriptions, instead of polling: when one of its routine runs reports, stays quiet or fails, call a webhook url (signed JSON) or run a routine_id (list_routines; this bot or a bot of the same person). action list (default), create (events plus url or routine_id), test (sends one sample) or delete.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        action: { type: "string", enum: ["list", "create", "test", "delete"] },
        events: { type: "array", items: { type: "string", enum: [...BOT_EVENT_TYPES] } },
        url: { type: "string", minLength: 1 },
        routine_id: { type: "string", minLength: 1 },
        subscription_id: { type: "string", minLength: 1, description: "For test and delete, from list." },
      },
    },
  };

export const DEF_PROPOSE_ROUTINE = {
    name: "propose_routine",
    description:
      "Prepare a new routine after the user explicitly asks to schedule recurring or future work. It starts active; enabled false creates it paused. Give exactly one of schedule or trigger. Call list_routines first for relative dates or times (current time and timezone). Convert calendar requests (monthly dates, last days, nth weekdays) into a five-field cron schedule with an explicit IANA timeZone; keep every-N-minutes work as interval. Never approximate an unsupported request with another schedule or an AI date-check routine; explain the limit. Resolve ambiguity with the user first; one-time schedules need an RFC3339 offset. To run as ANOTHER bot in your section, pass its id (list_bots) as for_bot_id; runs keep that bot's permissions." + SELF_CHANGE_OUTCOME,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        ...ROUTINE_FIELDS_SCHEMA,
        trigger: {
          type: "object",
          additionalProperties: false,
          description:
            "Instead of schedule. type is webhook, email or github. github runs on GitHub events: events lists the kinds (omit for all) and filters narrows them, e.g. { repo: [\"org/repo\"], label: [\"ready\"] }. The owner copies its key (for github: webhook URL and secret) in the app.",
          properties: {
            type: { type: "string", enum: ["webhook", "email", "github"] },
            events: {
              type: "array",
              items: { type: "string", enum: [...TRIGGER_SOURCES.github.events] },
              description: "github only: the GitHub event kinds that start the routine.",
            },
            filters: {
              type: "object",
              additionalProperties: false,
              description: "github only: each key keeps an event only when one of its values matches.",
              properties: Object.fromEntries(TRIGGER_SOURCES.github.filters.map((key) => [key, { type: "array", items: { type: "string" } }])),
            },
          },
          required: ["type"],
        },
        enabled: {
          type: "boolean",
          description:
            "true starts it on its schedule; false creates it paused. Omit for active. Pause and resume are propose_routine_action.",
        },
        for_bot_id: {
          type: "string",
          description:
            "Only to schedule for ANOTHER bot in your section: its id from list_bots. Omit for yourself. The routine then belongs to that bot.",
        },
        quote: PERSON_QUOTE,
      },
      required: ["name", "instructions"],
    },
  };

/** #4250 (S4): propose_routine on a server linked to Perspicax, where a
 * routine can start when a watched product resource changes. A solo server
 * never receives those events, so its catalog keeps DEF_PROPOSE_ROUTINE
 * without the product trigger (an option that cannot work is not offered). */
export function withProductTrigger(def: typeof DEF_PROPOSE_ROUTINE): typeof DEF_PROPOSE_ROUTINE {
  const trigger = def.inputSchema.properties.trigger;
  return {
    ...def,
    inputSchema: {
      ...def.inputSchema,
      properties: {
        ...def.inputSchema.properties,
        trigger: {
          ...trigger,
          description: trigger.description.replace("type is webhook, email or github.", "type is webhook, email, github or product.")
            + " product runs when a resource the person watches in Perspicax changes (no turn before): resources lists the watched URIs, e.g. [\"perspicax://cw/boards/12/open\"]; nothing to set up.",
          properties: {
            ...trigger.properties,
            type: { type: "string", enum: [...trigger.properties.type.enum, "product"] },
            resources: {
              type: "array",
              items: { type: "string" },
              description: "product only: the watched URIs (perspicax://...) whose change starts the routine.",
            },
          },
        },
      },
    },
  } as typeof DEF_PROPOSE_ROUTINE;
}

export const DEF_PROPOSE_ROUTINE_ACTION = {
    name: "propose_routine_action",
    description:
      "Prepare a user-requested change to one of this bot's existing routines (pause, resume, update name/instructions/schedule, delete, rotate webhook key). Use list_routines first to get the routine id. Follows this bot's Ask or Auto mode. The person's own AI client edits without a card via sagax_routine_update. For ANOTHER bot's routine in your section, pass its id (list_bots) as for_bot_id; the routine keeps its owner." + SELF_CHANGE_OUTCOME,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        routine_id: { type: "string", minLength: 1, description: "Routine id from list_routines." },
        for_bot_id: {
          type: "string",
          description:
            "Only for ANOTHER bot's routine in your section: its id from list_bots (that bot's list_routines gives the routine id). Omit for your own.",
        },
        action: {
          type: "string",
          enum: ["update", "pause", "resume", "run_now", "delete", "rotate_webhook_key"],
          description: "The requested action. Supply changes only for update. rotate_webhook_key replaces the key of a webhook, email or GitHub trigger.",
        },
        changes: {
          type: "object",
          additionalProperties: false,
          properties: ROUTINE_FIELDS_SCHEMA,
          description: "Fields to change when action is update. Omit for every other action.",
        },
        quote: PERSON_QUOTE,
      },
      required: ["routine_id", "action"],
    },
  };

export const ROUTINES_TOOL_NAMES: ReadonlySet<string> = new Set(['list_routines', 'run_routine', 'propose_routine', 'propose_routine_action', 'event_subscriptions'] as const);

/** Handle a tool of this family, or return null when the name is not ours. */
export async function callRoutinesTool(name: string, args: Json, context: ToolCallContext): Promise<ToolCallResult | null> {
  const { botId: BOT_ID, threadId: THREAD_ID } = context;
  const { api } = context.client;
  if (!ROUTINES_TOOL_NAMES.has(name)) return null;
  if (name === "list_routines") {
    // 2026-10-29: a page of short rows, or one routine in full
    // (shared/routine-listing.ts: a bot read back 3 of its 23 routines)
    const query = new URLSearchParams({ fromBotId: BOT_ID, fromThreadId: THREAD_ID });
    const routineId = typeof args.routine_id === "string" ? args.routine_id.trim() : "";
    if (routineId) query.set("routineId", routineId);
    for (const field of ["offset", "limit"] as const) {
      if (typeof args[field] === "number" && Number.isFinite(args[field])) query.set(field, String(args[field]));
    }
    if (typeof args.folder === "string" && args.folder.trim()) query.set("folder", args.folder.trim());
    const r = await api(`/api/internal/routines?${query.toString()}`);
    const now = typeof r.now === "string" ? r.now : new Date().toISOString();
    const timeZone = typeof r.timeZone === "string" && r.timeZone ? r.timeZone : "local computer timezone";
    if (routineId) {
      return { text: `Routine ${routineId} (current time: ${now}; timezone: ${timeZone}):\n${JSON.stringify(r.routine ?? null)}` };
    }
    const page: RoutinePage = {
      total: typeof r.total === "number" ? r.total : Array.isArray(r.routines) ? r.routines.length : 0,
      offset: typeof r.offset === "number" ? r.offset : 0,
      nextOffset: typeof r.nextOffset === "number" ? r.nextOffset : null,
      routines: Array.isArray(r.routines) ? r.routines as RoutinePage["routines"] : [],
    };
    return {
      text: formatRoutinePage(page, {
        now, timeZone,
        readOne: "list_routines with routine_id gives one routine's whole instructions and last run",
        next: "call list_routines with offset {offset}",
      }),
    };
  }
  if (name === "run_routine") {
    const routineId = String(args.routine_id ?? "").trim();
    if (!routineId) return { text: "run_routine needs routine_id.", isError: true };
    const r = await api("/api/internal/routine-run", {
      method: "POST",
      body: JSON.stringify({ fromBotId: BOT_ID, fromThreadId: THREAD_ID, routineId, ...(args.action === "check" ? { action: "check" } : {}) }),
    });
    if (args.action === "check") return { text: JSON.stringify(r) };
    // 2026-11-01: the server's receipt names the routine, its bot, where the
    // run stands and where to follow it; pass it on to the person as it is.
    if (typeof r.message === "string" && typeof r.routineName === "string") {
      return { text: `${r.message} Tell the person exactly this: what started and where to follow it.` };
    }
    const note = typeof r.message === "string" ? ` ${r.message}` : " It runs on its own.";
    return { text: `${r.alreadyRunning === true ? "Joined the run already under way" : "Started a run"} of routine ${routineId}${typeof r.runId === "string" ? ` (run ${r.runId})` : ""}.${note} Check list_routines for the result.` };
  }
  if (name === "event_subscriptions") {
    const action = typeof args.action === "string" && args.action ? args.action : "list";
    const body: Record<string, unknown> = { fromBotId: BOT_ID, fromThreadId: THREAD_ID, action };
    if (Array.isArray(args.events)) body.events = args.events;
    if (typeof args.url === "string") body.url = args.url;
    if (typeof args.routine_id === "string") body.routineId = args.routine_id;
    if (typeof args.subscription_id === "string") body.subscriptionId = args.subscription_id;
    const r = await api("/api/internal/event-subscriptions", { method: "POST", body: JSON.stringify(body) });
    return { text: JSON.stringify(r) };
  }
  if (name === "propose_routine") {
    const { fields: routine, error: scheduleError } = routineFields(args);
    if (scheduleError) return { text: scheduleError, isError: true };
    const hasSchedule = routine.schedule !== undefined;
    const hasTrigger = routine.trigger !== undefined;
    if (!routine.name || !routine.instructions || hasSchedule === hasTrigger) {
      return { text: "propose_routine needs a name, instructions, and exactly one of schedule or trigger.", isError: true };
    }
    const forBotId = String(args.for_bot_id ?? "").trim();
    const r = await api("/api/internal/routine-requests", {
      method: "POST",
      body: JSON.stringify({
        fromBotId: BOT_ID,
        fromThreadId: THREAD_ID,
        action: "create",
        routine,
        // JSON.stringify drops the key entirely when no target was named
        forBotId: forBotId || undefined,
        ...(typeof args.quote === "string" ? { quote: args.quote } : {}),
      }),
    });
    return confirmationResult(r, `the new routine “${routine.name}”`);
  }
  if (name === "propose_routine_action") {
    const routineId = String(args.routine_id ?? "").trim();
    const action = routineAction(args.action);
    if (!routineId || !action) {
      return { text: "propose_routine_action needs a routine_id and supported action.", isError: true };
    }
    const forBotId = String(args.for_bot_id ?? "").trim();
    const body: Json = {
      fromBotId: BOT_ID,
      fromThreadId: THREAD_ID,
      action,
      routineId,
      // JSON.stringify drops the key entirely when no target was named
      ...(forBotId ? { forBotId } : {}),
      ...(typeof args.quote === "string" ? { quote: args.quote } : {}),
    };
    if (action === "update") {
      if (!jsonRecord(args.changes)) {
        return { text: "The update action needs at least one field in changes.", isError: true };
      }
      const { fields: changes, error: scheduleError } = routineFields(args.changes);
      if (scheduleError) return { text: scheduleError, isError: true };
      if (Object.hasOwn(changes, "enabled")) {
        return { text: "Pause and resume are their own actions. Do not set enabled in changes.", isError: true };
      }
      if (Object.hasOwn(changes, "trigger")) {
        return { text: "A trigger cannot be retargeted. Use rotate_webhook_key to rotate its key.", isError: true };
      }
      if (!Object.keys(changes).length) {
        return { text: "The update action needs at least one supported field in changes.", isError: true };
      }
      body.changes = changes;
    } else if (args.changes !== undefined) {
      return { text: `The ${action} action does not accept changes.`, isError: true };
    }
    const r = await api("/api/internal/routine-requests", {
      method: "POST",
      body: JSON.stringify(body),
    });
    return confirmationResult(r, `${action.replace("_", " ")} on routine ${routineId}`);
  }
  return null;
}

