// The MCP servers a turn hands an agent that mounts them as stdio children:
// the harness's own proxies (peer agents, connected apps, the built-in
// browser, Data, the bot's computer) and the person's own servers. Shared by
// the ACP family and Muse Code, so the owner's tool selection is applied to
// every such engine the same way.
import type { SendTurnInput } from "../contracts.ts";
import { canUseMcpServer } from "../../shared/tool-scope.ts";
import { gateServer, mcpStdioServer } from "../mcp-gate-config.ts";

export interface TurnStdioMcpServer {
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
}

/** A URL server is always mounted as Sagax's remote proxy, even for an
 * agent that speaks HTTP itself: the proxy opens the connection with the same
 * minimal handshake as Settings → Test (mcp-http.ts), where an agent's own MCP
 * client adds capability fields a strict server refuses. */
export function turnStdioMcpServers(turn: SendTurnInput): TurnStdioMcpServer[] {
  const servers: TurnStdioMcpServer[] = [];
  const add = (name: string, server: { command: string; args: string[]; env?: Record<string, string> } | undefined) => {
    if (server) servers.push({ name, command: server.command, args: server.args, env: server.env ?? {} });
  };
  add("agents", turn.integrations?.agents);
  add("composio", turn.integrations?.composio);
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
    const stdio = "url" in server ? mcpStdioServer(server, { nodeEnv: { ELECTRON_RUN_AS_NODE: "1" } }) : server;
    if (!stdio) continue;
    servers.push({ name, command: stdio.command, args: stdio.args ?? [], env: stdio.env ?? {} });
  }
  if (turn.toolScope === undefined) return servers;
  return servers.filter((server) => canUseMcpServer(turn.toolScope, server.name)).map((server) => {
    const gated = gateServer({ name: server.name, server: { command: server.command, args: server.args, env: server.env },
      threadId: turn.threadId, budget: 0, toolScope: turn.toolScope, nodeEnv: { ELECTRON_RUN_AS_NODE: "1" } });
    if (!gated) throw new Error("Tool selection requires an MCP gate.");
    return { name: server.name, command: gated.command, args: gated.args, env: gated.env };
  });
}
