// Tools switched off for a whole MCP server (Plugins > a server > Tools).
//
// The switches live on the stored server (config.json mcpServers.<name>
// .disabledTools) and apply to every bot. A server with at least one tool off
// is mounted through the MCP gate (server/mcp-gate.ts) with a deny-only tool
// scope, the same proxy a bot's own tool selection uses: discovery leaves the
// tools out and a call to one is refused before it reaches the server. A
// server with every tool on is mounted unchanged.
import type { McpServerSpec } from "../contracts.ts";
import { gateServer } from "./mcp-gate-config.ts";
import type { ToolScope } from "../../shared/tool-scope.ts";

type Gate = (input: { name: string; server: unknown; threadId: string; budget: number; toolScope?: ToolScope; nodeEnv?: Record<string, string> }) =>
  { command: string; args: string[]; env: Record<string, string> } | null;

/** The deny-only scope for one server's disabled tools, or undefined. */
export function disabledToolScope(server: string, disabled: readonly string[] | undefined): ToolScope | undefined {
  const names = [...new Set(disabled ?? [])].filter((name) => name && !name.includes("*"));
  return names.length ? { deny: names.map((name) => `mcp:${server}:${name}`) } : undefined;
}

/** Wrap each server that has tools switched off in the gate. A server the
 * gate cannot wrap is left out rather than mounted with every tool. */
export function withDisabledTools<T extends Record<string, McpServerSpec>>(
  servers: T,
  disabled: Readonly<Record<string, readonly string[]>>,
  threadId: string,
  gate: Gate = gateServer,
): Record<string, McpServerSpec> {
  const out: Record<string, McpServerSpec> = {};
  for (const [name, server] of Object.entries(servers)) {
    const toolScope = disabledToolScope(name, Object.hasOwn(disabled, name) ? disabled[name] : undefined); // a server named "constructor" is not Object's
    if (!toolScope) {
      out[name] = server;
      continue;
    }
    try {
      // The harness spawns its helpers with the Electron binary as node.
      const gated = gate({ name, server, threadId, budget: 0, toolScope, nodeEnv: { ELECTRON_RUN_AS_NODE: "1" } });
      if (gated) out[name] = { command: gated.command, args: gated.args, env: gated.env };
    } catch {
      // unsupported shape: never mount it with the switched-off tools
    }
  }
  return out;
}
