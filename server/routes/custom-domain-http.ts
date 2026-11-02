// Custom domain HTTP routes (#1388 wave 4):
//
// Pre-auth (PRE_AUTH_ROUTES):
//   GET /.well-known/{sagax|openmausbot}/domain-check/:hash
//
// Authenticated (ROUTES):
//   GET|POST|DELETE /api/settings/custom-domain
//
// Challenge proof is public; connecting or clearing a domain is post-gate
// admin-scoped via request-auth. Never imports server/index.ts.
import {
  PASS,
  type PreAuthRouteHandler,
  type RouteHandler,
} from "./table.ts";

const DOMAIN_CHECK =
  /^\/\.well-known\/(?:sagax|openmausbot)\/domain-check\/([a-f0-9]{64})$/;

export interface CustomDomainPublicDeps {
  challenge(hash: string): unknown | null;
}

export interface CustomDomainSettingsDeps {
  status(): unknown;
  desktopManaged: boolean;
  clearDomain(): void;
  revision(): number;
  verify(domain: string): Promise<{ origin: string }>;
  sessionsIsLive(sessionId: string): boolean;
  setDomain(origin: string): void;
}

/** Public domain-check challenge (cache-control: no-store). */
export function createCustomDomainPublicRoutes(
  deps: CustomDomainPublicDeps,
): PreAuthRouteHandler {
  return async ({ res, path, method, json }) => {
    if (method !== "GET") return PASS;
    const match = DOMAIN_CHECK.exec(path);
    if (!match) return PASS;
    res.setHeader("cache-control", "no-store");
    const challenge = deps.challenge(match[1]!);
    return json(res, challenge ? 200 : 404, challenge ?? { error: "No active domain check." });
  };
}

/** Post-gate custom domain status, connect and clear. */
export function createCustomDomainSettingsRoutes(
  deps: CustomDomainSettingsDeps,
): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    // the literal path keeps this route in the tool policy inventory (scripts/tool-policy)
    if (!(path === "/api/settings/custom-domain")) return PASS;
    res.setHeader("cache-control", "no-store");
    if (method === "GET") return json(res, 200, deps.status());
    if (method === "POST" || method === "DELETE") {
      if (deps.desktopManaged) {
        return json(res, 409, {
          error: "Custom domains are configured on a self-hosted Sagax server, not the desktop companion.",
        });
      }
      if (!/^application\/json\b/i.test(String(req.headers["content-type"] ?? ""))) {
        return json(res, 415, { error: "content-type must be application/json" });
      }
      if (method === "DELETE") {
        deps.clearDomain();
        return json(res, 200, deps.status());
      }
      const body = await readBody(req, 4096) as { domain?: unknown } | null;
      if (typeof body?.domain !== "string") {
        return json(res, 400, { error: "Enter your domain name." });
      }
      const revision = deps.revision();
      const verified = await deps.verify(body.domain);
      if (auth.kind === "session" && !deps.sessionsIsLive(auth.session.id)) {
        return json(res, 401, {
          error: "Your session ended. Sign in again before connecting a domain.",
        });
      }
      if (revision !== deps.revision()) {
        return json(res, 409, {
          error: "Domain settings changed during verification. Try again.",
        });
      }
      deps.setDomain(verified.origin);
      return json(res, 200, deps.status());
    }
    return PASS;
  };
}
