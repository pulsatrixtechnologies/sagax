// Public MCP OAuth browser callback (#1388 wave 4). The single-use `state`
// bound to the pending flow is the authorization; no session is required.
//
// Pre-auth (PRE_AUTH_ROUTES):
//   GET /api/mcp-oauth/callback
import type { CallbackResult } from "../mcp/mcp-oauth.ts";
import { PASS, type PreAuthRouteHandler } from "./table.ts";

export const MCP_OAUTH_CALLBACK_PATH = "/api/mcp-oauth/callback";

export interface McpOAuthCallbackOwner {
  callback(query: URLSearchParams, signal: AbortSignal): Promise<CallbackResult>;
}

export interface McpOAuthCallbackDeps {
  /** Person manager that ownsState(state), else the default mcpOAuth. */
  findOwner(state: string): McpOAuthCallbackOwner;
  phoneReturnLocation(result: CallbackResult): string | null;
  callbackPage(result: CallbackResult, acceptLanguage: string | undefined): { html: string; nonce: string };
}

export function createMcpOAuthCallbackRoutes(deps: McpOAuthCallbackDeps): PreAuthRouteHandler {
  return async ({ req, res, url, path, method }) => {
    // the literal path keeps this route in the tool policy inventory (scripts/tool-policy)
    if (!(method === "GET" && path === "/api/mcp-oauth/callback")) return PASS;

    const state = url.searchParams.get("state") ?? "";
    const owner = deps.findOwner(state);
    const result = await owner.callback(url.searchParams, AbortSignal.timeout(15_000));

    const phoneReturn = deps.phoneReturnLocation(result);
    if (phoneReturn) {
      res.writeHead(302, {
        location: phoneReturn,
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
      });
      res.end();
      return;
    }

    const acceptLanguage = typeof req.headers["accept-language"] === "string"
      ? req.headers["accept-language"]
      : undefined;
    const page = deps.callbackPage(result, acceptLanguage);
    res.writeHead(result.ok ? 200 : 400, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      "content-security-policy": `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${page.nonce}'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`,
    });
    res.end(page.html);
  };
}
