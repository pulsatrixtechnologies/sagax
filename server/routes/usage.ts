// The usage ledger: what this workspace spent over a period.
// Read-only over the month files usage-ledger.ts appends at turn.completed.
// Admin scope by default, like every route not opened to clients
// (server/request-auth.ts).
//
// GET /api/usage and GET /api/usage.csv: the whole ledger, admin (or the
// usage.view permission on an organization server).
//
// GET /api/usage/traces (2026-10-22): per-job usage traces, where each job
// spent its time and its money, built from the same ledger. Same scope as
// the whole ledger (admin or usage.view); for the owner/admin, never clients.
//
// GET /api/me/usage (2026-10-15): the caller's own turns and nothing else,
// open to every signed-in person (request-auth.ts CLIENT_ALLOW). Settings >
// Usage reads it, so a member sees their own plan and cost; the
// organization's totals stay in its admin console.
import { clearPersonalCap, MIN_PERSONAL_CAP_USD, personalCapState, writePersonalCap } from "../personal-spend-cap.ts";
import type { PriceList } from "../prices.ts";
import type { SpendState } from "../spend.ts";
import {
  parseUsageRange,
  readUsage,
  summarizeUsage,
  usageCsv,
  usageRowsFor,
  type UsageViewer,
  USAGE_GROUPINGS,
  type UsageGroupBy,
} from "../usage-ledger.ts";
import { buildUsageTraces, USAGE_TRACE_MAX_JOBS } from "../usage-trace.ts";
import type { RequestAuth } from "../request-auth.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface UsageRouteDeps {
  dataDir: string;
  /** The operator's price list, when the server may read it (`billing`). */
  prices(): PriceList | null;
  /** The cap and where the month stands; null when there is no enforceable cap. */
  budget(): SpendState | null;
  /** Billing currency, read only when a price list is applied. */
  currency(): string;
  /** An organization server (Perspicax): every reader of /api/me/usage must
   * be a person there; a session that names nobody is refused. */
  organization(): boolean;
}

export function usageViewerOf(auth: RequestAuth): UsageViewer {
  if (auth.kind === "loopback") return { kind: "operator" };
  const { principalId, email } = auth.session;
  return principalId || email ? { kind: "person", principalId, email } : { kind: "operator" };
}

/** Who /api/me/usage answers for, or null when the caller names nobody on
 * an organization server. On a solo server a session that names nobody is
 * the owner's paired device, which reads the owner's turns (the operator). */
export function ownUsageViewer(auth: RequestAuth, organization: boolean): UsageViewer | null {
  const viewer = usageViewerOf(auth);
  if (viewer.kind === "operator" && organization && auth.kind === "session") return null;
  return viewer;
}

export function createUsageRoutes(deps: UsageRouteDeps): RouteHandler {
  return async ({ res, req, url, path, method, json, readBody, auth }) => {
    // The person's own monthly spend limit (server/personal-spend-cap.ts).
    // Read: every signed-in person. Write: admin scope (the owner), solo only.
    if (path === "/api/me/spend-cap" && (method === "GET" || method === "PUT")) {
      const organization = deps.organization();
      if (method === "GET") {
        res.setHeader("cache-control", "no-store");
        return json(res, 200, { supported: !organization, minUsd: MIN_PERSONAL_CAP_USD, cap: organization ? null : personalCapState(deps.dataDir) });
      }
      if (organization) return json(res, 409, { error: "a personal limit is set in your organization's console on this server" });
      let body: { monthlyUsd?: unknown };
      try {
        body = ((await readBody(req)) ?? {}) as { monthlyUsd?: unknown };
      } catch {
        return json(res, 400, { error: "invalid JSON" });
      }
      if (body.monthlyUsd === null) {
        clearPersonalCap(deps.dataDir);
      } else if (typeof body.monthlyUsd !== "number" || !Number.isFinite(body.monthlyUsd) || body.monthlyUsd < MIN_PERSONAL_CAP_USD) {
        return json(res, 400, { error: `monthlyUsd must be a number of at least ${MIN_PERSONAL_CAP_USD}, or null to remove the limit` });
      } else {
        writePersonalCap(deps.dataDir, body.monthlyUsd);
      }
      res.setHeader("cache-control", "no-store");
      return json(res, 200, { supported: true, minUsd: MIN_PERSONAL_CAP_USD, cap: personalCapState(deps.dataDir) });
    }
    if (method === "GET" && path === "/api/me/usage") {
      const viewer = ownUsageViewer(auth, deps.organization());
      if (!viewer) return json(res, 403, { error: "sign in as a person first" });
      const range = parseUsageRange(url.searchParams.get("from"), url.searchParams.get("to"));
      if (!range) return json(res, 400, { error: "from and to must be YYYY-MM-DD, from no later than to, at most a year apart" });
      const requested = url.searchParams.get("groupBy") ?? "bot";
      // Never by person: the answer holds one person's turns only.
      if (requested === "user" || !USAGE_GROUPINGS.includes(requested as UsageGroupBy)) {
        return json(res, 400, { error: `groupBy must be one of ${USAGE_GROUPINGS.filter((group) => group !== "user").join(", ")}` });
      }
      const groupBy = requested as UsageGroupBy;
      const prices = deps.prices();
      res.setHeader("cache-control", "no-store");
      // No budget: the cap and the month's spend are the installation's, not the person's.
      return json(res, 200, {
        from: range.from.toISOString(),
        to: range.to.toISOString(),
        groupBy,
        ...summarizeUsage(usageRowsFor(readUsage(deps.dataDir, range), viewer), groupBy, prices),
        billing: prices ? { currency: deps.currency() } : null,
      });
    }
    // GET /api/me/usage/traces (2026-10-23): the caller's OWN per-job traces
    // and nothing else, open to every signed-in person like /api/me/usage.
    // Each signed-in person sees where their own jobs spent their time and
    // money; another person's turns never ride along (usageRowsFor). Org-wide
    // traces stay the admin console's (/api/usage/traces), never the app's.
    if (method === "GET" && path === "/api/me/usage/traces") {
      const viewer = ownUsageViewer(auth, deps.organization());
      if (!viewer) return json(res, 403, { error: "sign in as a person first" });
      const range = parseUsageRange(url.searchParams.get("from"), url.searchParams.get("to"));
      if (!range) return json(res, 400, { error: "from and to must be YYYY-MM-DD, from no later than to, at most a year apart" });
      const max = Number(url.searchParams.get("max"));
      res.setHeader("cache-control", "no-store");
      return json(res, 200, {
        from: range.from.toISOString(),
        to: range.to.toISOString(),
        ...buildUsageTraces(usageRowsFor(readUsage(deps.dataDir, range), viewer), Number.isFinite(max) && max > 0 ? { max: Math.min(Math.trunc(max), USAGE_TRACE_MAX_JOBS) } : {}),
      });
    }
    // GET /api/usage/traces (2026-10-22, port of OpenMausBot #3316 rebuilt on
    // our ledger): per-job traces, where each job spent its time and money.
    // Owner or usage.view, like the whole ledger; never opened to clients.
    if (method === "GET" && path === "/api/usage/traces") {
      const range = parseUsageRange(url.searchParams.get("from"), url.searchParams.get("to"));
      if (!range) return json(res, 400, { error: "from and to must be YYYY-MM-DD, from no later than to, at most a year apart" });
      const max = Number(url.searchParams.get("max"));
      res.setHeader("cache-control", "no-store");
      return json(res, 200, {
        from: range.from.toISOString(),
        to: range.to.toISOString(),
        ...buildUsageTraces(readUsage(deps.dataDir, range), Number.isFinite(max) && max > 0 ? { max: Math.min(Math.trunc(max), USAGE_TRACE_MAX_JOBS) } : {}),
      });
    }
    if (!(method === "GET" && (path === "/api/usage" || path === "/api/usage.csv"))) return PASS;
    const range = parseUsageRange(url.searchParams.get("from"), url.searchParams.get("to"));
    if (!range) return json(res, 400, { error: "from and to must be YYYY-MM-DD, from no later than to, at most a year apart" });
    // ?mine=1 (2026-10-14): only the requester's own turns, for the app's
    // Settings > Usage; the organization's totals belong to its admin console.
    const all = readUsage(deps.dataDir, range);
    const rows = url.searchParams.get("mine") === "1" ? usageRowsFor(all, usageViewerOf(auth)) : all;
    // The operator's price list is applied only with the billing entitlement.
    const prices = deps.prices();
    if (path === "/api/usage.csv") {
      const stamp = (date: Date) => date.toISOString().slice(0, 10);
      res.writeHead(200, {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="usage-${stamp(range.from)}-${stamp(range.to)}.csv"`,
        "cache-control": "no-store",
      });
      res.end(usageCsv(rows, prices));
      return;
    }
    const requested = url.searchParams.get("groupBy") ?? "bot";
    if (!USAGE_GROUPINGS.includes(requested as UsageGroupBy)) {
      return json(res, 400, { error: `groupBy must be one of ${USAGE_GROUPINGS.join(", ")}` });
    }
    const groupBy = requested as UsageGroupBy;
    res.setHeader("cache-control", "no-store");
    return json(res, 200, {
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      groupBy,
      ...summarizeUsage(rows, groupBy, prices),
      budget: deps.budget(),
      billing: prices ? { currency: deps.currency() } : null,
    });
  };
}
