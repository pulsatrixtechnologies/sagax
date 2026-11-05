// Pre-auth health probes (#1388 wave 4): /healthz and environment before
// resolveRequestAuth; unauthenticated /api/health and /api/brand after
// resolve so a signed-in caller falls through to the post-gate handlers.
import { PASS, type PreAuthRouteHandler } from "./table.ts";

export interface HealthPublicRouteDeps {
  isShuttingDown(): boolean;
  healthzBody(): unknown;
  healthzUnreadyBody(): unknown;
  environmentPaths: readonly string[];
  environmentDescriptor(): unknown;
}

export interface UnauthHealthBrandRouteDeps {
  isShuttingDown(): boolean;
  healthzUnreadyBody(): unknown;
  /** Spread into the stranger /api/health body (app + product + version).
   * #1996: version is the Sagax release people know (forkVersion). */
  healthIdentity: { readonly app: string; readonly product: string; readonly version: string };
  loadBrand(): unknown;
}

/** GET /healthz and GET environment paths. Wire into PRE_AUTH_ROUTES. */
export function createHealthPublicRoutes(deps: HealthPublicRouteDeps): PreAuthRouteHandler {
  return async ({ res, path, method, json }) => {
    if (method === "GET" && path === "/healthz") {
      if (deps.isShuttingDown()) return json(res, 503, deps.healthzUnreadyBody());
      return json(res, 200, deps.healthzBody());
    }
    if (method === "GET" && deps.environmentPaths.includes(path)) {
      return json(res, 200, deps.environmentDescriptor());
    }
    return PASS;
  };
}

/** GET /api/health and GET /api/brand when auth is null. Wire into
 * PRE_AUTH_AFTER_RESOLVE so authenticated callers reach post-gate handlers. */
export function createUnauthHealthBrandRoutes(deps: UnauthHealthBrandRouteDeps): PreAuthRouteHandler {
  return async ({ res, path, method, auth, json }) => {
    if (method === "GET" && path === "/api/health" && !auth) {
      if (deps.isShuttingDown()) return json(res, 503, deps.healthzUnreadyBody());
      return json(res, 200, { ...deps.healthIdentity });
    }
    if (method === "GET" && path === "/api/brand" && !auth) {
      return json(res, 200, deps.loadBrand());
    }
    return PASS;
  };
}
