// A person's own preferences on an organization server
// (server/people/user-preferences.ts, shared/user-preferences.ts). GET answers the
// signed-in person's record; PUT replaces it with the known keys; PATCH
// changes only the keys it names ({ set, remove }), so two devices saving
// different keys never undo each other. Only a
// session that acts as a person, only on an organization server: anywhere
// else the preferences stay in the browser, as they always were. Member
// scope (request-auth.ts CLIENT_ALLOW): everyone keeps their own.
import type { UserPreferenceStore } from "../people/user-preferences.ts";
import { PASS, type RouteHandler } from "./table.ts";

export const USER_PREFERENCES_PATH = "/api/me/preferences";

export interface UserPreferenceRouteDeps {
  store: UserPreferenceStore;
  /** True on an organization server (SAGAX_IDENTITY=perspicax). */
  organization: () => boolean;
}

export function createUserPreferenceRoutes(deps: UserPreferenceRouteDeps): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    if (path !== USER_PREFERENCES_PATH) return PASS;
    const principalId = auth.kind === "session" ? auth.session.principalId?.trim() : undefined;
    if (!deps.organization() || !principalId) {
      return json(res, 404, { error: "Preferences are kept on an organization server, for a signed-in person." });
    }
    if (method === "GET") return json(res, 200, deps.store.get(principalId));
    if (method === "PUT" || method === "PATCH") {
      if (!/^application\/json\b/i.test(String(req.headers["content-type"] ?? ""))) {
        return json(res, 415, { error: "send the preferences as JSON (content-type: application/json)" });
      }
      const body = await readBody(req);
      if (method === "PATCH") {
        const patch = body && typeof body === "object" && !Array.isArray(body) ? (body as { set?: unknown; remove?: unknown }) : null;
        const set = patch?.set;
        const remove = patch?.remove;
        if (!patch || (set !== undefined && (!set || typeof set !== "object" || Array.isArray(set))) || (remove !== undefined && !Array.isArray(remove))) {
          return json(res, 400, { error: "send { set: { key: value }, remove: [key] } of known keys" });
        }
        return json(res, 200, deps.store.merge(principalId, set ?? {}, remove ?? []));
      }
      const preferences = body && typeof body === "object" && !Array.isArray(body) ? (body as { preferences?: unknown }).preferences : undefined;
      if (!preferences || typeof preferences !== "object" || Array.isArray(preferences)) {
        return json(res, 400, { error: "preferences must be an object of known keys" });
      }
      return json(res, 200, deps.store.put(principalId, preferences));
    }
    return json(res, 405, { error: "GET, PUT or PATCH" });
  };
}
