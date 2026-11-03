// The route table: where new HTTP routes are registered (see README.md).
// server/index.ts runs it once per request, right after the auth gate and
// before its own inline routes, so every handler here is already authenticated.
import type { IncomingMessage, ServerResponse } from "node:http";
import type { json, readBody } from "../harness/http.ts";
import type { RequestAuth } from "../auth/request-auth.ts";

/** "Not my route": the next handler, then index.ts's inline routes, get a turn. */
export const PASS: unique symbol = Symbol("route.pass");

/** What a route module starts with. Anything else it needs (store, config,
 * managers) is passed explicitly to its factory, never reached for here. */
export interface RouteContext {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  /** `url.pathname` */
  path: string;
  method: string;
  auth: RequestAuth;
  json: typeof json;
  readBody: typeof readBody;
}

/** Resolve with PASS to decline; anything else means the request was answered. */
export type RouteHandler = (ctx: RouteContext) => Promise<typeof PASS | void>;

export const ROUTES: RouteHandler[] = [];

/** Pre-auth context: same as RouteContext, but auth may be null (no session
 * yet, or a probe answered before the gate). */
export type PreAuthRouteContext = Omit<RouteContext, "auth"> & {
  auth: RequestAuth | null;
};

export type PreAuthRouteHandler = (ctx: PreAuthRouteContext) => Promise<typeof PASS | void>;

/** Public / pre-gate routes (wave 4 of #1388): healthz, environment, auth
 * pair and email, companion pair, mcp-oauth callback, domain-check. Wired
 * before resolveRequestAuth. auth on the context is null at that point. */
export const PRE_AUTH_ROUTES: PreAuthRouteHandler[] = [];

/** Unauthenticated probes that need resolveRequestAuth first (so a signed-in
 * caller falls through to the post-gate health/brand handlers): GET
 * /api/health and GET /api/brand when auth is null. Dispatched after resolve,
 * before the session gate refusal. */
export const PRE_AUTH_AFTER_RESOLVE: PreAuthRouteHandler[] = [];

/** Runs handlers in order until one answers; true means stop routing. A
 * handler that wrote a response but returned PASS by mistake still counts as
 * answered, so the request can never reach a second handler. */
export async function dispatchRoutes(routes: readonly RouteHandler[], ctx: RouteContext): Promise<boolean> {
  for (const route of routes) {
    const out = await route(ctx);
    if (out !== PASS || ctx.res.headersSent || ctx.res.writableEnded) return true;
  }
  return false;
}

/** Same chain rules as dispatchRoutes for pre-auth handlers (nullable auth). */
export async function dispatchPreAuthRoutes(
  routes: readonly PreAuthRouteHandler[],
  ctx: PreAuthRouteContext,
): Promise<boolean> {
  for (const route of routes) {
    const out = await route(ctx);
    if (out !== PASS || ctx.res.headersSent || ctx.res.writableEnded) return true;
  }
  return false;
}
