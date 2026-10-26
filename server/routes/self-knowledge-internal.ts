// POST /api/internal/self-knowledge: sagax_help (server/self-knowledge.ts).
// A few sections of the generated knowledge base, worded for this server
// (solo or organization) and the person speaking. Reads nothing of anyone's
// data. Behind the agents capability (see internal-route.ts).
import { HELP_CALLS_PER_TURN, HelpCallCounter, helpAnswer, type HelpContext, type KnowledgeIndex } from "../self-knowledge.ts";
import type { InternalRouteHandler } from "./internal-route.ts";
import { PASS } from "./table.ts";

export interface SelfKnowledgeInternalDeps {
  index(): Promise<KnowledgeIndex | null>;
  /** The server and the person speaking in this thread's turn. */
  context(threadId: string): HelpContext;
}

/** Answers `{ text }` (200), or `{ error }`: 400 without a question, 429
 * past the per-turn cap, 503 when the build carries no base. */
export function createSelfKnowledgeInternalRoutes(deps: SelfKnowledgeInternalDeps): InternalRouteHandler {
  const calls = new HelpCallCounter();
  return async ({ res, path, method, json, capability, readBody }) => {
    if (!(method === "POST" && path === "/api/internal/self-knowledge")) return PASS;
    const body = await readBody();
    const question = typeof body.question === "string" ? body.question.trim().slice(0, 500) : "";
    if (!question) return json(res, 400, { error: "question: what the person wants to know about Sagax or Perspicax." });
    if (!calls.take(`${capability.threadId}:${capability.generation}`)) {
      return json(res, 429, { error: `sagax_help answered ${HELP_CALLS_PER_TURN} questions this turn; answer with what you have.` });
    }
    const index = await deps.index();
    if (!index) return json(res, 503, { error: "The knowledge base is not in this build; check your own tool list before you answer." });
    return json(res, 200, { text: helpAnswer(index, question, deps.context(capability.threadId)).text });
  };
}
