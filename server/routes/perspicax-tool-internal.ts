// POST /api/internal/perspicax/tool: one Perspicax gateway tool of the agents
// catalog (PERSPICAX_TOOLS in server/drivers/agents-catalog.ts) forwarded to
// the account connection mounted in this turn, in the speaker's name, after the same
// misuse and safety review as a Perspicax MCP call. Behind the agents
// capability (see internal-route.ts).
import type { PerspicaxMcp } from "../perspicax/perspicax-mcp.ts";
import type { InternalCapabilityView, InternalRouteHandler } from "./internal-route.ts";
import { PASS } from "./table.ts";
import { parseUnattendedHostId } from "../../shared/remote-unattended-host.ts";

export interface PerspicaxToolInternalDeps {
  /** The tool names the route forwards; anything else is refused. */
  tools: ReadonlySet<string>;
  perspicaxMcp(): (Pick<PerspicaxMcp, "callTool"> & Partial<Pick<PerspicaxMcp, "toolHome">>) | null;
  /** The misuse and safety review of a Perspicax MCP call: the refusal to
   * answer with, or null to go on. */
  review(text: string, capability: InternalCapabilityView): Promise<unknown>;
  /** A confidential thread's refusal (server/threads/confidential-threads.ts): the
   * text to answer with, or null to go on. */
  confidential?(capability: InternalCapabilityView, tool: string, args: Record<string, unknown>): string | null;
  /** Whose credentials made this turn's call and which bot. A remote_support_*
   * answer carries it, so the support folder records the real opener
   * (server/remote-support/remote-support-local.ts), not an older speaker a kept proxy holds. */
  owner?(capability: InternalCapabilityView): { principalId: string; botId: string } | null;
  /** remote_support_status / remote_support_close: true when the support
   * folder for this code has no owner or names this very owner. Checked on the
   * server, before Perspicax is called, so a call for someone else's session
   * never reaches Perspicax and never touches its folder. */
  ownsSupportCode?(code: string, owner: { principalId: string; botId: string } | null): boolean;
  /** remote_support_open on an enrolled host (host_id): the person's bot
   * access for that host (#2723). Null lets it through; a string is the
   * refusal (Never allow, or an Ask card the person declined). */
  hostAccess?(capability: InternalCapabilityView, owner: { principalId: string; botId: string } | null, hostId: string): Promise<string | null>;
}

const REMOTE_SUPPORT_OWNED = new Set(["remote_support_status", "remote_support_close"]);

/** #1935: the gateway tools whose answer names the tool to call next. */
export const PERSPICAX_NAMING_TOOLS: ReadonlySet<string> = new Set(["api_search", "api_describe", "api_list", "api_plan"]);

/** #1935: where to run a tool a gateway answer names. Those tools are on the
 * Perspicax account MCP server, never on the agents server, whose
 * call_tool answers "No tool named ..." for them. */
export function perspicaxToolHomeNote(server: string): string {
  return `Sagax: the tools this answer names run on the MCP server "${server}", by their own names there (or through that server's call_tool when it lists only search_tools, describe_tool and call_tool). The agents server does not have them.`;
}

/** #1935: the answer to a call of a tool the agents server does not have,
 * when this turn's Perspicax account connection has it (or may have it). */
export function perspicaxToolElsewhere(tool: string, home: { server: string; served: boolean }): string {
  const name = JSON.stringify(tool.slice(0, 100));
  return home.served
    ? `${name} is not a Sagax tool: it is a tool of the Perspicax account connection on the MCP server "${home.server}". Call it there, by its own name or through that server's call_tool, with the same arguments. Nothing was run.`
    : `${name} is not a Sagax tool. This turn's Perspicax account tools are on the MCP server "${home.server}": find and call it there (its search_tools and call_tool when it does not list it). Nothing was run.`;
}

/** `{ locate: name }` answers `{ server, served, text }` or `{ server: null }`
 * (#1935). Otherwise answers `{ text, isError }` (200), or `{ error, code }`: 400 for a tool it
 * does not forward, 409 when the account connection is not mounted in this
 * turn or the server is not linked to Perspicax, 502 when Perspicax could not answer. */
export function createPerspicaxToolInternalRoutes(deps: PerspicaxToolInternalDeps): InternalRouteHandler {
  return async ({ res, path, method, json, capability, readBody }) => {
    if (!(method === "POST" && path === "/api/internal/perspicax/tool")) return PASS;
    const body = await readBody();
    if (typeof body.locate === "string") {
      // #1935: `{ locate }`: which MCP server of this turn runs a tool the
      // agents server does not have. Names only: nothing reaches Perspicax.
      const name = body.locate.slice(0, 200);
      const home = name ? deps.perspicaxMcp()?.toolHome?.(capability.threadId, capability.generation, capability.botId, name) : undefined;
      return json(res, 200, home ? { server: home.server, served: home.served, text: perspicaxToolElsewhere(name, home) } : { server: null });
    }
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
    if (tool === "remote_support_open" && deps.hostAccess) {
      const hostId = parseUnattendedHostId(args.host_id);
      if (hostId) {
        const denied = await deps.hostAccess(capability, owner, hostId);
        if (denied) return json(res, 200, { text: denied, isError: true });
      }
    }
    const answer = await mcp.callTool({ threadId: capability.threadId, generation: capability.generation, botId: capability.botId, name: tool, args });
    if (!answer.ok) {
      return json(res, answer.code === "profile_not_mounted" ? 409 : 502, {
        error: answer.code === "profile_not_mounted" ? "The Perspicax account connection is not mounted in this turn for the person speaking." : answer.error,
        code: answer.code,
      });
    }
    let text = typeof answer.value === "string" ? answer.value : JSON.stringify(answer.value);
    // #1935: api_search names `cw_psa_query`; the bot must call it on the
    // account server, not through the agents server it asked.
    if (PERSPICAX_NAMING_TOOLS.has(tool) && !answer.isError) {
      const home = mcp.toolHome?.(capability.threadId, capability.generation, capability.botId);
      if (home) text = `${text}\n\n${perspicaxToolHomeNote(home.server)}`;
    }
    return json(res, 200, { text, isError: answer.isError, ...(owner ? { owner } : {}) });
  };
}
