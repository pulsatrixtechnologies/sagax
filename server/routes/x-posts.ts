// The X draft card's Post, Discard and state (server/index-leaves/xPostCard.ts, #4638):
//
//   POST /api/threads/:id/x-posts/post     { messageId, draftKey, botId?, handle?, draft: { text } }
//   POST /api/threads/:id/x-posts/discard  { messageId, draftKey, botId?, text? }
//   GET  /api/threads/:id/x-posts/:messageId/:draftKey  -> { post: { status, text, url?, error? } | null }
//   GET  /api/threads/:id/x-account?botId=  -> { account: { handle, name, verified, avatarUrl?, avatarData? } | null } (who the bot posts as)
import type { RequestAuth } from "../auth/request-auth.ts";
import { PASS, type RouteHandler } from "./table.ts";

type Answer = { status: number; body: Record<string, unknown> };

export interface XPostRouteDeps {
  post: (auth: RequestAuth, threadId: string, body: Record<string, unknown>) => Promise<Answer>;
  discard: (auth: RequestAuth, threadId: string, body: Record<string, unknown>) => Answer;
  status: (auth: RequestAuth, threadId: string, messageId: string, draftKey: string) => Answer;
  account: (auth: RequestAuth, threadId: string, botId: string | undefined) => Answer;
}

export function createXPostRoutes(deps: XPostRouteDeps): RouteHandler {
  return async ({ req, res, url, path, method, auth, json, readBody }) => {
    const who = method === "GET" ? /^\/api\/threads\/([\w-]+)\/x-account$/.exec(path) : null;
    if (who) {
      res.setHeader("cache-control", "no-store");
      const answer = deps.account(auth, who[1]!, url.searchParams.get("botId") ?? undefined);
      return json(res, answer.status, answer.body);
    }
    const act = method === "POST" ? /^\/api\/threads\/([\w-]+)\/x-posts\/(post|discard)$/.exec(path) : null;
    if (act) {
      const body = await readBody(req);
      if (!body || typeof body !== "object" || Array.isArray(body)) return json(res, 400, { error: "body must be a JSON object" });
      const answer = act[2] === "post" ? await deps.post(auth, act[1]!, body) : deps.discard(auth, act[1]!, body);
      return json(res, answer.status, answer.body);
    }
    const status = method === "GET" ? /^\/api\/threads\/([\w-]+)\/x-posts\/([\w-]{1,80})\/([\w-]{1,64})$/.exec(path) : null;
    if (status) {
      res.setHeader("cache-control", "no-store");
      const answer = deps.status(auth, status[1]!, status[2]!, status[3]!);
      return json(res, answer.status, answer.body);
    }
    return PASS;
  };
}
