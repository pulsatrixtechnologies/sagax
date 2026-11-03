// Connector tool-name status (server/mcp/mcp-tool-names.ts): what each MCP gate
// saw a connector advertise and what the engine registers, with every rename
// and anything that could not be registered. Written by server/mcp-gate.ts;
// tool names only, never values.
//
//   GET /api/mcp/tool-names   { reports: ToolNameReport[] }
import { readToolNameReports } from "../mcp/mcp-tool-name-reports.ts";
import { PASS, type RouteHandler } from "./table.ts";

export const MCP_TOOL_NAMES_PATH = "/api/mcp/tool-names";

export function createMcpToolNameRoutes(read: () => unknown[] = readToolNameReports): RouteHandler {
  return async ({ res, path, method, json }) => {
    if (path !== MCP_TOOL_NAMES_PATH) return PASS;
    if (method !== "GET") return json(res, 405, { error: "GET" });
    res.setHeader("cache-control", "no-store");
    return json(res, 200, { reports: read() });
  };
}
