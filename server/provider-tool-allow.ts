// Durable, exact grants for read-shaped tools from configured MCP servers.
//
// The key binds the person's approval to the provider instance, the exact
// MCP server/tool pair and that server's current configuration. Editing the
// server invalidates the grant instead of silently transferring authority to
// a different endpoint or command that happens to reuse the same name.
import { createHash } from "node:crypto";

import { isReadOnlyTool } from "../shared/outbound.ts";

export interface ProviderMcpTool {
  server: string;
  tool: string;
}

/** Provider-facing MCP tool names are mcp__<server>__<tool>. */
export function providerMcpTool(name: string): ProviderMcpTool | null {
  if (!name.startsWith("mcp__")) return null;
  const parts = name.split("__");
  if (parts.length < 3 || parts[0] !== "mcp" || !parts[1] || !parts.slice(2).join("__")) return null;
  return { server: parts[1], tool: parts.slice(2).join("__") };
}

/** A grant candidate exists only for an exact read-shaped MCP tool. */
export function providerToolAllowKey(
  providerInstanceId: string,
  name: string,
  serverConfig: unknown,
): string | null {
  const parsed = providerMcpTool(name);
  if (!parsed || !providerInstanceId || !isReadOnlyTool(name)) return null;
  const fingerprint = createHash("sha256").update(JSON.stringify(serverConfig)).digest("hex").slice(0, 16);
  return `provider-tool:${providerInstanceId}:${parsed.server}:${parsed.tool}:${fingerprint}`;
}
