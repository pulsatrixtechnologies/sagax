// The desktop's look on a personal computer (server/desktop/desktop-appearance.ts,
// shared/desktop-appearance.ts). GET answers the record; PUT replaces it
// with the valid keys. The desktop renderer keeps it in step with its own
// localStorage (src/lib/desktop-appearance-sync.ts); the paired phone reads it
// for Settings > Appearance > Same as my computer and may write a new choice.
// An organization server answers 404: the phone reads the person's own
// /api/me/preferences there. Client scope (request-auth.ts CLIENT_ALLOW,
// companion/src/routes.ts): a look carries no secret.
import { DESKTOP_APPEARANCE_PATH } from "../../shared/desktop-appearance.ts";
import type { DesktopAppearanceStore } from "../desktop/desktop-appearance.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface DesktopAppearanceRouteDeps {
  store: DesktopAppearanceStore;
  /** True on an organization server (SAGAX_IDENTITY=perspicax). */
  organization: () => boolean;
}

export function createDesktopAppearanceRoutes(deps: DesktopAppearanceRouteDeps): RouteHandler {
  return async ({ req, res, path, method, json, readBody }) => {
    if (path !== DESKTOP_APPEARANCE_PATH) return PASS;
    if (deps.organization()) {
      return json(res, 404, { error: "On an organization server the look is kept in /api/me/preferences." });
    }
    if (method === "GET") return json(res, 200, deps.store.get());
    if (method === "PUT") {
      if (!/^application\/json\b/i.test(String(req.headers["content-type"] ?? ""))) {
        return json(res, 415, { error: "send the appearance as JSON (content-type: application/json)" });
      }
      const body = await readBody(req);
      const preferences = body && typeof body === "object" && !Array.isArray(body) ? (body as { preferences?: unknown }).preferences : undefined;
      if (!preferences || typeof preferences !== "object" || Array.isArray(preferences)) {
        return json(res, 400, { error: "preferences must be an object of appearance keys" });
      }
      return json(res, 200, deps.store.put(preferences));
    }
    return json(res, 405, { error: "GET or PUT" });
  };
}
