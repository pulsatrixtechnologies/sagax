// The person's own model switches (2026-10-30, "Providers, models and
// voice", lot 2; shared/offered-models.ts).
//
//   GET /api/me/models   { org: string[], mine: string[], favoriteModels: string[],
//                          harnessByProvider: { <provider id>: <driver kind> } }
//   PUT /api/me/models   { disabledModels?: string[], favoriteModels?: string[],
//                          harnessByProvider?: { <provider id>: <driver kind> | null } }
//                        each list given replaces the person's whole list;
//                        each provider given in harnessByProvider sets or
//                        (null) clears that provider's default only
//
// #2050: `favoriteModels` is the person's starred models in the model
// selector (same `<engine>/<model>` keys, at most MAX_FAVORITE_MODELS),
// kept beside the switches so the stars follow the person across devices.
//
// #4329 lot 5: `harnessByProvider` is what runs the person's bots for each
// provider ("Runs with" on a provider's page). A pair the compatibility
// matrix does not offer is refused with its sentence; saving moves the
// person's bots that have no engine of their own (server/models/resolve-harness.ts).
//
// Their own: no admin right. On an organization server the list is kept in
// the person's settings (server/people/person-settings.ts); on a solo server it is
// the installation's (`disabledModels` in config.json), written by whoever
// may edit it. The organization's list is read here, set in Perspicax only
// (POST /api/org/admin/settings `disabledModels`).
import type { RequestAuth } from "../auth/request-auth.ts";
import { cleanDisabledModels, cleanFavoriteModels } from "../../shared/offered-models.ts";
import { cleanHarnessDefaults, isHarnessId } from "../../shared/harness-matrix.ts";
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
  /** #2050: the owner's starred models, in star order. */
  favorites(owner: string | "installation"): readonly string[];
  saveFavorites(owner: string | "installation", list: string[]): void;
  /** #4329 lot 5: the owner's default engine per provider. */
  harnessDefaults?: {
    read(owner: string | "installation"): Readonly<Record<string, string>>;
    /** Why this engine cannot run this provider for this caller, or null. */
    refusal(auth: RequestAuth, provider: string, harness: string): Promise<string | null>;
    /** Saves the whole map, then moves the owner's bots that follow it. */
    save(owner: string | "installation", map: Record<string, string>, auth: RequestAuth): Promise<void>;
  };
}

export function createModelSwitchRoutes(deps: ModelSwitchRouteDeps): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    if (path !== MODEL_SWITCHES_PATH) return PASS;
    if (method !== "GET" && method !== "PUT") return PASS;
    res.setHeader("cache-control", "no-store");
    const owner = deps.owner(auth);
    if (!owner) return json(res, 403, { error: "Sign in to choose your models." });
    const answer = () => json(res, 200, {
      org: [...deps.org()], mine: [...deps.mine(owner)], favoriteModels: [...deps.favorites(owner)],
      ...(deps.harnessDefaults ? { harnessByProvider: { ...deps.harnessDefaults.read(owner) } } : {}),
    });
    if (method === "GET") return answer();
    if (!String(req.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) {
      return json(res, 415, { error: "content-type must be application/json" });
    }
    const body = await readBody(req).catch(() => undefined) as { disabledModels?: unknown; favoriteModels?: unknown; harnessByProvider?: unknown } | undefined;
    const switches = body && typeof body === "object" && Array.isArray(body.disabledModels);
    const favorites = body && typeof body === "object" && Array.isArray(body.favoriteModels);
    const rawHarness = body && typeof body === "object" ? body.harnessByProvider : undefined;
    const harness = Boolean(deps.harnessDefaults) && rawHarness !== null && typeof rawHarness === "object" && !Array.isArray(rawHarness);
    if (!switches && !favorites && !harness) return json(res, 400, { error: "Send { disabledModels: [\"<engine>/<model>\", …] } and/or { favoriteModels: [\"<engine>/<model>\", …] } and/or { harnessByProvider: { \"<provider>\": \"<engine>\" | null } }." });
    let harnessMap: Record<string, string> | undefined;
    if (harness) {
      const next: Record<string, string> = { ...deps.harnessDefaults!.read(owner) };
      for (const [provider, value] of Object.entries(rawHarness as Record<string, unknown>)) {
        if (value === null || value === "") { delete next[provider]; continue; }
        if (!isHarnessId(value)) return json(res, 400, { error: `harnessByProvider.${provider} must be an engine's driver kind, or null.` });
        const refusal = await deps.harnessDefaults!.refusal(auth, provider, value);
        if (refusal) return json(res, 400, { error: refusal });
        next[provider] = value;
      }
      harnessMap = cleanHarnessDefaults(next);
    }
    if (switches) deps.save(owner, cleanDisabledModels(body!.disabledModels));
    if (favorites) deps.saveFavorites(owner, cleanFavoriteModels(body!.favoriteModels));
    if (harnessMap) await deps.harnessDefaults!.save(owner, harnessMap, auth);
    return answer();
  };
}
