// Visible roles, batch 4 (2026-11-05): the routine editor's "Au nom de"
// field and its coverage preview.
//
//   GET /api/bots/:id/roles/routine-coverage?routineId=&slug=&prompt=
//
// The roles listed are the run-as person's, held now (a live listing on a
// short-lived account connection backed by their routine delegation, never
// a cached catalogue). The refusals counted are that person's for this bot
// only. A new routine (no routineId) lists the signed-in person's roles and
// reads its recipe from `prompt`. Mounted through the `more` hook of
// server/routes/perspicax-roles.ts, which checked the bot first.
import type { RequestAuth } from "../auth/request-auth.ts";
import type { HeldRole, RoleRefusalRecord } from "../../shared/perspicax-roles.ts";
import { routineMandateOf } from "../../shared/perspicax-roles.ts";
import { routineRoleCoverageAnswer } from "../../shared/routine-role-coverage.ts";
import { PASS, type RouteContext } from "./table.ts";

export interface CoverageRoutine {
  id: string;
  botId: string;
  prompt: string;
  target?: string;
  actAs?: string;
  runAs?: string;
}

export interface RoutineRoleCoverageDeps {
  /** The routine, when the person may see it (else undefined: 404). */
  routine(auth: RequestAuth, id: string): CoverageRoutine | undefined;
  /** Whether the person may check this routine (Run now rights). */
  mayCheck(auth: RequestAuth, routine: CoverageRoutine): boolean;
  /** The person the routine runs as. */
  runAsOf(routine: CoverageRoutine): string | undefined;
  /** The Flow recipe a prompt names (routineFlowInput(prompt).routine). */
  recipeOf(prompt: string): string | undefined;
  /** Held roles and the recipe's Flow card, on the person's routine delegation. */
  probe(principalId: string, botId: string, recipe: string | undefined, signal: AbortSignal): Promise<{ held: HeldRole[]; card?: unknown; flowError?: string }>;
  /** This person's logged refusals for this bot. */
  refusals(principalId: string, botId: string): RoleRefusalRecord[];
  timeoutMs?: number;
}

const SLUG = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;

export function routineRoleCoverageRoute(deps: RoutineRoleCoverageDeps) {
  return async (ctx: RouteContext, input: { botId: string; rest: string; actor: string }): Promise<typeof PASS | void> => {
    if (input.rest !== "roles/routine-coverage") return PASS;
    const { res, url, method, json, auth } = ctx;
    if (method !== "GET") return json(res, 405, { error: "method not allowed" });
    const routineId = url.searchParams.get("routineId")?.trim() || "";
    const slugParam = url.searchParams.get("slug");
    if (slugParam !== null && slugParam !== "" && !SLUG.test(slugParam)) return json(res, 400, { error: "slug is a role slug" });
    let principalId: string | undefined = input.actor;
    let prompt = (url.searchParams.get("prompt") ?? "").slice(0, 4_000);
    let saved: string | undefined;
    if (routineId) {
      const routine = deps.routine(auth, routineId);
      if (!routine || routine.botId !== input.botId) return json(res, 404, { error: "no such routine" });
      if (!deps.mayCheck(auth, routine)) return json(res, 403, { error: "Only the bot's owner, the person this routine runs as or an admin can check it.", code: "run_now_not_allowed" });
      if (routine.target === "room-goal") return json(res, 400, { error: "A room goal's bots act with their own roles." });
      principalId = deps.runAsOf(routine);
      prompt = routine.prompt;
      saved = routine.actAs;
    }
    if (!principalId) return json(res, 409, { error: "This routine has no person to run as." });
    const recipe = deps.recipeOf(prompt);
    let probed: Awaited<ReturnType<RoutineRoleCoverageDeps["probe"]>>;
    try {
      probed = await deps.probe(principalId, input.botId, recipe, AbortSignal.timeout(deps.timeoutMs ?? 10_000));
    } catch (error) {
      return json(res, 502, { error: error instanceof Error ? error.message : "Perspicax roles are unavailable." });
    }
    const { mandate, serverProfiles } = probed.card === undefined ? { mandate: [], serverProfiles: [] } : routineMandateOf(probed.card);
    res.setHeader?.("cache-control", "no-store");
    return json(res, 200, routineRoleCoverageAnswer({
      held: probed.held,
      mandate,
      serverProfiles,
      refusals: deps.refusals(principalId, input.botId),
      ...(recipe ? { recipe } : {}),
      ...(slugParam !== null ? { selected: slugParam } : saved !== undefined ? { selected: saved } : {}),
      ...(probed.flowError ? { flowError: probed.flowError } : {}),
    }));
  };
}
