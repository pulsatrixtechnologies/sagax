// Import preferences onto the person's own primary bot.
//
//   POST /api/me/preference-import/preview  { botId, text }
//   POST /api/me/preference-import/apply    { botId, text, accept: string[] }
//
// The apply call reads the text again and writes only the lines whose ids
// are in accept. A conflict is not written unless its id is there. Not an
// admin route, and not the agent import.
import type { RequestAuth } from "../auth/request-auth.ts";
import type { PreferenceStore } from "../people/preference-import.ts";
import { redactSecretsInText } from "../../shared/redact.ts";
import { PASS, type RouteHandler } from "./table.ts";

export function createPreferenceImportRoutes(deps: {
  preferences: () => PreferenceStore;
  /** True when this bot is the caller's own primary bot. */
  isOwnPrimary(auth: RequestAuth, botId: string): boolean;
}): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    const preview = method === "POST" && path === "/api/me/preference-import/preview";
    const apply = method === "POST" && path === "/api/me/preference-import/apply";
    if (!preview && !apply) return PASS;
    const body = await readBody(req) as { botId?: unknown; text?: unknown; accept?: unknown } | null;
    const botId = typeof body?.botId === "string" ? body.botId.trim() : "";
    const text = typeof body?.text === "string" ? redactSecretsInText(body.text) : "";
    if (!botId || !deps.isOwnPrimary(auth, botId)) {
      return json(res, 404, { error: "That is not your primary bot.", code: "not_primary" });
    }
    if (!text.trim()) return json(res, 400, { error: "text: the preference lines to review.", code: "bad_text" });
    const store = deps.preferences();
    if (preview) return json(res, 200, { lines: store.preview(botId, text) });
    const accept = Array.isArray(body?.accept) ? body.accept.filter((id): id is string => typeof id === "string") : [];
    const result = store.apply(botId, text, accept);
    return json(res, 200, { items: result.items, lines: result.preview });
  };
}
