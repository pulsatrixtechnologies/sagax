// The person's visit signature. On unless they turn it off. No admin right.
// GET  /api/me/web-bot-auth   { enabled, keyId, directory }
// PUT  /api/me/web-bot-auth   { enabled: boolean }
// The private key is never in an answer.
import type { RequestAuth } from "../auth/request-auth.ts";
import { webBotAuthScope, type WebBotAuthScope, type WebBotAuthStore } from "../auth/web-bot-auth.ts";
import { PASS, type RouteHandler } from "./table.ts";

export const WEB_BOT_AUTH_PATH = "/api/me/web-bot-auth";

export interface WebBotAuthRouteDeps {
  store: WebBotAuthStore;
  scope(auth: RequestAuth): WebBotAuthScope | null;
}

export function createWebBotAuthRoutes(deps: WebBotAuthRouteDeps): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    if (path !== WEB_BOT_AUTH_PATH) return PASS;
    res.setHeader("cache-control", "no-store");
    const scope = deps.scope(auth);
    if (!scope) return json(res, 401, { error: "The visit signature belongs to one person: sign in first." });
    if (method === "GET") return json(res, 200, deps.store.view(scope));
    if (method !== "PUT") return PASS;
    const body = await readBody(req).catch(() => null);
    const enabled = body && typeof body === "object" ? (body as { enabled?: unknown }).enabled : undefined;
    if (typeof enabled !== "boolean") return json(res, 400, { error: "Send { enabled: true } or { enabled: false }." });
    deps.store.setEnabled(scope, enabled);
    return json(res, 200, deps.store.view(scope));
  };
}

export function webBotAuthScopeFor(organization: boolean, principalId: string | null | undefined): WebBotAuthScope | null {
  return webBotAuthScope(organization, principalId);
}
