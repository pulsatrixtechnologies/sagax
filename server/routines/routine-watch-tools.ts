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

/** Null when the tool only reads, else why it is refused. */
export function watchToolRefusal(tool: string): string | null {
  const name = tool.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,199}$/.test(name)) return "Choose a tool by its name (server__tool)";
  if (perspicaxReadTool(name)) return null;
  const parsed = parseToolId(name);
  const action = parsed.name;
  if (/draft/i.test(action)) return WATCH_TOOL_NOT_READ;
  if (!connectorCallReads(bareName(name))) return WATCH_TOOL_NOT_READ;
  if (isOutboundTool(bareName(name)) || connectorWriteKind(bareName(name)) !== null) return WATCH_TOOL_NOT_READ;
  if (perspicaxWriteOnceTool(parsed.server ? `${parsed.server}__${action}` : action)) return WATCH_TOOL_NOT_READ;
  return null;
}
