// #4558: the person's "always" choices on a routine's keyed cards
// (server/proactive/answer-learning.ts), kept in their signal ledger, never
// in the routine's instructions.
//
//   GET    /api/routines/:id/always-choices
//          { choices: [{ kind, answer, at }] }, newest first.
//   DELETE /api/routines/:id/always-choices/:kind
//          The person removes one ({ ok: true }); 404 when there is none.
//
// Only the person the choices belong to (the routine's person) reads or
// removes them; anyone else gets 404, as for a routine they cannot see.
import type { RequestAuth } from "../auth/request-auth.ts";
import type { AlwaysChoice, AnswerScope } from "../proactive/answer-learning.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface RoutineAlwaysChoicesRouteDeps {
  /** The routine's answer scope (its person, bot and id), or undefined. */
  scopeOf(routineId: string): AnswerScope | undefined;
  list(scope: AnswerScope): AlwaysChoice[];
  forget(scope: AnswerScope, kind: string): boolean;
}

const LIST = /^\/api\/routines\/([\w-]{1,128})\/always-choices$/;
const ONE = /^\/api\/routines\/([\w-]{1,128})\/always-choices\/([^/]{1,600})$/;

/** The scope when this caller is the routine's person: the signed-in
 * person, or the local server's own (loopback). Never another person's
 * choices, an admin's view included. */
function scopeFor(deps: RoutineAlwaysChoicesRouteDeps, auth: RequestAuth, routineId: string): AnswerScope | undefined {
  const scope = deps.scopeOf(routineId);
  if (!scope || auth.kind !== "session") return scope;
  const viewer = auth.session.principalId?.trim().toLowerCase();
  return viewer && scope.person.trim().toLowerCase() === viewer ? scope : undefined;
}

function decoded(part: string): string | null {
  try { return decodeURIComponent(part); } catch { return null; }
}

export function createRoutineAlwaysChoicesRoutes(deps: RoutineAlwaysChoicesRouteDeps): RouteHandler {
  return async ({ res, path, method, auth, json }) => {
    const list = LIST.exec(path);
    if (list && method === "GET") {
      const scope = scopeFor(deps, auth, list[1]!);
      if (!scope) return json(res, 404, { error: "Routine not found" });
      return json(res, 200, { choices: deps.list(scope) });
    }
    const one = ONE.exec(path);
    if (one && method === "DELETE") {
      const scope = scopeFor(deps, auth, one[1]!);
      if (!scope) return json(res, 404, { error: "Routine not found" });
      const kind = decoded(one[2]!);
      if (!kind || !deps.forget(scope, kind)) return json(res, 404, { error: "No such choice" });
      return json(res, 200, { ok: true });
    }
    return PASS;
  };
}
