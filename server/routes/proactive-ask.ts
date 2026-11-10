// #3431 (lot 4 of #3408): propose_proactive over HTTP (INTERNAL_ROUTES,
// behind the per-turn capability).
//
//   POST /api/internal/proactive/propose
//        { about_person?: string[], domain?, watches?: string[], quote? }
//
// The turn is checked first (server/proactive/proactive-ask.ts
// askTurnRefusal: the bot's owner, one to one, in their own message; never a
// wake, a routine, a room, a call or another person's turn). Then what the
// person said about their work lands in their About me, and a domain is
// proposed with one choice card inside the bounds. A refusal is one line for
// the bot (200, applied false): nothing is shown to the person.
import { z } from "zod";

import type { ProactiveAsk } from "../proactive/proactive-ask.ts";
import type { InternalCapabilityView, InternalRouteHandler } from "./internal-route.ts";
import { PASS } from "./table.ts";

export const PROACTIVE_PROPOSE_PATH = "/api/internal/proactive/propose";

const ID = /^[\w.:-]{1,120}$/;

const body = z.object({
  about_person: z.array(z.string().trim().min(3).max(300)).max(5).optional(),
  domain: z.string().regex(ID).optional(),
  watches: z.array(z.string().regex(ID)).max(40).optional(),
  quote: z.string().max(600).optional(),
}).strict();

export interface ProactiveAskRouteDeps {
  /** The turn's person and their own message, or why this turn may not
   * propose (askTurnRefusal). */
  turn(capability: InternalCapabilityView): { person: string; message: string } | { refused: string };
  ask(): Pick<ProactiveAsk, "propose">;
  /** Facts about the person, appended to their About me (learned list);
   * how many were new. */
  learn(person: string, botId: string, facts: readonly string[]): number;
}

export function createProactiveAskInternalRoutes(deps: ProactiveAskRouteDeps): InternalRouteHandler {
  return async ({ res, path, method, json, capability, readBody }) => {
    if (path !== PROACTIVE_PROPOSE_PATH) return PASS;
    if (method !== "POST") return json(res, 405, { error: "method not allowed" });
    const parsed = body.safeParse(await readBody());
    if (!parsed.success) return json(res, 400, { error: "send { about_person?: [facts], domain?, watches?: [ids], quote? }" });
    const { about_person: facts, domain, watches, quote } = parsed.data;
    if (!facts?.length && !domain) return json(res, 400, { error: "send about_person (what the person said about their work) or a domain to propose" });
    const turn = deps.turn(capability);
    if ("refused" in turn) return json(res, 200, { applied: false, text: turn.refused });
    const said: string[] = [];
    if (facts?.length) {
      const added = deps.learn(turn.person, capability.botId, facts);
      said.push(added ? `Saved ${added} fact${added > 1 ? "s" : ""} in the person's About me.` : "Nothing new for About me (already there, removed by the person, or About me is full).");
    }
    if (!domain) return json(res, 200, { applied: said.length > 0, text: said.join(" ") });
    const proposed = await deps.ask().propose({
      person: turn.person, botId: capability.botId, threadId: capability.threadId, message: turn.message, domain,
      ...(watches ? { watches } : {}), ...(quote !== undefined ? { quote } : {}),
    });
    said.push(proposed.text);
    return json(res, 200, { applied: proposed.posted, text: said.join(" ") });
  };
}
