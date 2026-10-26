// GET /api/computer/working-bots -> { bots: [{ id, name, threadId }] }
//
// Settings > Computer: the bots working on the bot's computer right now, so a
// person can stop one (and let a held-back Update through) instead of only
// reading "a bot is working" (server/routes/computer-status.ts, the 409
// computer_busy). The list is scoped like the computer itself: the computer's
// owner or an admin on a personal server, the signed-in person for their own
// bots on an organization server. Names are human; the id travels only for
// the row's tooltip / Copy and for the stop, which reuses the ordinary task
// stop (POST /api/bots/:id/interrupt) with its own authorization.
import type { RequestAuth } from "../request-auth.ts";
import type { WorkingBot } from "../computer-working-bots.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface WorkingBotsRefusal {
  status: number;
  body: { error: string; code?: string };
}

export interface ComputerWorkingBotsRouteDeps {
  /** Null when the caller may list this computer's bots; a refusal otherwise.
   * Mirrors the computer-status route's gate (owner/admin, or a signed-in
   * person on an organization server). */
  guard(auth: RequestAuth): WorkingBotsRefusal | null;
  /** The bots working on the computer now (already name-resolved, never a raw
   * id as a label), scoped to what the caller may see. */
  list(auth: RequestAuth): Promise<WorkingBot[]>;
}

const PATH = "/api/computer/working-bots";

export function createComputerWorkingBotsRoutes(deps: ComputerWorkingBotsRouteDeps): RouteHandler {
  return async ({ res, path, method, auth, json }) => {
    if (path !== PATH) return PASS;
    if (method !== "GET") return json(res, 405, { error: "GET only" });
    res.setHeader("cache-control", "no-store");
    const refused = deps.guard(auth);
    if (refused) return json(res, refused.status, refused.body);
    return json(res, 200, { bots: await deps.list(auth) });
  };
}
