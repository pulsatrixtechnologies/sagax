// A person's own Experimental switches and browser profiles on an
// organization server (#1098, 2026-10-27, server/people/person-settings.ts). Their
// own: no admin right, no right to edit the installation.
//
//   GET   /api/me/experimental   { features, browserProfiles }
//   PATCH /api/me/experimental   { features?: { <key>: true | false | null }, browserProfiles?: [{ id?, name }] }
//
// A solo server answers 404: its one person edits the installation itself.
import type { RequestAuth } from "../auth/request-auth.ts";
import { PersonSettingsError, type PersonSettings, type PersonSettingsStore } from "../people/person-settings.ts";
import { PASS, type RouteHandler } from "./table.ts";

export const PERSON_SETTINGS_PATH = "/api/me/experimental";

export interface PersonSettingsRouteDeps {
  store: PersonSettingsStore;
  /** Whose settings this session reads; null when it names no person or the server is solo. */
  principal(auth: RequestAuth): string | null;
  /** Before profiles go: why they may not now (a bot of theirs still uses one in a turn), or null. */
  removalRefusal?(principalId: string, removed: readonly string[]): string | null;
  /** After a save: drop the bots' references to removed profiles, erase their storage, tell the person's apps. */
  saved?(principalId: string, before: PersonSettings, after: PersonSettings): void;
}

export function createPersonSettingsRoutes(deps: PersonSettingsRouteDeps): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    if (path !== PERSON_SETTINGS_PATH) return PASS;
    res.setHeader("cache-control", "no-store");
    const principalId = deps.principal(auth);
    if (!principalId) return json(res, 404, { error: "Your own Experimental settings are kept on an organization server." });
    if (method === "GET") return json(res, 200, deps.store.get(principalId));
    if (method !== "PATCH") return PASS;
    const body = await readBody(req).catch(() => undefined);
    if (!body || typeof body !== "object" || Array.isArray(body)) return json(res, 400, { error: "Send { features } or { browserProfiles }." });
    const { features, browserProfiles } = body as { features?: unknown; browserProfiles?: unknown };
    if (features !== undefined && (!features || typeof features !== "object" || Array.isArray(features))) {
      return json(res, 400, { error: "features must be an object." });
    }
    try {
      const before = deps.store.get(principalId);
      if (browserProfiles !== undefined && Array.isArray(browserProfiles)) {
        const kept = new Set(browserProfiles.map((entry) => (entry as { id?: unknown } | null)?.id));
        const removed = before.browserProfiles.map((profile) => profile.id).filter((id) => !kept.has(id));
        const refusal = removed.length ? deps.removalRefusal?.(principalId, removed) ?? null : null;
        if (refusal) return json(res, 409, { error: refusal });
      }
      if (features !== undefined) deps.store.setFeatures(principalId, features as Record<string, unknown>);
      if (browserProfiles !== undefined) deps.store.setBrowserProfiles(principalId, browserProfiles);
      const after = deps.store.get(principalId);
      deps.saved?.(principalId, before, after);
      return json(res, 200, after);
    } catch (error) {
      if (error instanceof PersonSettingsError) return json(res, error.status, { error: error.message });
      throw error;
    }
  };
}
