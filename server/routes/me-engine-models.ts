// The models one person's own session can run on an engine (#1154):
//
//   GET /api/me/engines/:instanceId/models   { models }
//
// The model menu never lists a model their turns would silently replace.
// Organization servers only (the caller registers it next to the rest of
// /api/me/engines).
import type { RequestAuth } from "../auth/request-auth.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface MeEngineModelsRouteDeps {
  /** The signed-in person's principal id, or "" when this is not a person. */
  principalOf: (auth: RequestAuth) => string;
  accountModels: (principalId: string, instanceId: string) => Promise<unknown>;
}

const ROUTE = /^\/api\/me\/engines\/([\w.-]+)\/models$/;

export function createMeEngineModelsRoutes(deps: MeEngineModelsRouteDeps): RouteHandler {
  return async ({ res, path, method, auth, json }) => {
    const m = ROUTE.exec(path);
    if (!m || method !== "GET") return PASS;
    res.setHeader("cache-control", "no-store");
    const principalId = deps.principalOf(auth);
    if (!principalId) return json(res, 403, { error: "sign in as a person first" });
    const models = await deps.accountModels(principalId, m[1]!).catch(() => null);
    return json(res, 200, { models });
  };
}
