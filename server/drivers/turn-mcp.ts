// The MCP servers a turn hands an agent that mounts them as stdio children:
// the harness's own proxies (peer agents, connected apps, the built-in
// browser, Data, the bot's computer) and the person's own servers. Shared by
// the ACP family and Muse Code, so the owner's tool selection is applied to
// every such engine the same way.
import type { SendTurnInput } from "../contracts.ts";
import { canUseMcpServer } from "../../shared/tool-scope.ts";
import { gateServer, mcpStdioServer } from "../mcp/mcp-gate-config.ts";
import { connectorKeptGate, gateMaySearch } from "../mcp/mcp-gate-search.ts";

export interface TurnStdioMcpServer {
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  /** #4527 lot D: the server's gate may serve tools through its own
   * search_tools / call_tool: its call_tool is read as the tool it runs. */
  searched?: true;
}

/** A URL server is always mounted as Sagax's remote proxy, even for an
 * agent that speaks HTTP itself: the proxy opens the connection with the same
 * minimal handshake as Settings → Test (mcp-http.ts), where an agent's own MCP
 * client adds capability fields a strict server refuses. */
export function turnStdioMcpServers(turn: SendTurnInput): TurnStdioMcpServer[] {
  const servers: TurnStdioMcpServer[] = [];
  /** the person's servers already behind a gate of their own (lot D) */
  const gated = new Set<string>();
  const add = (name: string, server: { command: string; args: string[]; env?: Record<string, string> } | undefined) => {
    if (server) servers.push({ name, command: server.command, args: server.args, env: server.env ?? {} });
  };
  add("agents", turn.integrations?.agents);
  add("browser", turn.integrations?.browser);
  add("data", turn.integrations?.data);
  // The bot's computer: host and sandbox Cua connections expose Cua Driver's
  // own MCP server. (A cloud boat is not mounted here: a cloud turn runs ON it.)
  add("computer", turn.integrations?.localComputer);
  // User-configured servers, after the built-ins: a residual name collision
  // keeps the built-in (reserved names are filtered at the config boundary;
  // this is defense in depth).
  for (const [name, server] of Object.entries(turn.integrations?.custom ?? {})) {
    if (servers.some((existing) => existing.name === name)) continue;
    if (turn.toolScope !== undefined && !canUseMcpServer(turn.toolScope, name)) continue;
    // #4527 lot D: a gate that lists every tool but the ones the bot's
    // session leaves out (the rest one search away), and notes what the
    // server offered, for the count; under a tool selection, the same gate
    // applies it
    const kept = connectorKeptGate(turn.integrations?.connectorsKept, name, { mount: true });
    if (kept.search) {
      const spec = gateServer({ name, server, threadId: turn.threadId, budget: 0, nodeEnv: { ELECTRON_RUN_AS_NODE: "1" }, search: kept.search,
        ...(kept.offered ? { offered: kept.offered } : {}), ...(turn.toolScope !== undefined ? { toolScope: turn.toolScope } : {}) });
      if (!spec) continue;
      gated.add(name);
      servers.push({ name, command: spec.command, args: spec.args, env: spec.env, ...(gateMaySearch(kept.search) ? { searched: true as const } : {}) });
      continue;
    }
    const stdio = "url" in server ? mcpStdioServer(server, { nodeEnv: { ELECTRON_RUN_AS_NODE: "1" } }) : server;
    if (!stdio) continue;
    servers.push({ name, command: stdio.command, args: stdio.args ?? [], env: stdio.env ?? {} });
  }
  if (turn.toolScope === undefined) return servers;
  return servers.filter((server) => canUseMcpServer(turn.toolScope, server.name)).map((server) => {
    if (gated.has(server.name)) return server;
    const spec = gateServer({ name: server.name, server: { command: server.command, args: server.args, env: server.env },
      threadId: turn.threadId, budget: 0, toolScope: turn.toolScope, nodeEnv: { ELECTRON_RUN_AS_NODE: "1" } });
    if (!spec) throw new Error("Tool selection requires an MCP gate.");
    return { name: server.name, command: spec.command, args: spec.args, env: spec.env };
  });
}
