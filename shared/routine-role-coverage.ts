/** 2026-11-05 (visible roles, batch 4): what the routine editor's "Au nom
 * de" field reads (GET /api/bots/:id/roles/routine-coverage). The run-as
 * person's held roles (live listing), the routine's standing mandate and
 * server profiles (Flow `describe` of its recipe; a non-Flow routine has an
 * empty mandate) and that person's logged refusals for this bot. The client
 * recomputes the coverage of any held role with `roleCoverage`. */
import type { HeldRole, RoleCoverage, RoleRefusalRecord } from "./perspicax-roles.ts";
import { ME_ROLE, roleCoverage, routineDefaultRole } from "./perspicax-roles.ts";

export interface RoutineRoleCoverageAnswer {
  /** The run-as person's roles, held now. */
  held: HeldRole[];
  /** Flow standing mandate items (MANDATE_WRITES keys, or other ids). */
  mandate: string[];
  /** Flow `server_profiles`, in order. */
  serverProfiles: string[];
  /** The Flow recipe named by the routine's prompt, when there is one. */
  recipe?: string;
  /** This person's refusals for this bot, never another person's. */
  refusals: RoleRefusalRecord[];
  /** The routine's default role (`routineDefaultRole`). */
  suggested: string;
  /** The slug the coverage below is for. */
  selected: string;
  coverage: RoleCoverage;
  /** Flow could not describe the recipe: the mandate is unknown. */
  flowError?: string;
}

/** Build the answer from the probe's facts. `selected` undefined: the
 * routine's saved choice, else the suggestion. */
export function routineRoleCoverageAnswer(input: {
  held: readonly HeldRole[];
  mandate: readonly string[];
  serverProfiles: readonly string[];
  refusals: readonly RoleRefusalRecord[];
  recipe?: string;
  selected?: string;
  flowError?: string;
}): RoutineRoleCoverageAnswer {
  const suggested = routineDefaultRole(input.held, input.mandate, input.serverProfiles, input.refusals);
  const selected = input.selected ?? suggested ?? ME_ROLE;
  return {
    held: [...input.held],
    mandate: [...input.mandate],
    serverProfiles: [...input.serverProfiles],
    ...(input.recipe ? { recipe: input.recipe } : {}),
    refusals: [...input.refusals],
    suggested,
    selected,
    coverage: roleCoverage(selected, input.held, input.mandate, input.refusals),
    ...(input.flowError ? { flowError: input.flowError } : {}),
  };
}
