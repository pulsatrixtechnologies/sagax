// #4504: what the signed-in person has installed and which of it has an
// update, and the update itself (server/capabilities/capability-updates.ts).
//
//   GET  /api/me/capability-updates   -> UpdatesView (count, items)
//   POST /api/me/capability-updates   {keys: [...]} | {all: true}
//                                     -> {results: [...], count}
//
// The session's person only (solo: the operator), never an id from the
// query or the body; no admin. The page and the bots (sagax_settings
// capabilities.updates, replayed by act with the person's session) call
// these same two routes.
import { z } from "zod";

import type { RequestAuth } from "../auth/request-auth.ts";
import type { CapabilityUpdates, UpdatePerson } from "../capabilities/capability-updates.ts";
import { PASS, type RouteHandler } from "./table.ts";

export const CAPABILITY_UPDATES_ROUTE = "/api/me/capability-updates";

export interface CapabilityUpdatesRouteDeps {
  updates: CapabilityUpdates;
  /** The signed-in person, or null (no person: refused). */
  person: (auth: RequestAuth) => UpdatePerson | null;
  /** Why this person may not change their own capabilities (the existing
   * apps.ownIntegrations permission), or null. */
  changeRefusal?: (auth: RequestAuth) => { status: number; body: Record<string, unknown> } | null;
}

const applySchema = z.union([
  z.object({ all: z.literal(true) }).strict(),
  z.object({ keys: z.array(z.string().min(1).max(400)).min(1).max(200) }).strict(),
]);

export function createCapabilityUpdatesRoutes(deps: CapabilityUpdatesRouteDeps): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    if (!path.startsWith(CAPABILITY_UPDATES_ROUTE) || path.length !== CAPABILITY_UPDATES_ROUTE.length) return PASS;
    res.setHeader("cache-control", "private, no-store");
    const person = deps.person(auth);
    if (!person) return json(res, 403, { error: "Sign in to see your own updates.", code: "session_required" });
    if (path === "/api/me/capability-updates" && method === "GET") return json(res, 200, await deps.updates.list(person));
    if (!(path === "/api/me/capability-updates" && method === "POST")) return json(res, 405, { error: "GET or POST only" });
    const refusal = deps.changeRefusal?.(auth);
    if (refusal) return json(res, refusal.status, refusal.body);
    const parsed = applySchema.safeParse(await readBody(req));
    if (!parsed.success) return json(res, 400, { error: "Send {keys: [...]} from the list, or {all: true}.", code: "invalid_body" });
    return json(res, 200, await deps.updates.apply(person, parsed.data));
  };
}
