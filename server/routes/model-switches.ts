// The person's own model switches (2026-10-30, "Providers, models and
// voice", lot 2; shared/offered-models.ts).
//
//   GET /api/me/models   { org: string[], mine: string[] }
//   PUT /api/me/models   { disabledModels: string[] }   the person's whole list
//
// Their own: no admin right. On an organization server the list is kept in
// the person's settings (server/person-settings.ts); on a solo server it is
// the installation's (`disabledModels` in config.json), written by whoever
// may edit it. The organization's list is read here, set in Perspicax only
// (POST /api/org/admin/settings `disabledModels`).
import type { RequestAuth } from "../auth/request-auth.ts";
import { cleanDisabledModels } from "../../shared/offered-models.ts";
import { PASS, type RouteHandler } from "./table.ts";

export const MODEL_SWITCHES_PATH = "/api/me/models";

export interface ModelSwitchRouteDeps {
  /** The models the organization turned off (empty on a solo server). */
  org(): readonly string[];
  /** Whose list this session reads and writes: a person on an organization
   * server, "installation" on a solo server for a caller who may edit it,
   * null otherwise. */
  owner(auth: RequestAuth): string | "installation" | null;
  mine(owner: string | "installation"): readonly string[];
  /** Saves the list, then moves the bots of this owner off a model now off. */
  save(owner: string | "installation", list: string[]): void;
}

export function createModelSwitchRoutes(deps: ModelSwitchRouteDeps): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    if (path !== MODEL_SWITCHES_PATH) return PASS;
    if (method !== "GET" && method !== "PUT") return PASS;
    res.setHeader("cache-control", "no-store");
    const owner = deps.owner(auth);
    if (!owner) return json(res, 403, { error: "Sign in to choose your models." });
    if (method === "GET") return json(res, 200, { org: [...deps.org()], mine: [...deps.mine(owner)] });
    if (!String(req.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) {
      return json(res, 415, { error: "content-type must be application/json" });
    }
    const body = await readBody(req).catch(() => undefined) as { disabledModels?: unknown } | undefined;
    if (!body || typeof body !== "object" || !Array.isArray(body.disabledModels)) return json(res, 400, { error: "Send { disabledModels: [\"<engine>/<model>\", …] }." });
    const list = cleanDisabledModels(body.disabledModels);
    deps.save(owner, list);
    return json(res, 200, { org: [...deps.org()], mine: [...deps.mine(owner)] });
  };
}
