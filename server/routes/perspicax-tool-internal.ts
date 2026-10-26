// POST /api/internal/perspicax/tool: one Perspicax gateway tool of the agents
// catalog (PERSPICAX_TOOLS in server/drivers/agents-catalog.ts) forwarded to
// the profile mounted in this turn, in the speaker's name, after the same
// misuse and safety review as a Perspicax MCP call. Behind the agents
// capability (see internal-route.ts).
import type { PerspicaxMcp } from "../perspicax-mcp.ts";
import type { InternalCapabilityView, InternalRouteHandler } from "./internal-route.ts";
import { PASS } from "./table.ts";

export interface PerspicaxToolInternalDeps {
  /** The tool names the route forwards; anything else is refused. */
  tools: ReadonlySet<string>;
  perspicaxMcp(): Pick<PerspicaxMcp, "callTool"> | null;
  /** The misuse and safety review of a Perspicax MCP call: the refusal to
   * answer with, or null to go on. */
  review(text: string, capability: InternalCapabilityView): Promise<unknown>;
  /** A confidential thread's refusal (server/confidential-threads.ts): the
   * text to answer with, or null to go on. */
  confidential?(capability: InternalCapabilityView, tool: string, args: Record<string, unknown>): string | null;
  /** Whose credentials made this turn's call and which bot. A remote_support_*
   * answer carries it, so the support folder records the real opener
   * (server/remote-support-local.ts), not an older speaker a kept proxy holds. */
  owner?(capability: InternalCapabilityView): { principalId: string; botId: string } | null;
  /** remote_support_status / remote_support_close: true when the support
   * folder for this code has no owner or names this very owner. Checked on the
   * server, before Perspicax is called, so a call for someone else's session
   * never reaches Perspicax and never touches its folder. */
  ownsSupportCode?(code: string, owner: { principalId: string; botId: string } | null): boolean;
}

const REMOTE_SUPPORT_OWNED = new Set(["remote_support_status", "remote_support_close"]);

/** Answers `{ text, isError }` (200), or `{ error, code }`: 400 for a tool it
 * does not forward, 409 when no profile is mounted in this turn or the server
 * is not linked to Perspicax, 502 when Perspicax could not answer. */
export function createPerspicaxToolInternalRoutes(deps: PerspicaxToolInternalDeps): InternalRouteHandler {
  return async ({ res, path, method, json, capability, readBody }) => {
    if (!(method === "POST" && path === "/api/internal/perspicax/tool")) return PASS;
    const body = await readBody();
    const tool = typeof body.tool === "string" ? body.tool : "";
    if (!deps.tools.has(tool)) return json(res, 400, { error: "unknown Perspicax tool", code: "unknown_tool" });
    const mcp = deps.perspicaxMcp();
    if (!mcp) return json(res, 409, { error: "Perspicax is not linked to this server.", code: "profile_not_mounted" });
    const args = body.args && typeof body.args === "object" && !Array.isArray(body.args) ? (body.args as Record<string, unknown>) : {};
    const confidential = deps.confidential?.(capability, tool, args);
    if (confidential) return json(res, 200, { text: confidential, isError: true });
    const refusal = await deps.review(JSON.stringify({ tool, args }), capability);
    if (refusal) return json(res, 200, { text: String(refusal), isError: true });
    const owner = tool.startsWith("remote_support_") ? deps.owner?.(capability) ?? null : null;
    // Check the support folder's owner before touching Perspicax: a status or
    // close for a code opened by someone else on this host is refused here.
    if (REMOTE_SUPPORT_OWNED.has(tool) && deps.ownsSupportCode) {
      const code = typeof args.code === "string" ? args.code : "";
      if (!deps.ownsSupportCode(code, owner)) {
        return json(res, 200, { text: "That support code was opened by someone else on this computer. Open a new session with remote_support_open.", isError: true });
      }
    }
    const answer = await mcp.callTool({ threadId: capability.threadId, generation: capability.generation, botId: capability.botId, name: tool, args });
    if (!answer.ok) {
      return json(res, answer.code === "profile_not_mounted" ? 409 : 502, {
        error: answer.code === "profile_not_mounted" ? "No Perspicax profile is mounted in this turn for the person speaking." : answer.error,
        code: answer.code,
      });
    }
    const text = typeof answer.value === "string" ? answer.value : JSON.stringify(answer.value);
    return json(res, 200, { text, isError: answer.isError, ...(owner ? { owner } : {}) });
  };
}
