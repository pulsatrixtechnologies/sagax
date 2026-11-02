// The fleet-wide authorization decision log (read-only).
//
//   GET /api/decisions        newest last, optional ?limit=
//   GET /api/decisions.csv    same rows over a date range, for a spreadsheet
//
// Admin scope by default (not in CLIENT_ALLOW, not a service route).
import { decisionsCsv, readDecisionRange, readDecisions } from "../decision-log.ts";
import { parseUsageRange } from "../usage-ledger.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface DecisionsRouteDeps {
  dataDir: string;
}

export function createDecisionsRoutes(deps: DecisionsRouteDeps): RouteHandler {
  return async ({ res, url, path, method, json }) => {
    if (method === "GET" && path === "/api/decisions") {
      const rawLimit = url.searchParams.get("limit");
      const parsedLimit = rawLimit === null ? undefined : Number(rawLimit);
      if (parsedLimit !== undefined && (!Number.isInteger(parsedLimit) || parsedLimit <= 0)) {
        return json(res, 400, { error: "limit must be a positive whole number" });
      }
      return json(res, 200, { decisions: readDecisions(deps.dataDir, parsedLimit ?? 200) });
    }
    // The same rows for an auditor's spreadsheet, over a date range. Admin
    // scope by default (not in CLIENT_ALLOW, not a service route).
    if (method === "GET" && path === "/api/decisions.csv") {
      const range = parseUsageRange(url.searchParams.get("from"), url.searchParams.get("to"));
      if (!range) return json(res, 400, { error: "from and to must be YYYY-MM-DD, from no later than to, at most a year apart" });
      const stamp = (date: Date) => date.toISOString().slice(0, 10);
      res.writeHead(200, {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="decisions-${stamp(range.from)}-${stamp(range.to)}.csv"`,
        "cache-control": "no-store",
      });
      res.end(decisionsCsv(readDecisionRange(deps.dataDir, range)));
      return;
    }
    return PASS;
  };
}
