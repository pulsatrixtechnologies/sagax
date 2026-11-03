// A signed-in person's own model, effort and notification choices for a bot
// they do not own (server/bots/viewer-bot-overrides.ts). GET lists theirs. PUT
// merges one bot. The owner's bot record is not a parameter of this route.
// Organization server only, same gate as /api/me/preferences.
import type { ViewerBotOverrideStore } from "../bots/viewer-bot-overrides.ts";
import { isViewerOverridePatch, sharedBotForViewer } from "../../shared/viewer-bot-overrides.ts";
import { PASS, type RouteHandler } from "./table.ts";

export const VIEWER_BOT_OVERRIDES_PATH = "/api/me/bot-overrides";
const ONE = /^\/api\/me\/bot-overrides\/([\w-]+)$/;

export interface ViewerBotOverrideRouteDeps {
  store: ViewerBotOverrideStore;
  organization: () => boolean;
  /** The bot as stored, so a write can be refused when this person owns it. */
  bot: (id: string) => { ownerUserId?: string | null } | null;
  /** Whether this person sees the bot at all. Absent: every bot is seen.
   * One they cannot see answers "no such bot", the same as a missing id. */
  sees?: (principalId: string, botId: string) => boolean;
}

export function createViewerBotOverrideRoutes(deps: ViewerBotOverrideRouteDeps): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    const one = ONE.exec(path);
    if (path !== VIEWER_BOT_OVERRIDES_PATH && !one) return PASS;
    const principalId = auth.kind === "session" ? auth.session.principalId?.trim() : undefined;
    if (!deps.organization() || !principalId) {
      return json(res, 404, { error: "These choices are kept on an organization server, for a signed-in person." });
    }
    if (path === VIEWER_BOT_OVERRIDES_PATH) {
      if (method !== "GET") return json(res, 405, { error: "GET" });
      try {
        return json(res, 200, { overrides: deps.store.getAll(principalId) });
      } catch (error) {
        const status = typeof error === "object" && error && "status" in error ? Number((error as { status: number }).status) : 500;
        return json(res, status, { error: "not a person" });
      }
    }
    if (method !== "PUT") return json(res, 405, { error: "PUT" });
    const botId = one![1]!;
    const record = deps.bot(botId);
    if (!record || (deps.sees && !deps.sees(principalId, botId))) return json(res, 404, { error: "no such bot" });
    if (!sharedBotForViewer(record.ownerUserId, principalId)) {
      return json(res, 403, { error: "The owner changes this bot's own model and notifications.", code: "owner_bot_settings" });
    }
    if (!/^application\/json\b/i.test(String(req.headers["content-type"] ?? ""))) {
      return json(res, 415, { error: "send the choice as JSON (content-type: application/json)" });
    }
    const body = await readBody(req);
    if (!isViewerOverridePatch(body)) return json(res, 400, { error: "model, effort, variant and notifications are the only fields" });
    try {
      const override = deps.store.put(principalId, botId, body);
      return json(res, 200, { botId, override });
    } catch (error) {
      const status = typeof error === "object" && error && "status" in error ? Number((error as { status: number }).status) : 500;
      return json(res, status === 507 ? 507 : 400, { error: status === 507 ? "too many" : "not stored" });
    }
  };
}
