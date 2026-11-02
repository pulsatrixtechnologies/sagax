// The person's network debugger of the bot's browser (server/browser/browser-network-debug.ts).
//
//   POST /api/bots/:id/browser/network  { action: "start" | "refresh" | "export" | "stop", includeHeaders? }
//
// POST only: on the desktop a loopback change needs the app's own capability,
// so a bot's shell on the same machine cannot read it (a GET would be open to
// any local process). Not an internal route, not a tool: no bot reaches it.
import type { IncomingMessage } from "node:http";

import { NetworkDebugError, parseNetworkDebugBody, type BrowserNetworkDebug, type NetworkDebugSpec } from "../browser/browser-network-debug.ts";
import type { RequestAuth } from "../request-auth.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface BrowserNetworkRouteDeps {
  /** The bot, or null when there is none with this id. */
  bot(id: string): { id: string; browser?: boolean; browserProfile?: string } | null;
  /** The built-in browser is turned on for this installation. */
  browserEnabled(): boolean;
  /** The bot's browser session, or null when the engine is not installed. */
  browser(botId: string, profile: string | undefined): Promise<{ session: string; spec: NetworkDebugSpec } | null>;
  /** On a hosted workspace, a refusal for a session that may not use it; null otherwise. */
  authorizeWorkspace(req: IncomingMessage, auth: RequestAuth): Promise<{ status: number; error: string } | null>;
  debug: Pick<BrowserNetworkDebug, "start" | "refresh" | "exportHar" | "stop">;
}

const PATH = /^\/api\/bots\/([\w-]+)\/browser\/network$/;

export function createBrowserNetworkRoutes(deps: BrowserNetworkRouteDeps): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    const match = PATH.exec(path);
    if (!match) return PASS;
    res.setHeader("cache-control", "no-store");
    if (method !== "POST") return json(res, 405, { error: "method not allowed" });
    const bot = deps.bot(match[1]);
    if (!bot) return json(res, 404, { error: "no such bot" });
    if (!deps.browserEnabled() || bot.browser === false) {
      return json(res, 409, { error: "Enable this bot's browser in its profile first." });
    }
    let request: ReturnType<typeof parseNetworkDebugBody>;
    try { request = parseNetworkDebugBody(await readBody(req, 4_096)); }
    catch (error) { return json(res, 400, { error: error instanceof Error ? error.message : "Invalid network debugger action." }); }
    const browser = await deps.browser(bot.id, bot.browserProfile);
    if (!browser) return json(res, 503, { error: "Install the browser engine first." });
    const failure = await deps.authorizeWorkspace(req, auth);
    if (failure) return json(res, failure.status, { error: failure.error });
    const owner = auth.kind === "session" ? auth.session.id : "local-owner";
    const target = { session: browser.session, botId: bot.id, owner };
    try {
      if (request.action === "start") return json(res, 200, await deps.debug.start({ ...target, spec: browser.spec }));
      if (request.action === "refresh") return json(res, 200, await deps.debug.refresh({ ...target, includeHeaders: request.includeHeaders }));
      if (request.action === "export") return json(res, 200, { har: deps.debug.exportHar({ ...target, includeHeaders: request.includeHeaders, version: "1" }) });
      await deps.debug.stop(target);
      return json(res, 200, { ok: true });
    } catch (error) {
      // A fixed message, never the engine's text or a captured value.
      if (error instanceof NetworkDebugError) return json(res, error.status, { error: error.message });
      return json(res, 500, { error: "The network debugger failed." });
    }
  };
}
