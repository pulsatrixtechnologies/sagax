// Routine outcomes (#4098, lot outcomes-records, shared/outcome-records.ts).
//
//   POST /api/routines/outcomes  { action, botId, ... }
//        create   { name, note? }           an empty outcome at the end
//        rename   { id, name }              rename in place
//        note     { id, note }              note null clears it
//        reorder  { order }                 the person's order of outcome ids
//        move     { routineIds, outcome }   outcome null: each is its own again
//        delete   { id }                    its routines become outcomes of their own
//   Answers { outcomes, routines }: the bot's outcomes in order and the
//   routines the action changed. The list itself also rides GET /api/routines
//   (`outcomes`) and the `routine.outcomes` frame.
//
// Whoever may change the bot's routines may arrange its outcomes: no admin
// right. A bot the caller cannot see is 404.
import { z } from "zod";

import type { RequestAuth } from "../auth/request-auth.ts";
import { OUTCOME_NAME_MAX, OUTCOME_NOTE_MAX, type OutcomeRecord } from "../../shared/outcome-records.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface RoutineOutcomeManager<R> {
  createOutcome(botId: string, name: string, note?: string): RoutineOutcomeResultOf<R>;
  renameOutcome(botId: string, id: string, name: string): RoutineOutcomeResultOf<R> | null;
  noteOutcome(botId: string, id: string, note: string | null): RoutineOutcomeResultOf<R> | null;
  reorderOutcomes(botId: string, order: readonly string[]): RoutineOutcomeResultOf<R>;
  moveToOutcome(botId: string, routineIds: readonly string[], outcome: string | null): RoutineOutcomeResultOf<R>;
  deleteOutcome(botId: string, id: string): RoutineOutcomeResultOf<R> | null;
}

export interface RoutineOutcomeResultOf<R> {
  outcomes: OutcomeRecord[];
  routines: R[];
}

export interface RoutineOutcomeRouteDeps<R> {
  access(auth: RequestAuth, botId: string): "ok" | "hidden" | "needs_run";
  manager(): RoutineOutcomeManager<R> | null;
  onWire(routine: R): unknown;
}

const botId = z.string().min(1).max(200);
const id = z.string().min(1).max(64);
const name = z.string().min(1).max(OUTCOME_NAME_MAX * 2);
const note = z.string().max(OUTCOME_NOTE_MAX * 2);

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), botId, name, note: note.optional() }).strict(),
  z.object({ action: z.literal("rename"), botId, id, name }).strict(),
  z.object({ action: z.literal("note"), botId, id, note: note.nullable() }).strict(),
  z.object({ action: z.literal("reorder"), botId, order: z.array(id).max(200) }).strict(),
  z.object({ action: z.literal("move"), botId, routineIds: z.array(z.string().min(1).max(128)).min(1).max(1000), outcome: id.nullable() }).strict(),
  z.object({ action: z.literal("delete"), botId, id }).strict(),
]);

export function createRoutineOutcomeRoutes<R>(deps: RoutineOutcomeRouteDeps<R>): RouteHandler {
  return async ({ res, path, method, auth, json, readBody, req }) => {
    if (path !== "/api/routines/outcomes" || method !== "POST") return PASS;
    const parsed = bodySchema.safeParse(await readBody(req));
    if (!parsed.success) {
      return json(res, 400, { error: "send { action, botId, ... } (create, rename, note, reorder, move, delete)" });
    }
    const body = parsed.data;
    const access = deps.access(auth, body.botId);
    if (access === "hidden") return json(res, 404, { error: "no such bot" });
    if (access === "needs_run") return json(res, 403, { error: "you need the right to run this bot's routines", code: "needs_run" });
    const manager = deps.manager();
    if (!manager) return json(res, 503, { error: "Routines are not available" });
    let result: RoutineOutcomeResultOf<R> | null;
    try {
      switch (body.action) {
        case "create": result = manager.createOutcome(body.botId, body.name, body.note); break;
        case "rename": result = manager.renameOutcome(body.botId, body.id, body.name); break;
        case "note": result = manager.noteOutcome(body.botId, body.id, body.note); break;
        case "reorder": result = manager.reorderOutcomes(body.botId, body.order); break;
        case "move": result = manager.moveToOutcome(body.botId, body.routineIds, body.outcome); break;
        case "delete": result = manager.deleteOutcome(body.botId, body.id); break;
      }
    } catch (error) {
      const status = (error as { status?: unknown }).status;
      if (status === 404 || status === 503) return json(res, status, { error: (error as Error).message });
      return json(res, 400, { error: error instanceof Error ? error.message : "Could not change the outcomes" });
    }
    if (!result) return json(res, 404, { error: "no such outcome" });
    return json(res, 200, {
      outcomes: result.outcomes,
      routines: result.routines.map((routine) => deps.onWire(routine)),
    });
  };
}
