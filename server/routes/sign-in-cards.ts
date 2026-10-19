// A sign-in card's answers (shared/sign-in-request.ts). Done and Cancel carry
// nothing secret: the person typed the password into the page itself.
// POST /api/bots/<bot>/sign-in-cards/<message>/(done|cancel) with {threadId},
// scoped like the other card answers in server/request-auth.ts. Sagax keeps
// no saved-login answer here: a login the person keeps goes through their
// credential vault (request_login, fill_credential).
import { PASS, type RouteHandler } from "./table.ts";

export type SignInOutcome = "done" | "cancelled";

type Answer = { status: number; body: Record<string, unknown> };

export interface SignInCardRouteDeps {
  settle(botId: string, threadId: string, messageId: string, outcome: SignInOutcome): Answer;
}

const CARD = /^\/api\/bots\/([\w-]+)\/sign-in-cards\/([\w-]+)\/(done|cancel)$/u;

export function createSignInCardRoutes(deps: SignInCardRouteDeps): RouteHandler {
  return async ({ req, res, path, method, json, readBody }) => {
    const m = CARD.exec(path);
    if (!m || method !== "POST") return PASS;
    const body = await readBody(req);
    const result = deps.settle(m[1]!, String(body.threadId ?? ""), m[2]!, m[3] === "done" ? "done" : "cancelled");
    return json(res, result.status, result.body);
  };
}
