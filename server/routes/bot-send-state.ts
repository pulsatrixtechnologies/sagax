// Whether this person's message to a bot can be answered now:
//
//   GET /api/bots/:id/send-state?threadId=   { block: SendBlock | null }
//   POST /api/bots/:id/send-state/fix?threadId=  { fix }  ->  { ok, block }
//
// #2013: a Fix repairs a cause Sagax can repair itself (the Codex account's
// native MCP entries), then answers the send state again.
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
  /** Repair `fix` for this conversation; false when it is not one Sagax knows. */
  fixSendState?: (bot: B, fix: string, auth: RequestAuth) => { ok: boolean };
}

const ROUTE = /^\/api\/bots\/([\w-]+)\/send-state$/;
const FIX_ROUTE = /^\/api\/bots\/([\w-]+)\/send-state\/fix$/;

export function createBotSendStateRoutes<B>(deps: BotSendStateRouteDeps<B>): RouteHandler {
  return async ({ req, res, url, path, method, auth, json, readBody }) => {
    const fix = FIX_ROUTE.exec(path);
    if (fix && method === "POST" && deps.fixSendState) {
      res.setHeader("cache-control", "no-store");
      const bot = deps.requestedTaskBot(fix[1]!, url.searchParams.get("threadId") ?? undefined);
      const body = await readBody(req, 4_096) as { fix?: unknown } | null;
      const done = typeof body?.fix === "string" ? deps.fixSendState(bot, body.fix, auth) : { ok: false };
      if (!done.ok) return json(res, 400, { error: "unknown fix" });
      return json(res, 200, { ...done, block: await deps.sendStateFor(bot, auth) });
    }
    const m = ROUTE.exec(path);
    if (!m || method !== "GET") return PASS;
    res.setHeader("cache-control", "no-store");
    const bot = deps.requestedTaskBot(m[1]!, url.searchParams.get("threadId") ?? undefined);
    return json(res, 200, { block: await deps.sendStateFor(bot, auth) });
  };
}
