// A person's own achievements (server/achievements/achievements.ts). Member scope
// (request-auth.ts CLIENT_ALLOW): everyone reads and feeds only their own,
// keyed by the session's person (organization server) or the local operator
// (solo server). Nobody reads another person's record, an admin included;
// /api/achievements/public answers the card by default (points, the chosen
// title id, and unlocked achievement ids). A stored public false stays off
// that list. Locked ids are never on the card.
//
//   GET  /api/me/achievements           the snapshot
//   POST /api/me/achievements/events    { events: [{ type, key?, value? }] } client events only
//   PUT  /api/me/achievements/settings  { settings: { showPoints, toasts, native, public, title, tzOffset } }
//   GET  /api/achievements/public?ids=  { points: { <person>: { points, level, title?, unlocked } } }
import type { AchievementEvent, AchievementStore, AchievementUnlock } from "../achievements/achievements.ts";
import type { RequestAuth } from "../auth/request-auth.ts";
import { PASS, type RouteHandler } from "./table.ts";

export const ACHIEVEMENTS_PATH = "/api/me/achievements";

export interface AchievementRouteDeps {
  store: AchievementStore;
  /** Whose achievements a request reads: a person, or null (a local service, an anonymous session). */
  person: (auth: RequestAuth) => string | null;
  /** An unlock happened: tell that person's streams. */
  unlocked: (person: string, unlocks: AchievementUnlock[]) => void;
  /** Own Claude login or own Anthropic key. GET records claude.linked when true. */
  linked?: (person: string) => boolean | Promise<boolean>;
}

function isJson(header: unknown): boolean {
  return /^application\/json\b/i.test(String(header ?? ""));
}

export function createAchievementRoutes(deps: AchievementRouteDeps): RouteHandler {
  return async ({ req, res, url, path, method, auth, json, readBody }) => {
    if (path !== ACHIEVEMENTS_PATH && !path.startsWith(`${ACHIEVEMENTS_PATH}/`) && path !== "/api/achievements/public") return PASS;
    const person = deps.person(auth);
    if (!person) return json(res, 404, { error: "Achievements belong to a person." });
    res.setHeader("cache-control", "no-store");

    if (path === "/api/achievements/public") {
      if (method !== "GET") return json(res, 405, { error: "GET" });
      const ids = (url.searchParams.get("ids") ?? "").split(",").map((id) => id.trim()).filter(Boolean);
      return json(res, 200, { points: deps.store.publicPoints(ids) });
    }

    if (path === ACHIEVEMENTS_PATH) {
      if (method !== "GET") return json(res, 405, { error: "GET" });
      if (await deps.linked?.(person)) {
        const result = deps.store.record(person, [{ type: "claude.linked" }], "server");
        if (result.unlocked.length) deps.unlocked(person, result.unlocked);
      }
      return json(res, 200, deps.store.snapshot(person));
    }

    if (path === `${ACHIEVEMENTS_PATH}/events`) {
      if (method !== "POST") return json(res, 405, { error: "POST" });
      if (!isJson(req.headers["content-type"])) return json(res, 415, { error: "send the events as JSON (content-type: application/json)" });
      const body = await readBody(req, 16_384);
      const events = body && typeof body === "object" && Array.isArray((body as { events?: unknown }).events) ? ((body as { events: unknown[] }).events) : null;
      if (!events) return json(res, 400, { error: "events must be a list" });
      const clean: AchievementEvent[] = events
        .filter((event): event is Record<string, unknown> => Boolean(event) && typeof event === "object" && !Array.isArray(event))
        .map((event) => ({
          type: event.type as AchievementEvent["type"],
          ...(typeof event.key === "string" ? { key: event.key.slice(0, 80) } : {}),
          ...(typeof event.value === "number" ? { value: event.value } : {}),
        }));
      const result = deps.store.record(person, clean, "client");
      if (result.unlocked.length) deps.unlocked(person, result.unlocked);
      return json(res, 200, { accepted: result.accepted, unlocked: result.unlocked, snapshot: deps.store.snapshot(person) });
    }

    if (path === `${ACHIEVEMENTS_PATH}/settings`) {
      if (method !== "PUT") return json(res, 405, { error: "PUT" });
      if (!isJson(req.headers["content-type"])) return json(res, 415, { error: "send the settings as JSON (content-type: application/json)" });
      const body = await readBody(req, 4_096);
      const settings = body && typeof body === "object" ? (body as { settings?: unknown }).settings : undefined;
      if (!settings || typeof settings !== "object" || Array.isArray(settings)) return json(res, 400, { error: "settings must be an object" });
      return json(res, 200, { settings: deps.store.updateSettings(person, settings) });
    }

    return json(res, 404, { error: "no such achievements route" });
  };
}
