// The person's own OpenAPI tools. No admin right. Headers are write-only.
// GET    /api/me/openapi
// PUT    /api/me/openapi   { spec, baseUrl?, headers? }
// DELETE /api/me/openapi
import type { RequestAuth } from "../auth/request-auth.ts";
import { openApiScope, type OpenApiScope, type OpenApiStore } from "../mcp/openapi-connector.ts";
import { PASS, type RouteHandler } from "./table.ts";

export const OPENAPI_PATH = "/api/me/openapi";

export interface OpenApiRouteDeps {
  store: OpenApiStore;
  scope(auth: RequestAuth): OpenApiScope | null;
}

export function createOpenApiRoutes(deps: OpenApiRouteDeps): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    if (path !== OPENAPI_PATH) return PASS;
    res.setHeader("cache-control", "no-store");
    const scope = deps.scope(auth);
    if (!scope) return json(res, 401, { error: "An API document belongs to one person: sign in first." });
    if (method === "GET") return json(res, 200, deps.store.view(scope));
    if (method === "DELETE") {
      deps.store.forget(scope);
      return json(res, 200, deps.store.view(scope));
    }
    if (method !== "PUT") return PASS;
    const body = await readBody(req).catch(() => null);
    if (!body || typeof body !== "object") return json(res, 400, { error: "Send { spec }." });
    const spec = (body as { spec?: unknown }).spec;
    const baseUrl = (body as { baseUrl?: unknown }).baseUrl;
    if (typeof spec !== "string") return json(res, 400, { error: "spec must be the OpenAPI document." });
    if (baseUrl !== undefined && typeof baseUrl !== "string") return json(res, 400, { error: "baseUrl must be a string." });
    const saved = deps.store.save(scope, spec, (body as { headers?: unknown }).headers, baseUrl);
    if (typeof saved === "string") return json(res, 400, { error: saved });
    return json(res, 200, saved);
  };
}

export { openApiScope };
