// Settings → Activity: admin actions and approvals together, filtered by
// who, what and when; the same list as CSV. Admin scope by default.
//
//   GET /api/admin-activity
//   GET /api/admin-activity.csv
import {
  activityCsv,
  activityEntries,
  parseActivityWhat,
  readAdminActivityRange,
} from "../activity/admin-activity.ts";
import { boundRetentionDays, readDecisionRange } from "../decision-log.ts";
import { parseUsageRange } from "../usage/usage-ledger.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface AdminActivityRouteDeps {
  dataDir: string;
  /** Display name for a principal id in the who column. */
  adminPersonName: (principalId: string) => string;
  /** Whether this server records admin activity at all. */
  adminActivityRecording: () => boolean;
}

export function createAdminActivityRoutes(deps: AdminActivityRouteDeps): RouteHandler {
  return async ({ res, url, path, method, json }) => {
    if (!(method === "GET" && (path === "/api/admin-activity" || path === "/api/admin-activity.csv"))) {
      return PASS;
    }
    const fromParam = url.searchParams.get("from") || new Date(Date.now() - 29 * 24 * 60 * 60_000).toISOString().slice(0, 10);
    const range = parseUsageRange(fromParam, url.searchParams.get("to"));
    if (!range) return json(res, 400, { error: "from and to must be dates (YYYY-MM-DD), from no later than to, at most a year apart" });
    const what = parseActivityWhat(url.searchParams.get("what"));
    if (!what) return json(res, 400, { error: "what must be all, approvals, decisions, config, people, session, webhook, mcp, engine, bot, budget, visibility, rights, section, org or approval" });
    const entries = activityEntries(readDecisionRange(deps.dataDir, range), readAdminActivityRange(deps.dataDir, range), {
      what,
      who: (url.searchParams.get("who") ?? "").slice(0, 200),
    }, (principalId) => deps.adminPersonName(principalId));
    if (path.endsWith(".csv")) {
      const stamp = (date: Date) => date.toISOString().slice(0, 10);
      res.writeHead(200, {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="activity-${stamp(range.from)}-${stamp(range.to)}.csv"`,
        "cache-control": "no-store",
      });
      res.end(activityCsv(entries));
      return;
    }
    const rawLimit = Number(url.searchParams.get("limit") ?? 500);
    const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 5_000) : 500;
    res.setHeader("cache-control", "no-store");
    return json(res, 200, {
      entries: entries.slice(0, limit),
      total: entries.length,
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      retentionDays: boundRetentionDays(),
      recording: deps.adminActivityRecording(),
    });
  };
}
