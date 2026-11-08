// Subscription windows (5-hour and weekly), not the token ledger.
//
//   GET /api/plan-usage
//   GET /api/plan-usage/history?days=90   (#2757: past periods, % of limit used)
//
// Solo: this computer's own logins, admin only (unlisted). Organization
// server: the asking person's own subscription logins, never the
// server's, the organization's key or another person's
// (server/usage/plan-usage.ts); a member may read their own
// (request-auth.ts CLIENT_ALLOW, orgDirectory).
import type { AppConfig } from "../config.ts";
import { driverKeyBacked, instanceConfigs } from "../config.ts";
import { providersOfInstance } from "../engines/engine-credentials.ts";
import {
  loadPlanUsage,
  orgPlanAccounts,
  planAccountsFromInstances,
  type PlanUsageReport,
} from "../usage/plan-usage.ts";
import { PLAN_HISTORY_DEFAULT_DAYS, type PlanHistoryStore } from "../usage/plan-history.ts";
import { isPrincipalId } from "../auth/principals.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface PlanUsageRouteDeps {
  cfg: () => AppConfig;
  /** Organization (Perspicax) server. */
  isOrganization: () => boolean;
  /** Present only on an organization server that tracks per-person logins. */
  engineLogins: () => {
    loginDir: (principalId: string, driver: "claudeAgent" | "codex" | "grokAgent", slot?: "primary", instanceId?: string) => string;
    signedIn: (principalId: string, driver: "claudeAgent" | "codex" | "grokAgent", slot?: "primary", instanceId?: string) => boolean;
  } | null;
  principals: {
    byId: (principalId: string) => { subject?: { iss: string; sub: string } } | null | undefined;
  };
  /** Perspicax directory; null when not linked. */
  perspicaxDirectory: () => { providerKeys: (sub: string) => readonly string[] } | null;
  /** Issuer of this organization server's subjects. */
  identityIssuer: () => string;
  localPrincipalId: () => string;
  announcePlanThresholds: (report: PlanUsageReport, scope: string) => void;
  /** #2757: every report read is a snapshot of the plan history; absent, no history is kept. */
  planHistory?: PlanHistoryStore;
  /** Defaults to server/usage/plan-usage.ts loadPlanUsage (tests inject a stub). */
  loadPlanUsage?: typeof loadPlanUsage;
}

export function createPlanUsageRoutes(deps: PlanUsageRouteDeps): RouteHandler {
  return async ({ res, url, path, method, auth, json }) => {
    const windows = method === "GET" && path === "/api/plan-usage";
    if (!windows && !(method === "GET" && path === "/api/plan-usage/history")) return PASS;
    res.setHeader("cache-control", "no-store");
    if (method === "GET" && path === "/api/plan-usage/history") {
      // Same reach as the windows: a person's own on an organization server, the server's for an admin.
      let scope = "server";
      if (deps.isOrganization() && deps.engineLogins()) {
        const principalId = auth.kind === "session" ? auth.session.principalId?.trim() || "" : deps.localPrincipalId();
        if (!principalId || !isPrincipalId(principalId)) return json(res, 403, { error: "sign in as a person first" });
        scope = principalId;
      } else if (!auth.scopes.includes("admin")) return json(res, 403, { error: "admin only" });
      const days = Number(url.searchParams.get("days") ?? PLAN_HISTORY_DEFAULT_DAYS);
      const empty = { updatedAt: null, accounts: [], periods: [] };
      return json(res, 200, deps.planHistory?.read(scope, Number.isFinite(days) && days > 0 ? days : PLAN_HISTORY_DEFAULT_DAYS) ?? empty);
    }
    const refresh = url.searchParams.get("refresh") === "1";
    const cfg = deps.cfg();
    const instances = instanceConfigs(cfg);
    // A key row (no plan windows) is listed only when a key is kept for
    // that provider: the workspace key of Settings > Connections, or one in
    // the engine's own environment.
    const planKeyConfigured = (driver: string, instanceId: string): boolean => {
      const workspace = driver === "claudeAgent" ? cfg.anthropic?.key : driver === "codex" ? cfg.openai?.key : driver === "grokAgent" ? cfg.xai?.key : undefined;
      return Boolean(workspace?.trim()) || driverKeyBacked(cfg, driver, instanceId);
    };
    const engineLogins = deps.engineLogins();
    if (deps.isOrganization() && engineLogins) {
      const principalId = auth.kind === "session" ? auth.session.principalId?.trim() || "" : deps.localPrincipalId();
      if (!principalId || !isPrincipalId(principalId)) return json(res, 403, { error: "sign in as a person first" });
      const person = deps.principals.byId(principalId);
      const issuer = deps.identityIssuer();
      const sub = person?.subject?.iss === issuer ? person.subject.sub : undefined;
      const held = sub ? deps.perspicaxDirectory()?.providerKeys(sub) ?? [] : [];
      const logins = engineLogins;
      const accounts = orgPlanAccounts(instances, {
        loginDir: (driver, instanceId) => logins.loginDir(principalId, driver, "primary", instanceId),
        signedIn: (driver, instanceId) => logins.signedIn(principalId, driver, "primary", instanceId),
        apiKeyConfigured: (_driver, instanceId) => {
          const driver = instances[instanceId]?.driver ?? "";
          return providersOfInstance(instanceId, driver).some((provider) => held.includes(provider)) || planKeyConfigured(driver, instanceId);
        },
      });
      const report = await (deps.loadPlanUsage ?? loadPlanUsage)({ accounts, refresh });
      deps.announcePlanThresholds(report, principalId);
      deps.planHistory?.record(report, principalId);
      return json(res, 200, report);
    }
    if (!auth.scopes.includes("admin")) return json(res, 403, { error: "admin only" });
    const accounts = planAccountsFromInstances(instances, {
      apiKeyConfigured: (_driver, instanceId) => planKeyConfigured(instances[instanceId]?.driver ?? "", instanceId),
    });
    const report = await (deps.loadPlanUsage ?? loadPlanUsage)({ accounts, refresh });
    deps.announcePlanThresholds(report, "server");
    deps.planHistory?.record(report, "server");
    return json(res, 200, report);
  };
}
