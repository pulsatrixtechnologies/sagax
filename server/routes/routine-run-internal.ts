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

/** The Run now rule (2026-10-08), for a caller already known as a person
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
  /** `startedBy` "person": a person this turn speaks for asked for it. */
  runNow(routineId: string, startedBy?: "person"): Run | null | undefined;
  /** Where the run stands (its place in its bot's queue, why it waits). */
  standing?(runId: string): RoutineRunStandingLike | null;
  /** The bot that runs it, and where its card and report go. */
  describe?(routine: R, run: Run): { botName: string; reportsTo: string };
  /** The same activity-log row as a Run now from the app. */
  audit(routine: R, run: Run, principalId: string | undefined): void;
}

export interface RoutineRunStandingLike {
  status: string;
  position?: number;
  queuedForBot?: number;
  reason?: string;
}

/** 2026-11-01 (owner report: "when I invoke routines they start but it is unclear
 * what started"): the receipt of a start names the routine, the run, the
 * bot, where it stands now and where to follow it, in words a bot can pass
 * on as they are. */
export function routineRunReceipt(input: {
  routineName: string;
  runId: string;
  botName?: string;
  reportsTo?: string;
  standing?: RoutineRunStandingLike | null;
  alreadyRunning?: boolean;
}): string {
  const who = input.botName ? ` on ${input.botName}` : "";
  const head = input.alreadyRunning
    ? `“${input.routineName}” already has a run under way${who} (run ${input.runId}); no second run was started.`
    : `Started “${input.routineName}”${who} (run ${input.runId}).`;
  const standing = input.standing;
  let state = "";
  if (standing?.status === "queued") {
    const place = standing.position && standing.queuedForBot && standing.queuedForBot > 1
      ? ` It is number ${standing.position} of ${standing.queuedForBot} runs waiting for this bot.`
      : "";
    state = ` Status: queued.${place}${standing.reason ? ` ${standing.reason}.` : " It starts as soon as the bot is free (right away when it is)."}`;
  } else if (standing?.status === "running") state = " Status: running now.";
  else if (standing?.status === "waiting") state = ` Status: waiting${standing.reason ? `: ${standing.reason}` : ""}.`;
  else if (standing) state = ` Status: ${standing.status}.`;
  const follow = ` Follow it in ${input.reportsTo ?? "the bot's conversation"}, where its card shows its state and its result, or in Automations > Logs.`;
  return `${head}${state}${follow}`.replace(/\.\./g, ".");
}

/** 2026-11-01: Run now refused because a run of the routine is queued,
 * running or waiting (POST /api/routines/:id/run, 409): why, which run, and
 * where it stands, instead of a bare "already in progress". */
export function routineRunInFlightRefusal(input: Omit<Parameters<typeof routineRunReceipt>[0], "alreadyRunning">): {
  code: "run_in_flight"; runId: string; standing?: RoutineRunStandingLike; error: string; message: string;
} {
  const message = routineRunReceipt({ ...input, alreadyRunning: true });
  return { code: "run_in_flight", runId: input.runId, ...(input.standing ? { standing: input.standing } : {}), error: message, message };
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
      const facts = deps.describe?.(target, current);
      const standing = deps.standing?.(current.id) ?? null;
      return json(res, 200, { runId: current.id, alreadyRunning: true, routineName: routineNameOf(target),
        ...(standing ? { standing } : {}),
        message: routineRunReceipt({ routineName: routineNameOf(target), runId: current.id, ...facts, standing, alreadyRunning: true }) });
    }
    const run = deps.runNow(target.id, speaker ? "person" : undefined);
    if (!run) return json(res, 404, { error: "no such routine on this bot" });
    deps.audit(target, run, speaker);
    const facts = deps.describe?.(target, run);
    const standing = deps.standing?.(run.id) ?? null;
    return json(res, 201, { runId: run.id, routineName: routineNameOf(target), ...(standing ? { standing } : {}),
      message: routineRunReceipt({ routineName: routineNameOf(target), runId: run.id, ...facts, standing }) });
  };
}

function routineNameOf(routine: { id: string; name?: unknown }): string {
  return typeof routine.name === "string" && routine.name.trim() ? routine.name.trim() : routine.id;
}
