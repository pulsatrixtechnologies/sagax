// The owner's switch for plugin lifecycle hooks.
//
//   GET /api/bots/:id/lifecycle-hooks  { enabled, events }
//   PUT /api/bots/:id/lifecycle-hooks  { enabled: boolean }
//
// Turning it on does not run anything on the Sagax server. The dispatcher
// (server/lifecycle-hooks.ts) sends the commands to the bot's computer.
import type { BotPlugins } from "../bot-plugins.ts";
import type { RequestAuth } from "../request-auth.ts";
import { PASS, type RouteHandler } from "./table.ts";

const ROUTE = new RegExp("^/api/bots/([\\w-]+)/lifecycle-hooks$");

export function createLifecycleHookRoutes<B extends { id: string }>(deps: {
  plugins: BotPlugins;
  bot: (id: string) => B | undefined;
  mayRead: (auth: RequestAuth, bot: B) => boolean;
  mayChange: (auth: RequestAuth, bot: B) => boolean;
}): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    const match = ROUTE.exec(path);
    if (!match) return PASS;
    const bot = deps.bot(match[1]!);
    if (!bot || !deps.mayRead(auth, bot)) return json(res, 404, { error: "no such bot" });
    res.setHeader("cache-control", "private, no-store");
    if (method === "GET" && /^\/api\/bots\/([\w-]+)\/lifecycle-hooks$/.test(path)) return json(res, 200, deps.plugins.lifecycleHookView(bot.id));
    if (method === "PUT" && /^\/api\/bots\/([\w-]+)\/lifecycle-hooks$/.test(path)) {
      if (!deps.mayChange(auth, bot)) return json(res, 403, { error: "Only the bot's owner can change lifecycle hooks.", code: "hooks_owner_only" });
      if (!/^application\/json\b/i.test(String(req.headers["content-type"] ?? ""))) return json(res, 415, { error: "content-type must be application/json" });
      const body = await readBody(req);
      if (!body || typeof body !== "object" || Array.isArray(body) || typeof (body as { enabled?: unknown }).enabled !== "boolean") {
        return json(res, 400, { error: "send { enabled: true or false }", code: "invalid_hooks" });
      }
      return json(res, 200, deps.plugins.setLifecycleHooksEnabled(bot.id, (body as { enabled: boolean }).enabled));
    }
    return json(res, 405, { error: "GET or PUT" });
  };
}
