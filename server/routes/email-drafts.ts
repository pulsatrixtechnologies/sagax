// An email draft's "Envoyer" (server/mail/email-draft-send.ts, 2026-10-16):
//
//   POST /api/threads/:id/email-drafts             { botId?, draft, draftKey?, connector? }
//                                                  -> 201 { requestId, status, connector }:
//                                                     an approval card, never a send
//   GET  /api/threads/:id/email-drafts/:draftKey   -> { send: { requestId, status, error?, connector } | null }
//
// The send itself happens only on that card's Allow (the respond routes in
// server/index.ts, resolveAndSendEmailDraft).
import type { RequestAuth } from "../request-auth.ts";
import { PASS, type RouteHandler } from "./table.ts";

type Answer = { status: number; body: Record<string, unknown> };

export interface EmailDraftRouteDeps {
  ask: (auth: RequestAuth, threadId: string, body: Record<string, unknown>) => Promise<Answer>;
  status: (auth: RequestAuth, threadId: string, draftKey: string) => Answer;
}


export function createEmailDraftRoutes(deps: EmailDraftRouteDeps): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    const ask = method === "POST" ? /^\/api\/threads\/([\w-]+)\/email-drafts$/.exec(path) : null;
    if (ask) {
      const body = await readBody(req);
      if (!body || typeof body !== "object" || Array.isArray(body)) return json(res, 400, { error: "body must be a JSON object" });
      const answer = await deps.ask(auth, ask[1]!, body);
      return json(res, answer.status, answer.body);
    }
    const status = method === "GET" ? /^\/api\/threads\/([\w-]+)\/email-drafts\/([\w-]{1,64})$/.exec(path) : null;
    if (status) {
      res.setHeader("cache-control", "no-store");
      const answer = deps.status(auth, status[1]!, status[2]!);
      return json(res, answer.status, answer.body);
    }
    return PASS;
  };
}
