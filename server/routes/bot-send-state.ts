// Whether this person's message to a bot can be answered now:
//
//   GET /api/bots/:id/send-state?threadId=   { block: SendBlock | null }
//
// The maintainer, 2026-10-27: a certain no (the engine not connected for them,
// the computer or local server behind the model down) keeps the composer from
// sending, with one line and the one thing to do; anything uncertain sends as
// before (shared/send-state.ts).
import type { SendBlock } from "../../shared/send-state.ts";
import type { RequestAuth } from "../auth/request-auth.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface BotSendStateRouteDeps<B> {
  /** The bot (and thread) the request names; throws like the other bot routes when there is none. */
  requestedTaskBot: (botId: string, threadId?: string) => B;
  sendStateFor: (bot: B, auth: RequestAuth) => SendBlock | null | Promise<SendBlock | null>;
}

const ROUTE = /^\/api\/bots\/([\w-]+)\/send-state$/;

export function createBotSendStateRoutes<B>(deps: BotSendStateRouteDeps<B>): RouteHandler {
  return async ({ res, url, path, method, auth, json }) => {
    const m = ROUTE.exec(path);
    if (!m || method !== "GET") return PASS;
    res.setHeader("cache-control", "no-store");
    const bot = deps.requestedTaskBot(m[1]!, url.searchParams.get("threadId") ?? undefined);
    return json(res, 200, { block: await deps.sendStateFor(bot, auth) });
  };
}
