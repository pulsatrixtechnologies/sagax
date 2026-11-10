// The person's answer to a proactive proposal card (2026-10-30,
// server/proactive/proactive-wake.ts).
//
//   POST /api/bots/:id/proactive/:proposalId   { accept: boolean, watches?: string[] }
//        or { skip: true } (#3471): closed as skipped, no yes and no no.
//        #3431: on a choice card, `watches` is the card's switches (the
//        watches kept on with the yes).
//   POST /api/bots/:id/proactive/:proposalId/feedback   { choice }
//        #2694: up, down, less or never on the card, answered or not.
//
// accept runs the bot's wake at its own level and rules (the person's yes
// is the request); decline closes the card. Answered once: a second answer
// is 409. Client-scoped in server/auth/request-auth.ts and allowed to a paired
// phone (companion/src/routes.ts); the handler checks the caller may write
// in the conversation the card is in.

import { PASS, type RouteHandler } from "./table.ts";

export interface ProactiveProposalRouteDeps {
  /** Answer one proposal of this bot; the status and body to send. */
  answer(botId: string, proposalId: string, accept: boolean, watchesOn?: readonly string[]): { status: number; body: Record<string, unknown> };
  /** #3471: the person skipped the card. */
  skip?(botId: string, proposalId: string): { status: number; body: Record<string, unknown> };
  /** #2694: the person's feedback on the card. */
  feedback?(botId: string, proposalId: string, choice: "up" | "down" | "less" | "never"): { status: number; body: Record<string, unknown> };
}

const FEEDBACK = new Set(["up", "down", "less", "never"]);

export function createProactiveProposalRoutes(deps: ProactiveProposalRouteDeps): RouteHandler {
  return async ({ req, res, path, method, json, readBody }) => {
    const match = /^\/api\/bots\/([\w-]+)\/proactive\/([\w-]+)(\/feedback)?$/.exec(path);
    if (!match) return PASS;
    if (method !== "POST") return json(res, 405, { error: "method not allowed" });
    if (match[3]) {
      if (!deps.feedback) return json(res, 404, { error: "not found" });
      const body = await readBody(req) as { choice?: unknown } | null;
      const choice = body?.choice;
      if (typeof choice !== "string" || !FEEDBACK.has(choice)) return json(res, 400, { error: "choice must be up, down, less or never" });
      const done = deps.feedback(match[1]!, match[2]!, choice as "up" | "down" | "less" | "never");
      return json(res, done.status, done.body);
    }
    const body = await readBody(req) as { accept?: unknown; watches?: unknown; skip?: unknown } | null;
    if (body?.skip === true && deps.skip) {
      const skipped = deps.skip(match[1]!, match[2]!);
      return json(res, skipped.status, skipped.body);
    }
    if (!body || typeof body !== "object" || typeof body.accept !== "boolean") {
      return json(res, 400, { error: "accept must be true or false" });
    }
    if (body.watches !== undefined && !(Array.isArray(body.watches) && body.watches.length <= 40 && body.watches.every((id) => typeof id === "string" && /^[\w.:-]{1,120}$/.test(id)))) {
      return json(res, 400, { error: "watches must be a list of watch ids" });
    }
    const answer = deps.answer(match[1]!, match[2]!, body.accept, body.watches as string[] | undefined);
    return json(res, answer.status, answer.body);
  };
}
