// #2698: GET /api/bots/:id/proactive-metrics?days=7|30|90 (default 7; any
// other value is 400): the bot's proactivity figures over the last days, from
// the ledger in server/proactive/proactive-metrics.ts (shape and meaning in
// shared/proactive-metrics.ts).
//
// Access, the same rule as GET /api/bots/:id/analytics for bot-wide rows:
// a bot that does not exist or that the caller cannot see answers 404; the
// figures are the bot's own (every wake and proposal), so only the owner, a
// manage or edit grant holder or an org admin reads them, anyone else gets
// 404 too and the Analytics tab leaves the group out.
import type { RequestAuth } from "../auth/request-auth.ts";
import { parseAnalyticsDays, type BotAnalyticsDays } from "../../shared/bot-analytics.ts";
import type { ProactiveMetrics } from "../../shared/proactive-metrics.ts";
import { PASS, type RouteHandler } from "./table.ts";

const ROUTE = /^\/api\/bots\/([\w-]+)\/proactive-metrics$/;

export interface ProactiveMetricsRouteDeps<B extends { id: string }> {
  bot: (id: string) => B | undefined;
  sees: (auth: RequestAuth, bot: B) => boolean;
  seesAll: (auth: RequestAuth, bot: B) => boolean;
  read: (botId: string, days: BotAnalyticsDays) => ProactiveMetrics;
}

export function createProactiveMetricsRoutes<B extends { id: string }>(deps: ProactiveMetricsRouteDeps<B>): RouteHandler {
  return async ({ res, path, method, url, auth, json }) => {
    const match = ROUTE.exec(path);
    if (!match) return PASS;
    if (method !== "GET") return json(res, 405, { error: "method not allowed" });
    const days = parseAnalyticsDays(url.searchParams.get("days"));
    if (days === null) return json(res, 400, { error: "days must be 7, 30 or 90" });
    const bot = deps.bot(match[1]!);
    if (!bot || !deps.sees(auth, bot) || !deps.seesAll(auth, bot)) return json(res, 404, { error: "bot not found" });
    return json(res, 200, deps.read(bot.id, days));
  };
}
