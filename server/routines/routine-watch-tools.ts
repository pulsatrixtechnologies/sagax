// Which MCP tools a routine watch may call alone (2026-10-26): reads only.
//
// The watch calls its tool on every check with no person there and no card,
// so only a tool that plainly reads is accepted, by the readings Sagax
// already uses for what is a write:
//   - a Perspicax tool reviewed as read-only (PERSPICAX_READ_ONLY_TOOLS,
//     through perspicaxReadTool);
//   - else a name with a read verb and no action verb (connectorCallReads),
//     that is no draft, no send or money move (isOutboundTool), no connector
//     write (connectorWriteKind) and no Perspicax write (perspicaxWriteOnceTool).
// Anything else is refused when the routine is saved and again at each check.
// #4250 (S5): a Pulsatrix Flow read is a read too, as a Flow watch observes:
// `flow_run` (or `flow`) with the read-only `read` command, and `flow_action`
// without `confirm` (Perspicax sends an action's writes only on a confirmed call).
import { connectorCallReads, connectorWriteKind } from "../../shared/engine-connectors.ts";
import { isOutboundTool } from "../../shared/outbound.ts";
import { parseToolId } from "../../shared/approval-describe.ts";
import { perspicaxReadTool } from "../artifacts/artifact-sources.ts";
import { perspicaxWriteOnceTool } from "../perspicax/perspicax-mcp.ts";

export const WATCH_TOOL_NOT_READ = "A routine watch calls read tools only (search, list, get, query...). This tool may change or send something.";

/** The tool name without its `mcp__<server>__` bridge prefix. */
function bareName(tool: string): string {
  return tool.replace(/^mcp__/, "");
}

/** Whether a Flow engine call reads only (the observe step of a Flow watch);
 * null: not one of those calls, the rules below decide. */
function flowRead(name: string, args: Record<string, unknown> | undefined): boolean | null {
  const bare = parseToolId(name).name;
  if ((bare === "flow_run" || bare === "flow") && args?.command === "read") return true;
  if (bare === "flow_action") return args?.confirm === undefined || args.confirm === false;
  return null;
}

/** Null when the tool only reads, else why it is refused. `args` are the
 * call's own (a Flow call reads or writes by its arguments). */
export function watchToolRefusal(tool: string, args?: Record<string, unknown>): string | null {
  const name = tool.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,199}$/.test(name)) return "Choose a tool by its name (server__tool)";
  const flow = flowRead(bareName(name), args);
  if (flow !== null) return flow ? null : WATCH_TOOL_NOT_READ;
  if (perspicaxReadTool(name)) return null;
  const parsed = parseToolId(name);
  const action = parsed.name;
  if (/draft/i.test(action)) return WATCH_TOOL_NOT_READ;
  if (!connectorCallReads(bareName(name))) return WATCH_TOOL_NOT_READ;
  if (isOutboundTool(bareName(name)) || connectorWriteKind(bareName(name)) !== null) return WATCH_TOOL_NOT_READ;
  if (perspicaxWriteOnceTool(parsed.server ? `${parsed.server}__${action}` : action)) return WATCH_TOOL_NOT_READ;
  return null;
}
