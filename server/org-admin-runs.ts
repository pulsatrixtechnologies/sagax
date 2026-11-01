// The routines calendar of the Perspicax console (2026-10-11): every run in
// a window, the past ones from the run log and the planned ones computed
// from each routine's schedule, for everyone the caller may see.
//
//   GET routines/runs?from&to&scope=mine|team|all&bot&routine&state&limit&cursor
//
// Who sees what is the console's reach and the Automations scope together
// (server/routine-scope.ts, shared/routine-scope.ts):
//   mine  the routines whose bot the caller owns or that run as them
//   team  mine, plus every routine whose bot owner or run-as person is in
//         one of the caller's teams, or whose bot is shared with one of
//         them; for a manager also every routine in their reach. Managers,
//         admins and holders of routines.viewTeam or routines.viewAll.
//   all   every routine: admins and holders of routines.viewAll.
// A run outside the caller's console reach (admin everyone, manager their
// teams, member their own) comes `redacted`: its thread is not named. No
// prompt, output or message is ever answered.
import { isRoutineScope, ROUTINE_SCOPE_PERMISSION, type RoutineScope } from "../shared/routine-scope.ts";
import type { AdminPerson } from "./org-admin-routes.ts";
import {
  badRequest,
  enumParam,
  fail,
  isAnswer,
  matchesQuery,
  ok,
  pageOf,
  parsePage,
  type ConsoleContext,
  type ConsoleRoute,
} from "./org-admin-console.ts";
import { runReason, runStatus } from "./org-admin-routines.ts";
import type { Routine, RoutineRun, RoutineSchedule } from "./routines.ts";

const DAY_MS = 24 * 60 * 60_000;
export const RUNS_WINDOW_MAX_DAYS = 92;
export const RUNS_WINDOW_DEFAULT_DAYS = 7;
/** Planned occurrences of one routine in one window (an every-minute
 * routine over 92 days would be 132,480). */
export const PLANNED_PER_ROUTINE_MAX = 500;
/** Every item of one window, past and planned. */
export const RUNS_ITEMS_MAX = 20_000;
export const RUNS_PAGE_DEFAULT = 200;
export const RUNS_PAGE_MAX = 500;

export const RUN_STATES = ["ok", "failed", "skipped", "running", "planned"] as const;
export type RunState = (typeof RUN_STATES)[number];

export interface RoutineRunsDeps {
  routines(): Routine[];
  /** Runs scheduled in [from, to]. */
  runs(from: number, to: number): RoutineRun[];
  bot(botId: string): { id: string; name: string; ownerPrincipalId: string } | null;
  /** The person a routine or run runs as (its runAs, else the bot's owner). */
  runAs(value: { botId: string; runAs?: string }): string | null;
  person(principalId: string): AdminPerson;
  /** The teams of the bot's owner and run-as person, and the teams the bot
   * is shared with (server/index.ts routineScopeFacts). */
  teams(value: { botId: string; runAs?: string }): string[];
  /** Whether the caller holds the Automations scope permissions. */
  permissions(principalId: string): { viewTeam: boolean; viewAll: boolean };
  /** The next occurrence strictly after `after` (routines.ts nextOccurrence,
   * in the routines' zone). */
  next(schedule: RoutineSchedule, after: number): number | null;
}

/** `from` or `to`: milliseconds, an ISO date (a `to` date covers that whole
 * UTC day) or an ISO date and time. */
function instant(value: string | null, end: boolean): number | null | undefined {
  if (value === null || value === "") return undefined;
  if (/^\d{1,15}$/.test(value)) return Number(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const at = Date.parse(`${value}T00:00:00Z`);
    return Number.isFinite(at) ? at + (end ? DAY_MS - 1 : 0) : null;
  }
  if (/^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:?\d{2})?$/.test(value)) {
    const at = Date.parse(value);
    return Number.isFinite(at) ? at : null;
  }
  return null;
}

/** The window of a request, or the refusal. */
export function runsWindow(params: URLSearchParams, now: number): { from: number; to: number } | string {
  const from = instant(params.get("from"), false);
  const to = instant(params.get("to"), true);
  if (from === null || to === null) return "from and to are milliseconds, an ISO date or an ISO date and time.";
  const start = from ?? (to !== undefined ? to - RUNS_WINDOW_DEFAULT_DAYS * 2 * DAY_MS : now - RUNS_WINDOW_DEFAULT_DAYS * DAY_MS);
  const end = to ?? start + RUNS_WINDOW_DEFAULT_DAYS * 2 * DAY_MS;
  if (end <= start) return "to is after from.";
  if (end - start > RUNS_WINDOW_MAX_DAYS * DAY_MS) return `The window is at most ${RUNS_WINDOW_MAX_DAYS} days.`;
  return { from: start, to: end };
}

/** The scopes this caller may ask for. */
export function allowedRunScopes(ctx: ConsoleContext, permissions: { viewTeam: boolean; viewAll: boolean }): Record<RoutineScope, boolean> {
  const admin = ctx.viewer.orgAdmin;
  const manager = ctx.viewer.role === "manager" || admin;
  return { mine: true, team: manager || permissions.viewTeam || permissions.viewAll, all: admin || permissions.viewAll };
}

export interface RunItem {
  id: string;
  routineId: string;
  routineName: string;
  botId: string;
  botName: string;
  owner: AdminPerson;
  runAs: AdminPerson | null;
  startedAt: number;
  endedAt: number | null;
  durationMs: number | null;
  state: RunState;
  planned: boolean;
  trigger: "schedule" | "manual" | "webhook" | "proactive" | null;
  reason: string | null;
  label: string | null;
  threadId: string | null;
  redacted?: true;
}

const runAt = (run: RoutineRun) => run.startedAt ?? run.scheduledFor ?? run.createdAt;

export function routineRunsRoutes(deps: RoutineRunsDeps): ConsoleRoute[] {
  return [{
    method: "GET",
    path: "routines/runs",
    min: "employee",
    handle(ctx) {
      const params = ctx.url.searchParams;
      const page = parsePage(params, { limit: RUNS_PAGE_DEFAULT, max: RUNS_PAGE_MAX });
      if (isAnswer(page)) return page;
      const window = runsWindow(params, ctx.now());
      if (typeof window === "string") return badRequest(window);
      const rawScope = params.get("scope");
      if (rawScope !== null && rawScope !== "" && !isRoutineScope(rawScope)) return badRequest("scope is mine, team or all.");
      const scope: RoutineScope = isRoutineScope(rawScope) ? rawScope : "mine";
      const state = enumParam(params, "state", RUN_STATES);
      if (isAnswer(state)) return state;
      const botFilter = params.get("bot") || null;
      const routineFilter = params.get("routine") || null;
      const viewer = ctx.viewer;
      const permissions = deps.permissions(viewer.principalId);
      if (!allowedRunScopes(ctx, permissions)[scope]) {
        const permission = ROUTINE_SCOPE_PERMISSION[scope as Exclude<RoutineScope, "mine">];
        return fail(403, "routine_scope_not_allowed", `Seeing these routines needs the ${permission} permission.`, { permission });
      }
      const viewerTeams = new Set(viewer.teams.map((team) => team.id));
      const manager = viewer.role === "manager" && !viewer.orgAdmin;
      const now = ctx.now();

      // Who a routine or run belongs to, and whether the caller sees it.
      const facts = (value: { botId: string; runAs?: string }) => {
        const bot = deps.bot(value.botId);
        const owner = bot?.ownerPrincipalId ?? "";
        const runAs = deps.runAs(value);
        const own = owner === viewer.principalId || runAs === viewer.principalId;
        const reach = viewer.orgAdmin || own || (manager && (ctx.inReach(owner) || ctx.inReach(runAs)));
        const included = scope === "all" ? true
          : own || (scope === "team" && (reach || deps.teams(value).some((id) => viewerTeams.has(id))));
        return { bot, owner, runAs, reach, included };
      };

      const items: RunItem[] = [];
      let truncated = false;
      const push = (item: RunItem) => {
        if (items.length >= RUNS_ITEMS_MAX) { truncated = true; return; }
        items.push(item);
      };
      const keep = (item: Pick<RunItem, "botId" | "routineId" | "state" | "routineName" | "botName" | "owner" | "runAs">) =>
        (!botFilter || item.botId === botFilter) && (!routineFilter || item.routineId === routineFilter) && (!state || item.state === state)
        && matchesQuery(page.q, item.routineName, item.botName, item.owner.name, item.runAs?.name);

      // Past and current runs: those that overlap the window.
      const scheduled = new Set<string>();
      for (const run of deps.runs(window.from - DAY_MS, window.to)) {
        const start = runAt(run);
        const end = run.finishedAt ?? null;
        if (start > window.to || (end ?? Math.max(start, now)) < window.from) continue;
        scheduled.add(`${run.routineId}:${run.scheduledFor}`);
        const seen = facts(run);
        if (!seen.included) continue;
        const item: RunItem = {
          id: run.id,
          routineId: run.routineId,
          routineName: run.routineName,
          botId: run.botId,
          botName: seen.bot?.name ?? run.botId,
          owner: deps.person(seen.owner),
          runAs: seen.runAs ? deps.person(seen.runAs) : null,
          startedAt: start,
          endedAt: end,
          durationMs: end !== null && run.startedAt !== undefined ? Math.max(0, end - run.startedAt) : null,
          state: runStatus(run.status),
          planned: false,
          trigger: run.triggerSource ?? (run.manual ? "manual" : "schedule"),
          ...runReason(run, ctx.locale),
          threadId: seen.reach ? run.threadId ?? null : null,
          ...(seen.reach ? {} : { redacted: true as const }),
        };
        if (keep(item)) push(item);
      }

      // Planned occurrences: from now (or the window's start) to its end.
      const plannedFrom = Math.max(now, window.from);
      if (plannedFrom <= window.to) {
        for (const routine of deps.routines()) {
          if (!routine.enabled || routine.suspended) continue;
          const seen = facts(routine);
          if (!seen.included) continue;
          const base = {
            routineId: routine.id,
            routineName: routine.name,
            botId: routine.botId,
            botName: seen.bot?.name ?? routine.botId,
            owner: deps.person(seen.owner),
            runAs: seen.runAs ? deps.person(seen.runAs) : null,
            state: "planned" as const,
          };
          if (!keep(base)) continue;
          let at = routine.nextRunAt !== null && routine.nextRunAt >= plannedFrom ? routine.nextRunAt : deps.next(routine.schedule, plannedFrom - 1);
          for (let count = 0; at !== null && at <= window.to; count++) {
            if (count >= PLANNED_PER_ROUTINE_MAX) { truncated = true; break; }
            if (!scheduled.has(`${routine.id}:${at}`)) {
              push({
                id: `planned:${routine.id}:${at}`,
                ...base,
                startedAt: at,
                endedAt: null,
                durationMs: routine.durationMinutes * 60_000,
                planned: true,
                trigger: "schedule",
                reason: null,
                label: null,
                threadId: null,
                ...(seen.reach ? {} : { redacted: true as const }),
              });
            }
            const next = deps.next(routine.schedule, at);
            at = next !== null && next > at ? next : null;
          }
        }
      }

      items.sort((a, b) => a.startedAt - b.startedAt || a.routineId.localeCompare(b.routineId) || a.id.localeCompare(b.id));
      return ok({ from: window.from, to: window.to, scope, ...pageOf(items, page), truncated });
    },
  }];
}
