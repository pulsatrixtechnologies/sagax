/**
 * GET/POST /api/bots/:id/browser/live and /action (#1388 B3).
 * Never imports server/index.ts.
 */
import { builtInBrowserEnabled } from "../config.ts";
import type { BotsMessagesRouteDeps } from "./bots-messages-deps.ts";
import { PASS, type RouteContext, type RouteHandler } from "./table.ts";

async function handleBotBrowser(deps: BotsMessagesRouteDeps, ctx: RouteContext): Promise<typeof PASS | void> {
  const { req, res, url, path, method, auth, json, readBody } = ctx;
  const {
    HOSTED_WORKSPACE, browserIntegration, browserLive, cfg, currentBrowserSession,
    orgAdminCaller, sessions, store, viewerBotLevel, workspaceAccess,
  } = deps;

  const liveBrowserMatch = /^\/api\/bots\/([\w-]+)\/browser\/(live|action)$/.exec(path);
  if (liveBrowserMatch) {
    res.setHeader("cache-control", "no-store");
    const bot = store.bot(liveBrowserMatch[1]);
    if (!bot) return json(res, 404, { error: "no such bot" });
    // Anyone who can use the bot watches its session. A stranger learns
    // nothing about whether the bot exists. Installing the engine is a
    // separate admin route.
    if (viewerBotLevel(auth, bot) === null && !auth.scopes.includes("admin") && !orgAdminCaller(auth)) {
      return json(res, 404, { error: "no such bot" });
    }
    if (!builtInBrowserEnabled(cfg) || bot.browser === false) {
      return json(res, 409, { error: "Enable this bot's browser in its profile first." });
    }
    const browser = await browserIntegration(bot.id, bot.browserProfile);
    if (!browser) return json(res, 503, { error: "Install the browser engine first." });
    // Browser discovery may have awaited while the portal became unavailable
    // and closed this owner's streams. Do not open a late replacement on
    // the earlier authorization; once registered, exact-owner close covers it.
    if (HOSTED_WORKSPACE && auth.kind === "session") {
      const failure = workspaceAccess
        ? await workspaceAccess.authorize(req, auth)
        : { status: 503, error: "Workspace sign-in is unavailable." };
      if (failure) return json(res, failure.status, { error: failure.error });
    }
    const owner = auth.kind === "session" ? auth.session.id : "local-owner";
    const isCurrent = () => {
      const current = store.bot(bot.id);
      return !!current && current.browser !== false && builtInBrowserEnabled(cfg)
        && currentBrowserSession(current.id, current.browserProfile) === browser.session
        && (auth.kind !== "session" || sessions.isLive(auth.session.id));
    };
    if (method === "GET" && liveBrowserMatch[2] === "live") {
      req.socket.setTimeout(0);
      const preview = url.searchParams.get("preview") === "1";
      return await browserLive.open({ botId: bot.id, session: browser.session, spec: browser.spec, owner, isCurrent, res, preview });
    }
    if (method === "POST" && liveBrowserMatch[2] === "action") {
      const body = await readBody(req, 32_768);
      if (!isCurrent()) return json(res, 409, { error: "This browser session changed. Reopen the browser panel." });
      if (typeof body?.viewerId !== "string") return json(res, 400, { error: "A live browser connection is required." });
      if (body.type === "restart" && store.bots.some((candidate: any) => candidate.busy &&
          currentBrowserSession(candidate.id, candidate.browserProfile) === browser.session)) {
        return json(res, 409, { error: "Stop every bot using this profile before restarting its browser." });
      }
      return json(res, 200, await browserLive.action({ viewerId: body.viewerId, botId: bot.id, owner, body }));
    }
    return json(res, 405, { error: "method not allowed" });
  }
  return PASS;
}

export function createBotsMessagesBrowserRoutes(deps: BotsMessagesRouteDeps): RouteHandler {
  return (ctx) => handleBotBrowser(deps, ctx);
}
