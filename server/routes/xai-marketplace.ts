// The xAI Bot Marketplace as a template source of Browse Bots
// (server/plugins/xai-marketplace.ts, shared/xai-marketplace.ts):
//
//   GET /api/team-library/xai                 ?refresh=1
//       { label, url, fetchedAt, bots, stale? }: every bot's card.
//   GET /api/team-library/xai/bots/:slug      ?refresh=1
//       { fetchedAt, bot, stale? }: one bot's memories, skills, routines, apps.
//
// Kept a few hours on the server; refresh=1 reads x.ai again. A failure
// answers { error, code } (xai_unreachable, xai_format, xai_blocked: 502;
// xai_not_found: 404), never x.ai's own error. Reads only x.ai's public pages
// and creates nothing: anyone signed in (request-auth.ts CLIENT_ALLOW).
// Adding a bot goes through the usual bot import (the app converts it, the
// phone through POST /api/bots/import/agent { marketplace }).
import { XaiMarketplaceError, type XaiMarketplaceSource } from "../plugins/xai-marketplace.ts";
import { PASS, type RouteHandler } from "./table.ts";

const ROUTE = /^\/api\/team-library\/xai(?:\/bots\/([^/]+))?$/;

export function createXaiMarketplaceRoutes(deps: { source: XaiMarketplaceSource }): RouteHandler {
  return async ({ res, url, path, method, json }) => {
    const match = ROUTE.exec(path);
    if (!match) return PASS;
    if (method !== "GET") return json(res, 405, { error: "GET only" });
    res.setHeader("cache-control", "private, no-store");
    const refresh = url.searchParams.get("refresh") === "1";
    try {
      if (match[1] === undefined) return json(res, 200, await deps.source.listBots({ refresh }));
      // A slug is plain lower-case letters, digits and dashes: nothing to decode.
      return json(res, 200, await deps.source.bot(match[1], { refresh }));
    } catch (error) {
      if (error instanceof XaiMarketplaceError) return json(res, error.status, { error: error.message, code: error.code });
      console.warn(`[xai-marketplace] ${error instanceof Error ? error.message : String(error)}`);
      return json(res, 502, { error: "The xAI Bot Marketplace could not be read.", code: "xai_unreachable" });
    }
  };
}
