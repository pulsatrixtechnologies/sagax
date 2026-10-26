// Pre-warm (server/thread-prewarm.ts): the person opened a bot's
// conversation or started typing in it.
//
//   POST /api/bots/:id/warm   { threadId }   -> 200 { warm: started | extended | limited | skipped }
//
// Same access as a send to that thread; starts nothing visible and answers
// at once. The checks live in server/index.ts (threadWarmRequest).
import type { RequestAuth } from "../request-auth.ts";
import { PASS, type RouteHandler } from "./table.ts";

type Answer = { status: number; body: Record<string, unknown> };

export interface ThreadWarmRouteDeps {
  warm: (auth: RequestAuth, botId: string, body: Record<string, unknown>) => Answer;
}

export function createThreadWarmRoutes(deps: ThreadWarmRouteDeps): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    const match = method === "POST" ? /^\/api\/bots\/([\w-]+)\/warm$/.exec(path) : null;
    if (!match) return PASS;
    const body = await readBody(req);
    if (!body || typeof body !== "object" || Array.isArray(body)) return json(res, 400, { error: "body must be a JSON object" });
    const answer = deps.warm(auth, match[1]!, body as Record<string, unknown>);
    return json(res, answer.status, answer.body);
  };
}
