// #3480: the quiet mode routes (shared/quiet-mode.ts). The bot's page and
// Settings read and write them, and a bot calls them through sagax_settings
// (bot.quietMode, notifications.quietMode) when its person tells it in words
// to be quiet or to speak again. A person sets it for their own bots only:
// the same owner check as the bot's other settings, no admin gate.
import type { RequestAuth } from "../auth/request-auth.ts";
import { parseQuietModeWrite, QUIET_MODE_BOT_ROUTE, QUIET_MODE_PERSON_PATH } from "../../shared/quiet-mode.ts";
import type { QuietMode, QuietModeBot } from "../quiet-mode/quiet-mode.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface QuietModeRouteDeps<B extends QuietModeBot> {
  quiet: QuietMode<B>;
  /** The person the request speaks for. */
  person(auth: RequestAuth): string;
  /** The bot, when this caller may change its settings. */
  ownBot(auth: RequestAuth, botId: string): B | undefined;
}

export function createQuietModeRoutes<B extends QuietModeBot>(deps: QuietModeRouteDeps<B>): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    const botMatch = QUIET_MODE_BOT_ROUTE.exec(path);
    if (path !== QUIET_MODE_PERSON_PATH && !botMatch) return PASS;
    if (method !== "GET" && method !== "PUT") return json(res, 405, { error: "GET or PUT" });
    let botId: string | undefined;
    if (botMatch) {
      try { botId = decodeURIComponent(botMatch[1]!); } catch { return json(res, 400, { error: "bad bot id" }); }
      if (!deps.ownBot(auth, botId)) return json(res, 404, { error: "no such bot" });
    }
    if (method === "GET") return json(res, 200, botId ? deps.quiet.view(botId) : deps.quiet.personView(deps.person(auth)));
    const write = parseQuietModeWrite(await readBody(req));
    if (typeof write === "string") return json(res, 400, { error: write });
    return json(res, 200, botId ? deps.quiet.setBot(botId, write.on) : deps.quiet.setPerson(deps.person(auth), write.on));
  };
}
