// POST /api/internal/routine-run: the run_routine tool starts one of the
// calling bot's routines now. Behind the agents capability (see
// internal-route.ts).
//
// The bot is not the authority: the person it speaks for must pass the same
// rule as POST /api/routines/:id/run (routineRunNowAllowed: on an
// organization server, the bot's owner, the person the routine runs as, or an
// admin), and the run is written to the activity log as that route writes it.
// Without that check, anyone talking to a bot could start its owner's
// routines, which run under the owner's credentials.
import type { InternalRouteHandler } from "./internal-route.ts";
import { PASS } from "./table.ts";

/** The Run now rule (JC, 2026-10-08), for a caller already known as a person
 * or not. `organization` false (a solo server) or `person` false (the
 * operator, the loopback) keeps the bot-level rule: allowed. */
export function routineRunNowAllowed(input: {
  organization: boolean;
  /** The caller is a person (a session, or the person a bot speaks for). */
  person: boolean;
  principalId?: string;
  /** An organization admin, or a holder of routines.runNowAny. */
  admin: boolean;
  botOwner?: string;
  runAs?: string;
}): boolean {
  if (!input.organization || !input.person) return true;
  if (input.admin) return true;
  const principalId = input.principalId?.trim();
  if (!principalId) return false;
  return principalId === input.botOwner || principalId === input.runAs;
}

export interface RoutineRunInternalDeps<R extends { id: string; botId: string }, Run extends { id: string }> {
  /** The source conversation belongs to the calling bot. */
  ownsThread(botId: string, threadId: string): boolean;
  routines(): readonly R[];
  /** The person this turn speaks for, if any. */
  speaker(threadId: string): string | undefined;
  /** routineRunNowAllowed for that person (undefined: nobody speaks). */
  mayRunNow(principalId: string | undefined, routine: R): boolean;
  inFlight(routineId: string): boolean;
  /** The run of this routine that is queued, running or waiting, if any:
   * run_routine answers with it instead of refusing (one pass at a time). */
  inFlightRun?(routineId: string): Run | undefined;
  runNow(routineId: string): Run | null | undefined;
  /** The same activity-log row as a Run now from the app. */
  audit(routine: R, run: Run, principalId: string | undefined): void;
}

export function createRoutineRunInternalRoutes<R extends { id: string; botId: string }, Run extends { id: string }>(deps: RoutineRunInternalDeps<R, Run>): InternalRouteHandler {
  return async ({ res, path, method, json, capability, readBody }) => {
    if (!(method === "POST" && path === "/api/internal/routine-run")) return PASS;
    const body = await readBody();
    if (!deps.ownsThread(capability.botId, capability.threadId)) {
      return json(res, 403, { error: "source conversation does not belong to sender" });
    }
    const routineId = typeof body.routineId === "string" ? body.routineId : "";
    const target = deps.routines().find((routine) => routine.id === routineId && routine.botId === capability.botId);
    if (!target) return json(res, 404, { error: "no such routine on this bot" });
    const speaker = deps.speaker(capability.threadId);
    if (!deps.mayRunNow(speaker, target)) {
      return json(res, 403, { error: "Only the bot's owner, the person this routine runs as or an admin can run it now.", code: "run_now_not_allowed", permission: "routines.runNowAny" });
    }
    if (deps.inFlight(target.id)) {
      const current = deps.inFlightRun?.(target.id);
      if (!current) return json(res, 409, { error: "A run of this routine is already in progress.", code: "run_in_flight" });
      // Never a second pass of the same routine, and never a refusal the bot
      // turns into a failure: the run already under way is the answer.
      return json(res, 200, { runId: current.id, alreadyRunning: true,
        message: "A run of this routine is already queued or in progress; no second run was started. Its result reports as usual." });
    }
    const run = deps.runNow(target.id);
    if (!run) return json(res, 404, { error: "no such routine on this bot" });
    deps.audit(target, run, speaker);
    return json(res, 201, { runId: run.id,
      message: "Queued. It starts as soon as the bot and the conversation it reports into are free (right away when they are), and its result reports as usual." });
  };
}
