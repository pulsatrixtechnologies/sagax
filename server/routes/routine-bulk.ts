// Several routines of one bot on, off or deleted in one change (2026-10-29).
//
//   POST /api/routines/bulk  { botId, action: enable|disable|delete,
//                              routineIds: [...] | all: true }
//
// A bot asked "pause all of Ember's routines" (sagax_settings routine.bulk)
// makes one change, so it is one card when its level asks, never one card per
// routine. Each routine is then changed by the same code as its own PATCH or
// DELETE (server/index.ts patchRoutineAs, deleteRoutineAs), with the caller's rights: whoever may change the
// bot's routines (its owner, or a member with the right to run it). Nothing
// changes when a routine is unknown, of another bot, or the bot is hidden.

import type { IncomingMessage } from "node:http";
import { z } from "zod";

import type { RequestAuth } from "../auth/request-auth.ts";
import { PASS, type RouteHandler } from "./table.ts";

export const ROUTINE_BULK_MAX = 500;

const bodySchema = z.object({
  botId: z.string().min(1).max(200),
  action: z.enum(["enable", "disable", "delete"]),
  routineIds: z.array(z.string().min(1).max(128)).min(1).max(ROUTINE_BULK_MAX).optional(),
  all: z.literal(true).optional(),
}).strict();

export type RoutineBulkAction = "enable" | "disable" | "delete";
export type RoutineBulkPlan = { botId: string; action: RoutineBulkAction; ids: string[] };
export type RoutineBulkRefusal = { error: string; status: number; code?: string };

/** The routines a bulk change touches, or why it changes nothing. */
export function planRoutineBulk(
  raw: unknown,
  routines: ReadonlyArray<{ id: string; botId: string }>,
  access: { hidden(botId: string): boolean; needsRun(botId: string): boolean },
): RoutineBulkPlan | RoutineBulkRefusal {
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return { status: 400, error: "send { botId, action: enable|disable|delete, routineIds: [...] } or all: true instead of routineIds" };
  const body = parsed.data;
  if (Boolean(body.routineIds) === Boolean(body.all)) return { status: 400, error: "send routineIds or all: true, one of the two" };
  if (access.hidden(body.botId)) return { status: 404, error: "no such bot" };
  if (access.needsRun(body.botId)) return { status: 403, error: "you need the right to run this bot's routines", code: "needs_run" };
  const own = routines.filter((routine) => routine.botId === body.botId);
  if (body.all) return { botId: body.botId, action: body.action, ids: own.map((routine) => routine.id) };
  const ids = [...new Set(body.routineIds)];
  const known = new Set(own.map((routine) => routine.id));
  const missing = ids.filter((id) => !known.has(id));
  if (missing.length) return { status: 404, error: `not a routine of this bot: ${missing.slice(0, 10).join(", ")}${missing.length > 10 ? "…" : ""}` };
  return { botId: body.botId, action: body.action, ids };
}

/** What a bulk change answers: what changed, and what each refusal said. */
export function routineBulkAnswer(plan: RoutineBulkPlan, results: ReadonlyArray<{ id: string; status: number; body: unknown }>) {
  const changed = results.filter((row) => row.status < 400).map((row) => row.id);
  const refused = results.filter((row) => row.status >= 400).map((row) => ({
    id: row.id,
    error: String((row.body as { error?: unknown } | null)?.error ?? row.status),
  }));
  return { ok: refused.length === 0, action: plan.action, botId: plan.botId, changed, ...(refused.length ? { refused } : {}) };
}

export interface RoutineBulkRouteDeps {
  /** Whether this caller may change this bot's routines: "hidden" for a bot
   * they cannot see (404), "needs_run" without the right to run it (403). */
  access(auth: RequestAuth, botId: string): "ok" | "hidden" | "needs_run";
  routines(): ReadonlyArray<{ id: string; botId: string }> | null;
  patch(auth: RequestAuth, req: IncomingMessage, id: string, enabled: boolean): { status: number; body: unknown };
  remove(auth: RequestAuth, id: string): { status: number; body: unknown };
}

export function createRoutineBulkRoutes(deps: RoutineBulkRouteDeps): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    if (path !== "/api/routines/bulk" || method !== "POST") return PASS;
    const all = deps.routines();
    if (!all) return json(res, 503, { error: "Routines are not available" });
    const plan = planRoutineBulk(await readBody(req), all, {
      hidden: (botId) => deps.access(auth, botId) === "hidden",
      needsRun: (botId) => deps.access(auth, botId) === "needs_run",
    });
    if ("error" in plan) return json(res, plan.status, { error: plan.error, ...(plan.code ? { code: plan.code } : {}) });
    const results = plan.ids.map((id) => {
      try {
        return { id, ...(plan.action === "delete" ? deps.remove(auth, id) : deps.patch(auth, req, id, plan.action === "enable")) };
      } catch (error) {
        return { id, status: 400, body: { error: error instanceof Error ? error.message : "could not change it" } };
      }
    });
    return json(res, 200, routineBulkAnswer(plan, results));
  };
}
