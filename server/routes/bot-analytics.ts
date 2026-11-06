// GET /api/bots/:id/analytics?days=7|30|90 (default 7; any other value is
// 400): a bot's usage over the last days, from the usage ledger only
// (server/usage/usage-ledger.ts). The shape and the per-day rules live in
// shared/bot-analytics.ts; this file is the HTTP and access side.
//
// Access, the same rule as GET /api/bots/:id/history and the bot panel:
// - a bot that does not exist, or that the caller cannot see, answers 404;
// - the owner, a manage or edit grant holder, or an org admin (deps.seesAll)
//   reads every row of the bot;
// - any other person who can see the bot reads only their own turns
//   (usageRowsFor: user turns naming their principal or email, routine turns
//   running as them) and only the failed runs of routines running as them.
//
// Basis of the numbers, so the client can label them honestly:
// - tokens: input + output of each turn (headline meaning of src/lib/usage.ts);
// - costUsd: the ledger's recorded cost per turn (the server's price list at
//   the time of the turn, or the provider's own figure); null where no turn
//   carries one; currency is the billing currency when a price list is
//   applied (like /api/me/usage), else null;
// - hoursSaved: the sum of durationMs of the turns, in hours (the time the
//   bot worked); hoursSavedBasis "turnDuration" when at least one turn in
//   the range carries it, else null and hoursSaved is null;
// - routinesFailed: failed runs from the routine store (deps.runs), 0 when
//   the server has none;
// - days are cut in deps.timeZone (the server's routine time zone: the
//   server setting, else the organization default, else the host zone).
import type { RequestAuth } from "../auth/request-auth.ts";
import type { PriceList } from "../usage/prices.ts";
import { readUsage, usageRowsFor, type UsageViewer } from "../usage/usage-ledger.ts";
import { aggregateBotAnalytics, analyticsRange, parseAnalyticsDays, type BotAnalyticsRun } from "../../shared/bot-analytics.ts";
import { PASS, type RouteHandler } from "./table.ts";

const ROUTE = /^\/api\/bots\/([\w-]+)\/analytics$/;

export interface AnalyticsBot { id: string }

export interface BotAnalyticsRouteDeps<B extends AnalyticsBot = AnalyticsBot> {
  dataDir: string;
  bot: (id: string) => B | undefined;
  /** The caller may see this bot at all; false answers like a missing bot. */
  sees: (auth: RequestAuth, bot: B) => boolean;
  /** Owner, manage or edit grant, org admin: every row of the bot. */
  seesAll: (auth: RequestAuth, bot: B) => boolean;
  /** Who the caller is for the ledger (usageViewerOf). */
  viewer: (auth: RequestAuth) => UsageViewer;
  /** The applied price list; null means no billing currency to report. */
  prices: () => PriceList | null;
  currency: () => string;
  /** The bot's routine runs; absent leaves routinesFailed at 0. */
  runs?: (botId: string) => BotAnalyticsRun[];
  /** Directory label of a principal; "" when unknown. */
  personName?: (principalId: string) => string;
  /** IANA zone the days are cut in; UTC when absent. */
  timeZone?: () => string;
  /** The operator's principal, the person behind an owner turn. */
  localPrincipalId?: () => string;
  now?: () => number;
}

export function createBotAnalyticsRoutes<B extends AnalyticsBot = AnalyticsBot>(deps: BotAnalyticsRouteDeps<B>): RouteHandler {
  return async ({ res, path, method, url, auth, json }) => {
    const match = ROUTE.exec(path);
    if (!match || method !== "GET") return PASS;
    const days = parseAnalyticsDays(url.searchParams.get("days"));
    if (days === null) return json(res, 400, { error: "days must be 7, 30 or 90" });

    const bot = deps.bot(match[1]!);
    if (!bot || !deps.sees(auth, bot)) return json(res, 404, { error: "no such bot" });

    const timeZone = deps.timeZone?.() ?? "UTC";
    const range = analyticsRange(days, deps.now?.() ?? Date.now(), timeZone);
    const all = readUsage(deps.dataDir, range).filter((row) => row.botId === bot.id);
    const everything = deps.seesAll(auth, bot);
    const viewer = deps.viewer(auth);
    const rows = everything ? all : viewer.kind === "person" ? usageRowsFor(all, viewer) : [];
    const runs = (deps.runs?.(bot.id) ?? []).filter((run) => everything || (viewer.kind === "person" && Boolean(viewer.principalId) && run.runAs === viewer.principalId));

    const analytics = aggregateBotAnalytics(rows, {
      from: range.from,
      to: range.to,
      days,
      runs,
      names: deps.personName,
      timeZone,
      localPrincipalId: deps.localPrincipalId?.(),
    });
    analytics.currency = deps.prices() ? deps.currency() : null;
    res.setHeader("cache-control", "no-store");
    return json(res, 200, analytics);
  };
}
