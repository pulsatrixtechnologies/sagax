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
//
// ?view=breakdown&period=7|30|month (#2612, the V6 "Statistiques d'usage"):
// the same rows, same access, split by account, model, source and person
// (server/telemetry/usage-stats.ts), with the tool, MCP and sub-agent calls
// of the bot's own threads from the local span files. A person group keyed
// by a principal carries the directory name, never the id: the label is ""
// when the directory has no name for it.
import type { RequestAuth } from "../auth/request-auth.ts";
import type { PriceList } from "../usage/prices.ts";
import { readUsage, usageRowsFor, type UsageViewer } from "../usage/usage-ledger.ts";
import { aggregateBotAnalytics, analyticsRange, parseAnalyticsDays, parseUsageOffset, parseUsagePeriod, usagePeriodWindow, analyticsDayKey, type BotAnalyticsRun } from "../../shared/bot-analytics.ts";
import type { BotUsageBreakdown } from "../../shared/telemetry.ts";
import { buildUsageDays, buildUsageStats, readToolSpans } from "../telemetry/usage-stats.ts";
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
    const breakdown = url.searchParams.get("view") === "breakdown";
    const days = breakdown ? 7 : parseAnalyticsDays(url.searchParams.get("days"));
    if (days === null) return json(res, 400, { error: "days must be 7, 30 or 90" });
    const period = breakdown ? parseUsagePeriod(url.searchParams.get("period")) : null;
    if (breakdown && period === null) return json(res, 400, { error: "period must be 7, 30 or month" });

    const offset = breakdown ? parseUsageOffset(url.searchParams.get("offset")) : 0;
    if (offset === null) return json(res, 400, { error: "offset must be a whole number from 0 to 52" });

    const bot = deps.bot(match[1]!);
    if (!bot || !deps.sees(auth, bot)) return json(res, 404, { error: "no such bot" });

    const timeZone = deps.timeZone?.() ?? "UTC";
    if (breakdown && period !== null) {
      const window = usagePeriodWindow(period, deps.now?.() ?? Date.now(), timeZone, offset);
      const span = { from: window.from, to: window.to };
      const own = readUsage(deps.dataDir, span).filter((row) => row.botId === bot.id);
      const viewer = deps.viewer(auth);
      const rows = deps.seesAll(auth, bot) ? own : viewer.kind === "person" ? usageRowsFor(own, viewer) : [];
      const threads = new Set(rows.map((row) => row.threadId));
      const spans = readToolSpans(deps.dataDir, span).filter((one) => one.threadId !== undefined && threads.has(one.threadId));
      const stats = buildUsageStats(rows, spans);
      stats.byPerson = stats.byPerson.map((group) => {
        if (group.key === "owner") return group;
        const name = deps.personName?.(group.key) ?? "";
        // An email or a name the ledger already carries is kept; a bare id or
        // the ledger's generic fallback is not (the client says "someone").
        const generic = group.label === group.key || group.label === "Signed-in user";
        const shown = name || (generic ? "" : group.label);
        return { ...group, label: shown };
      });
      const answer: BotUsageBreakdown = {
        from: span.from.toISOString(),
        to: span.to.toISOString(),
        period,
        currency: deps.prices() ? deps.currency() : null,
        ...stats,
        days: buildUsageDays(rows, window.dayKeys, (at) => analyticsDayKey(at, timeZone)),
        offset,
      };
      res.setHeader("cache-control", "no-store");
      return json(res, 200, answer);
    }
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
