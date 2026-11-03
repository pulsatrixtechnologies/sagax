// GET and PUT /api/settings/bot: the phone's Settings > Bot rows
// (server/bots/bot-settings.ts says what each one does).
//
//   GET -> { settings: { autoReviewDefault, timeZone, timeZoneAuto },
//            scope: "server" | "person", hostTimeZone, effectiveTimeZone }
//   PUT { autoReviewDefault?, timeZone? (IANA or null), timeZoneAuto? } -> same
//
// Organization server: a signed-in person reads and changes their own; the
// operator at the server's console the server's. Personal server: the
// server's own, which only its owner (this computer, a paired phone, an
// admin session) changes. Member scope (request-auth.ts CLIENT_ALLOW).
import type { BotSettings, BotSettingsStore } from "../bots/bot-settings.ts";
import { botSettingsPatchSchema, hostTimeZone } from "../bots/bot-settings.ts";
import { PASS, type RouteHandler } from "./table.ts";

export const BOT_SETTINGS_PATH = "/api/settings/bot";

export interface BotSettingsRouteDeps {
  store: BotSettingsStore;
  organization: () => boolean;
  /** After a save (routine and calendar-call schedules are recomputed in the new zone). */
  changed?: (scope: { kind: "server" } | { kind: "person"; principalId: string }, settings: BotSettings) => void;
}

export function createBotSettingsRoutes(deps: BotSettingsRouteDeps): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    if (path !== BOT_SETTINGS_PATH) return PASS;
    if (method !== "GET" && method !== "PUT") return json(res, 405, { error: "GET or PUT" });
    res.setHeader("cache-control", "no-store");
    if (auth.kind === "loopback" && auth.trust === "service") return json(res, 403, { error: "forbidden: sign in to change these settings", code: "bot_settings_sign_in" });
    const principalId = auth.kind === "session" ? auth.session.principalId?.trim() : undefined;
    const scope = deps.organization() && principalId ? { kind: "person" as const, principalId } : { kind: "server" as const };
    // On an organization server only a signed-in person has settings here,
    // or the operator at the console; a device session with no person has none.
    if (deps.organization() && !principalId && auth.kind === "session" && !auth.scopes.includes("admin")) {
      return json(res, 403, { error: "Sign in with Pulsatrix to keep your own settings.", code: "identity_perspicax" });
    }
    const answer = (settings: BotSettings) => json(res, 200, {
      settings, scope: scope.kind, hostTimeZone: hostTimeZone(), effectiveTimeZone: settings.timeZone ?? hostTimeZone(),
    });
    if (method === "GET") return answer(scope.kind === "person" ? deps.store.person(scope.principalId) : deps.store.server());

    if (scope.kind === "server" && auth.kind === "session" && !auth.scopes.includes("admin")) {
      return json(res, 403, { error: "forbidden: only this server's owner can change its bot settings", code: "bot_settings_server_owner_only" });
    }
    if (!/^application\/json\b/i.test(String(req.headers["content-type"] ?? ""))) {
      return json(res, 415, { error: "send the settings as JSON (content-type: application/json)" });
    }
    const parsed = botSettingsPatchSchema.safeParse(await readBody(req));
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const message = issue?.code === "unrecognized_keys" ? `unknown setting: ${issue.keys[0]}` : issue?.message ?? "invalid settings";
      return json(res, 400, { error: message });
    }
    const saved = scope.kind === "person" ? deps.store.savePerson(scope.principalId, parsed.data) : deps.store.saveServer(parsed.data);
    deps.changed?.(scope, saved);
    return answer(saved);
  };
}
