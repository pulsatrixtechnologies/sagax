// Who sees which routines on the Automations page (2026-10-09: "any
// user may view the automation schedule at large; admins see all of them;
// filter by global, team, bot").
//
// Browser-safe: the server computes the scope (server/routines/routine-scope.ts) and
// the app draws the scope control and the filters from these names.
//
//   mine  what the person saw before: the routines of the bots and rooms
//         they see (always allowed)
//   team  mine, plus the routines of the people in their teams and of the
//         bots shared with their teams (routines.viewTeam, or an admin)
//   all   every routine of the organization (routines.viewAll, or an admin)

import type { PermissionKey } from "./permissions.ts";

export const ROUTINE_SCOPES = ["mine", "team", "all"] as const;
export type RoutineScope = (typeof ROUTINE_SCOPES)[number];

export const ROUTINE_SCOPE_STATUSES = ["active", "paused", "failing"] as const;
export type RoutineScopeStatus = (typeof ROUTINE_SCOPE_STATUSES)[number];

/** The permission a wider scope needs (an admin holds both). */
export const ROUTINE_SCOPE_PERMISSION: Readonly<Record<Exclude<RoutineScope, "mine">, PermissionKey>> = {
  team: "routines.viewTeam",
  all: "routines.viewAll",
};

export function isRoutineScope(value: unknown): value is RoutineScope {
  return typeof value === "string" && (ROUTINE_SCOPES as readonly string[]).includes(value);
}

export function isRoutineScopeStatus(value: unknown): value is RoutineScopeStatus {
  return typeof value === "string" && (ROUTINE_SCOPE_STATUSES as readonly string[]).includes(value);
}

/** Active (on and not paused by the server) or paused, and failing when
 * its latest runs failed. */
export function routineScopeStatuses(routine: { enabled: boolean; suspended?: unknown; failureStreak?: number }): RoutineScopeStatus[] {
  const statuses: RoutineScopeStatus[] = [routine.enabled && !routine.suspended ? "active" : "paused"];
  if ((routine.failureStreak ?? 0) > 0) statuses.push("failing");
  return statuses;
}

/** The filters of GET /api/routines and DELETE /api/routine-runs. */
export interface RoutineScopeQuery {
  scope: RoutineScope;
  teamId?: string;
  botId?: string;
  ownerId?: string;
  status?: RoutineScopeStatus;
  /** Clear logs of one routine only (the routine panel's Runs header). */
  routineId?: string;
}

/** A person, a team or a bot one of the filters can pick. */
export interface RoutineScopeChoice {
  id: string;
  name: string;
  avatarUrl?: string;
}

/** What the scoped listing adds next to `routines` and `runs`. */
export interface RoutineScopeInfo {
  /** The scope answered. */
  scope: RoutineScope;
  /** Which scopes this caller may ask for. */
  allowed: Record<RoutineScope, boolean>;
  /** The choices of the filters, over the whole scope (before filtering).
   * Never named `bots`: a member body narrows any `bots` list. */
  facets: { teams: RoutineScopeChoice[]; owners: RoutineScopeChoice[]; botChoices: RoutineScopeChoice[] };
}

/** The query string of a scoped request (empty values left out). */
export function routineScopeSearch(query: RoutineScopeQuery): string {
  const params = new URLSearchParams();
  params.set("scope", query.scope);
  if (query.teamId) params.set("teamId", query.teamId);
  if (query.botId) params.set("botId", query.botId);
  if (query.ownerId) params.set("ownerId", query.ownerId);
  if (query.status) params.set("status", query.status);
  if (query.routineId) params.set("routineId", query.routineId);
  return params.toString();
}
