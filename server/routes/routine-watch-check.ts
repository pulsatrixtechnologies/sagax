// "Check now" in the routine editor (2026-10-26):
//
//   POST /api/routines/watch-check   { botId, precheck, routineId?, runOn? }
//
// One reading of a watch (server/routines/routine-watch.ts) where the routine would
// read it, no model, no state kept. The same rights as saving a routine of
// that bot.
import { parseRoutinePrecheck } from "../routines/routine-precheck.ts";
import type { RoutineWatchDeps, WatchRoutine } from "../routines/routine-watch.ts";
import { previewWatch } from "../routines/routine-watch.ts";
import type { RequestAuth } from "../auth/request-auth.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface RoutineWatchCheckRouteDeps {
  watchDeps: RoutineWatchDeps;
  hasBot: (botId: string) => boolean;
  /** An error message when this viewer cannot see the target bot, else null. */
  hiddenTarget: (auth: RequestAuth, path: string, botId: string) => string | null;
  needsRun: (auth: RequestAuth, botId: string) => boolean;
  needsRunBody: unknown;
  routine: (routineId: string, botId: string) => { id: string; runOn?: string; runAs?: string; botId: string } | undefined;
  effectiveRunAs: (routine: { runAs?: string; botId: string }) => string | undefined;
  actorPrincipalId: (auth: RequestAuth) => string | undefined;
}

export function createRoutineWatchCheckRoutes(deps: RoutineWatchCheckRouteDeps): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    if (path !== "/api/routines/watch-check" || method !== "POST") return PASS;
    const body = await readBody(req) as { botId?: unknown; precheck?: unknown; routineId?: unknown; runOn?: unknown } | null;
    const botId = typeof body?.botId === "string" ? body.botId : "";
    const hidden = deps.hiddenTarget(auth, path, botId);
    if (hidden || !deps.hasBot(botId)) return json(res, 404, { error: hidden ?? "no such bot" });
    if (deps.needsRun(auth, botId)) return json(res, 403, deps.needsRunBody);
    let watch;
    try {
      watch = parseRoutinePrecheck(body?.precheck);
    } catch (error) {
      return json(res, 400, { error: error instanceof Error ? error.message : String(error) });
    }
    if (watch.kind !== "watch") return json(res, 400, { error: "Choose a watch to check" });
    const existing = typeof body?.routineId === "string" ? deps.routine(body.routineId, botId) : undefined;
    const runAs = existing ? deps.effectiveRunAs(existing) : deps.actorPrincipalId(auth);
    const routine = {
      id: existing?.id ?? "preview", botId,
      ...(runAs ? { runAs } : {}),
      runOn: body?.runOn === "cloud" ? "cloud" : existing?.runOn ?? "maus",
    } as WatchRoutine;
    return json(res, 200, await previewWatch(deps.watchDeps, routine, watch));
  };
}
