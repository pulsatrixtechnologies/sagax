// POST /api/internal/perspicax/claims: a native claim tool (claim, claim_renew,
// claim_release, claim_list) forwarded to Perspicax in the speaker's name,
// through this turn's mounted profile (server/perspicax/perspicax-claims.ts).
//
// An internal route answers only behind the per-turn agents capability, which
// the internal block of server/index.ts checks before anything else. So this
// module is not listed in ROUTES (that table runs before the capability
// gate): index.ts builds it once with its dependencies and calls it from the
// internal block with the capability it already checked, the same way
// agent-api-internal.ts and voice-call-internal.ts keep index.ts free of a
// path guard.
import type { ServerResponse } from "node:http";
import type { json } from "../harness/http.ts";
import type { PerspicaxMcp } from "../perspicax/perspicax-mcp.ts";
import { runClaimTool } from "../perspicax/perspicax-claims.ts";
import { PASS } from "./table.ts";

/** What the internal block already knows about the caller. The holder of a
 * claim is this capability's bot, never an argument. */
export interface ClaimsInternalCapability {
  botId: string;
  threadId: string;
  generation: string;
  sandboxPrincipalId?: string;
  desktopPrincipalId?: string;
}

export interface ClaimsInternalContext {
  res: ServerResponse;
  path: string;
  method: string;
  json: typeof json;
  capability: ClaimsInternalCapability;
  /** The internal block's body reader (it re-checks that the turn is live). */
  readBody(): Promise<Record<string, unknown>>;
}

export interface ClaimsInternalDeps {
  perspicaxMcp(): Pick<PerspicaxMcp, "callTool"> | null;
  /** The misuse and safety review of a Perspicax MCP call, run on the claim's
   * model-written text: the refusal to answer with, or null to go on. */
  review(text: string, capability: ClaimsInternalCapability): Promise<unknown>;
}

export type ClaimsInternalHandler = (ctx: ClaimsInternalContext) => Promise<typeof PASS | void>;

export function createPerspicaxClaimsInternalRoutes(deps: ClaimsInternalDeps): ClaimsInternalHandler {
  return async ({ res, path, method, json, capability, readBody }) => {
    if (!(method === "POST" && path === "/api/internal/perspicax/claims")) return PASS;
    const body = await readBody();
    // A claim's name and purpose are model-written and shown to others, so
    // they get the same review as a Perspicax MCP call. claim_list carries
    // nothing to review.
    if (body.tool !== "claim_list" && body.args && typeof body.args === "object") {
      const refusal = await deps.review(JSON.stringify({ tool: body.tool, args: body.args }), capability);
      if (refusal) return json(res, 200, { result: refusal, isError: true });
    }
    const answer = await runClaimTool(deps.perspicaxMcp(), {
      threadId: capability.threadId,
      generation: capability.generation,
      botId: capability.botId,
      tool: body.tool,
      args: body.args,
    });
    return json(res, answer.status, answer.body);
  };
}
