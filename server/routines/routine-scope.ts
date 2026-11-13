// The scope of the Automations page (2026-10-09): which routines and
// runs a caller may see beyond their own, with the filters of the page.
// Pure: server/index.ts hands in who the caller is and the facts of each
// routine (its bot's owner, its run-as person, their teams, the teams its
// bot is shared with), and serves what comes out on GET /api/routines and
// DELETE /api/routine-runs.
//
// Rules (shared/routine-scope.ts names them):
//   mine  always: what the caller saw before (the routines of the bots and
//         rooms they see, by the private-threads rule); the caller's `mine`
//         predicate decides, unchanged
//   team  routines.viewTeam or an admin: mine, plus every routine whose bot
//         owner or run-as person is in one of the caller's teams, or whose
//         bot is shared with one of the caller's teams
//   all   routines.viewAll or an admin: every routine
// A routine or run outside `mine` comes without its instructions,
// attachments, threads or outputs (`redacted: true`): the schedule at large,
// never someone else's work. `canRun` and `canEdit` come from the existing
// write gates, so a wider scope never opens a write.
// Clear logs clears the caller's own runs (`mine`), or with scope `all` and
// routines.viewAll (or an admin) every run in scope; the filters narrow it.

import { permissionRefusal, type PermissionKey } from "../../shared/permissions.ts";
import {
  isRoutineScope,
  isRoutineScopeStatus,
  ROUTINE_SCOPE_PERMISSION,
  routineScopeStatuses,
  type RoutineScope,
  type RoutineScopeChoice,
  type RoutineScopeInfo,
  type RoutineScopeQuery,
} from "../../shared/routine-scope.ts";
import type { Routine, RoutineRun } from "./routines.ts";

export interface RoutineScopeCaller {
  /** An organization admin, or the operator at this computer. */
  admin: boolean;
  viewTeam: boolean;
  viewAll: boolean;
  /** The teams the caller is in (member or manager). */
  teamIds: readonly string[];
}

/** What the scope needs to know about a routine or a run. */
export interface RoutineScopeFacts {
  /** The bot's owner (principal id); "" when the bot is gone. */
  ownerId: string;
  ownerName: string;
  ownerAvatarUrl?: string;
  /** The person it runs as (its runAs, else the bot's owner). */
  runAsId?: string;
  /** The owner's and run-as person's teams, and the teams the bot is shared with. */
  teamIds: readonly string[];
  bot: { id: string; name: string };
}

export interface RoutineScopeDeps<W extends object> {
  /** The caller's own view (the rule GET /api/routines always had). */
  mine(value: Routine | RoutineRun): boolean;
  facts(value: { botId: string; runAs?: string }): RoutineScopeFacts;
  canRun(routine: Routine): boolean;
  canEdit(routine: Routine): boolean;
  /** The routine as the wire carries it (routineOnWire). */
  wire(routine: Routine): W;
  teamName(teamId: string): string | undefined;
}

export type ScopedRoutine<W extends object> = W & {
  owner: { id: string; name: string; avatarUrl?: string };
  teamIds: string[];
  bot: { id: string; name: string };
  canRun: boolean;
  canEdit: boolean;
  redacted?: true;
};

const ID = /^[\w.:@-]{1,128}$/;

export function allowedRoutineScopes(caller: RoutineScopeCaller): Record<RoutineScope, boolean> {
  return { mine: true, team: caller.admin || caller.viewTeam || caller.viewAll, all: caller.admin || caller.viewAll };
}

/** Read the scope and filters of a request. No `scope` is `mine`, so an
 * older app keeps its listing. */
export function parseRoutineScopeQuery(params: URLSearchParams): RoutineScopeQuery | { error: string; code: "routine_scope_invalid" } {
  const rawScope = params.get("scope");
  if (rawScope !== null && rawScope !== "" && !isRoutineScope(rawScope)) return { error: "scope must be mine, team or all", code: "routine_scope_invalid" };
  const query: RoutineScopeQuery = { scope: isRoutineScope(rawScope) ? rawScope : "mine" };
  for (const key of ["teamId", "botId", "ownerId", "routineId"] as const) {
    const value = params.get(key)?.trim();
    if (!value) continue;
    if (!ID.test(value)) return { error: `${key} is not an id`, code: "routine_scope_invalid" };
    query[key] = value;
  }
  const status = params.get("status");
  if (status) {
    if (!isRoutineScopeStatus(status)) return { error: "status must be active, paused or failing", code: "routine_scope_invalid" };
    query.status = status;
  }
  return query;
}

/** 403 with the missing permission for a scope the caller may not ask for. */
export function routineScopeRefusal(caller: RoutineScopeCaller, scope: RoutineScope): { error: "forbidden"; permission: PermissionKey; message: string; code: "routine_scope_not_allowed" } | null {
  if (scope === "mine" || allowedRoutineScopes(caller)[scope]) return null;
  return { ...permissionRefusal(ROUTINE_SCOPE_PERMISSION[scope]), code: "routine_scope_not_allowed" };
}

/** Whether a routine or run with these facts is in the scope. */
export function inRoutineScope(scope: RoutineScope, caller: RoutineScopeCaller, mine: boolean, facts: Pick<RoutineScopeFacts, "teamIds">): boolean {
  if (mine) return true;
  if (scope === "all") return allowedRoutineScopes(caller).all;
  if (scope === "team") {
    if (!allowedRoutineScopes(caller).team) return false;
    return facts.teamIds.some((id) => caller.teamIds.includes(id));
  }
  return false;
}

/** Active or paused, and failing (shared/routine-scope.ts). */
export const routineScopeStatus = routineScopeStatuses;

function matchesFacts(query: RoutineScopeQuery, botId: string, facts: RoutineScopeFacts): boolean {
  if (query.botId && botId !== query.botId) return false;
  if (query.ownerId) {
    const wanted = query.ownerId.toLowerCase();
    if (facts.ownerId.toLowerCase() !== wanted && facts.runAsId?.toLowerCase() !== wanted) return false;
  }
  if (query.teamId && !facts.teamIds.includes(query.teamId)) return false;
  return true;
}

const REDACTED_ROUTINE_FIELDS = ["requires", "prompt", "attachments", "sourceThreadId", "resultsThreadId"] as const;
const REDACTED_RUN_FIELDS = [
  "requires", "readiness", "readinessEngine", "prompt", "attachments", "output", "attention", "denials",
  "executionThreadId", "sourceThreadId", "resultsThreadId", "threadId", "webhookId", "deliveryId",
  // what the organization memory told the person it runs as
  "memoryHint",
  // the teammate threads its work went to (2026-11-03)
  "handedTo",
] as const;

/** Someone else's run: its status and timing, never its work. */
export function redactRun<R extends object>(run: R): R & { redacted: true } {
  const out = { ...run } as Record<string, unknown>;
  for (const key of REDACTED_RUN_FIELDS) delete out[key];
  if (typeof out.error === "string") out.error = out.error.slice(0, 300);
  return { ...(out as R), redacted: true };
}

function redactRoutine<W extends object>(routine: W): W {
  const out = { ...routine } as Record<string, unknown>;
  for (const key of REDACTED_ROUTINE_FIELDS) delete out[key];
  out.prompt = "";
  // #4098: what waits on its person is theirs, never shown to a wider scope
  if ("needsPerson" in out) out.needsPerson = null;
  return out as W;
}

function choices(map: Map<string, RoutineScopeChoice>): RoutineScopeChoice[] {
  return [...map.values()].sort((a, b) => a.name.toLocaleLowerCase().localeCompare(b.name.toLocaleLowerCase()) || a.id.localeCompare(b.id));
}

/** The listing of GET /api/routines for this query and caller. */
export function scopedRoutineListing<W extends object>(
  query: RoutineScopeQuery,
  caller: RoutineScopeCaller,
  routines: readonly Routine[],
  runs: readonly RoutineRun[],
  deps: RoutineScopeDeps<W>,
): { routines: ScopedRoutine<W>[]; runs: Array<RoutineRun | (RoutineRun & { redacted: true })> } & RoutineScopeInfo {
  const teams = new Map<string, RoutineScopeChoice>();
  const owners = new Map<string, RoutineScopeChoice>();
  const botChoices = new Map<string, RoutineScopeChoice>();
  if (query.scope === "team") for (const id of caller.teamIds) teams.set(id, { id, name: deps.teamName(id) || id });

  const shown = new Map<string, Routine>();
  const listed: ScopedRoutine<W>[] = [];
  for (const routine of routines) {
    const mine = deps.mine(routine);
    const facts = deps.facts(routine);
    if (!inRoutineScope(query.scope, caller, mine, facts)) continue;
    // The filters' choices cover the whole scope.
    if (facts.ownerId) owners.set(facts.ownerId, { id: facts.ownerId, name: facts.ownerName || facts.ownerId, ...(facts.ownerAvatarUrl ? { avatarUrl: facts.ownerAvatarUrl } : {}) });
    botChoices.set(routine.botId, { id: routine.botId, name: facts.bot.name || routine.botId });
    if (query.scope !== "team") for (const id of facts.teamIds) if (!teams.has(id)) teams.set(id, { id, name: deps.teamName(id) || id });
    if (!matchesFacts(query, routine.botId, facts)) continue;
    if (query.status && !routineScopeStatus(routine).includes(query.status)) continue;
    shown.set(routine.id, routine);
    const wire = deps.wire(routine);
    listed.push({
      ...(mine ? wire : redactRoutine(wire)),
      owner: { id: facts.ownerId, name: facts.ownerName, ...(facts.ownerAvatarUrl ? { avatarUrl: facts.ownerAvatarUrl } : {}) },
      teamIds: [...facts.teamIds],
      bot: { ...facts.bot },
      canRun: mine && deps.canRun(routine),
      canEdit: mine && deps.canEdit(routine),
      ...(mine ? {} : { redacted: true as const }),
    });
  }

  const known = new Set(routines.map((routine) => routine.id));
  const unfiltered = query.scope === "mine" && !query.botId && !query.ownerId && !query.teamId && !query.status;
  const listedRuns: Array<RoutineRun | (RoutineRun & { redacted: true })> = [];
  for (const run of runs) {
    // A run follows its routine; a run whose routine is gone is judged alone.
    if (known.has(run.routineId)) {
      // A run the caller saw before stays in the plain listing even when its
      // routine is not shown (an older app reads exactly what it did).
      if (!shown.has(run.routineId) && !(unfiltered && deps.mine(run))) continue;
    } else {
      if (query.status) continue;
      const facts = deps.facts(run);
      if (!inRoutineScope(query.scope, caller, deps.mine(run), facts) || !matchesFacts(query, run.botId, facts)) continue;
    }
    listedRuns.push(deps.mine(run) ? run : redactRun(run));
  }

  return {
    routines: listed,
    runs: listedRuns,
    scope: query.scope,
    allowed: allowedRoutineScopes(caller),
    facets: { teams: choices(teams), owners: choices(owners), botChoices: choices(botChoices) },
  };
}

/** Which saved runs Clear logs removes for this query and caller: the
 * caller's own, or every run in scope with routines.viewAll (or an admin)
 * and scope `all`; the filters narrow it. */
export function routineRunClearable(
  query: RoutineScopeQuery,
  caller: RoutineScopeCaller,
  routines: readonly Routine[],
  deps: Pick<RoutineScopeDeps<object>, "mine" | "facts">,
): (run: RoutineRun) => boolean {
  const byId = new Map(routines.map((routine) => [routine.id, routine]));
  const wide = query.scope === "all" && allowedRoutineScopes(caller).all;
  return (run) => {
    if (!deps.mine(run) && !wide) return false;
    if (query.routineId && run.routineId !== query.routineId) return false;
    const facts = deps.facts(run);
    if (!matchesFacts(query, run.botId, facts)) return false;
    if (query.status) {
      const routine = byId.get(run.routineId);
      if (!routine || !routineScopeStatus(routine).includes(query.status)) return false;
    }
    return true;
  };
}

/** What Mark all as read answers: the ids it stamped, how many, and the
 * stamp, never a run's contents. `runs` stays an empty list for phone
 * builds that still read that key. */
export function routineRunsSeenAnswer(stamped: readonly Pick<RoutineRun, "id" | "seenAt">[]): {
  ids: string[];
  count: number;
  seenAt?: number;
  runs: [];
} {
  const seenAt = stamped.find((run) => typeof run.seenAt === "number")?.seenAt;
  return { ids: stamped.map((run) => run.id), count: stamped.length, ...(seenAt !== undefined ? { seenAt } : {}), runs: [] };
}
