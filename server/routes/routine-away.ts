// Routines that run only while their person is there (server/routines/routine-away.ts).
//
//   POST /api/routines/away/beat   { idleMs, systemIdle? }
//        A solo server's page says how long its person has not used it (the
//        desktop adds the computer's idle state). Answers { state }. An
//        organization server answers 404: presence (/api/presence/heartbeat)
//        is its signal there.
//   GET  /api/routines/away
//        { state: "present" | "away" | "unknown" } for the signed-in person
//        (the Automations page's line "Paused while you are away").
//   POST /api/routines/:id/away-seen
//        The person read the report of runs skipped while away: forget them.
//        The routine's person (who it runs as) or an admin; 404 otherwise.
import { z } from "zod";

import type { AwayVerdict } from "../routines/routine-away.ts";
import type { RequestAuth } from "../request-auth.ts";
import { SYSTEM_IDLE_STATES } from "../../shared/presence.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface RoutineAwayRouteDeps<R> {
  organization(): boolean;
  /** A solo server's beat (LocalAwayTracker.beat). */
  beat(beat: { idleMs: number; systemIdle?: (typeof SYSTEM_IDLE_STATES)[number] }): AwayVerdict;
  /** The signed-in person's verdict (the loopback on a solo server). */
  verdict(auth: RequestAuth): AwayVerdict;
  /** The routine, when this caller may dismiss its report; undefined otherwise. */
  routineFor(auth: RequestAuth, id: string): R | undefined;
  clear(id: string): R | null;
  onWire(routine: R): unknown;
}

const beatBody = z.object({
  idleMs: z.number().finite().min(0).max(7 * 24 * 60 * 60_000),
  systemIdle: z.enum(SYSTEM_IDLE_STATES as unknown as ["active", "idle", "locked", "unknown"]).optional(),
}).strict();

export function createRoutineAwayRoutes<R>(deps: RoutineAwayRouteDeps<R>): RouteHandler {
  return async ({ res, path, method, auth, json, readBody, req }) => {
    if (path === "/api/routines/away/beat" && method === "POST") {
      if (deps.organization()) return json(res, 404, { error: "Presence on an organization server comes from /api/presence/heartbeat." });
      const parsed = beatBody.safeParse(await readBody(req));
      if (!parsed.success) return json(res, 400, { error: "send { idleMs, systemIdle? }" });
      return json(res, 200, { state: deps.beat(parsed.data) });
    }
    if (path === "/api/routines/away" && method === "GET") {
      return json(res, 200, { state: deps.verdict(auth) });
    }
    const seen = path.match(/^\/api\/routines\/([\w-]{1,128})\/away-seen$/);
    if (seen && method === "POST") {
      const routine = deps.routineFor(auth, seen[1]!);
      if (!routine) return json(res, 404, { error: "Routine not found" });
      const cleared = deps.clear(seen[1]!);
      if (!cleared) return json(res, 404, { error: "Routine not found" });
      return json(res, 200, { routine: deps.onWire(cleared) });
    }
    return PASS;
  };
}
