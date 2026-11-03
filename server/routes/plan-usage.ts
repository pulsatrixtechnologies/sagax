// Subscription windows (5-hour and weekly), not the token ledger.
//
//   GET /api/plan-usage
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
import { isPrincipalId } from "../auth/principals.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface PlanUsageRouteDeps {
  cfg: () => AppConfig;
  /** Organization (Perspicax) server. */
  isOrganization: () => boolean;
  /** Present only on an organization server that tracks per-person logins. */
  engineLogins: () => {
    loginDir: (principalId: string, driver: "claudeAgent" | "codex" | "grokAgent") => string;
    signedIn: (principalId: string, driver: "claudeAgent" | "codex" | "grokAgent") => boolean;
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
  /** Defaults to server/usage/plan-usage.ts loadPlanUsage (tests inject a stub). */
  loadPlanUsage?: typeof loadPlanUsage;
}

export function createPlanUsageRoutes(deps: PlanUsageRouteDeps): RouteHandler {
  return async ({ res, url, path, method, auth, json }) => {
    if (!(method === "GET" && path === "/api/plan-usage")) return PASS;
    res.setHeader("cache-control", "no-store");
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
        loginDir: (driver) => logins.loginDir(principalId, driver),
        signedIn: (driver) => logins.signedIn(principalId, driver),
        apiKeyConfigured: (_driver, instanceId) => {
          const driver = instances[instanceId]?.driver ?? "";
          return providersOfInstance(instanceId, driver).some((provider) => held.includes(provider)) || planKeyConfigured(driver, instanceId);
        },
      });
      const report = await (deps.loadPlanUsage ?? loadPlanUsage)({ accounts, refresh });
      deps.announcePlanThresholds(report, principalId);
      return json(res, 200, report);
    }
    if (!auth.scopes.includes("admin")) return json(res, 403, { error: "admin only" });
    const accounts = planAccountsFromInstances(instances, {
      apiKeyConfigured: (_driver, instanceId) => planKeyConfigured(instances[instanceId]?.driver ?? "", instanceId),
    });
    const report = await (deps.loadPlanUsage ?? loadPlanUsage)({ accounts, refresh });
    deps.announcePlanThresholds(report, "server");
    return json(res, 200, report);
  };
}
