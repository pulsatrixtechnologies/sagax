// @ts-nocheck
/** engineMcpServers (#1388). Pure move from server/index.ts. */
import { customMcpServers, mcpDisabledTools } from "../config.ts";
import { withDisabledTools } from "../mcp/mcp-tool-filter.ts";
import { engineServerMcp } from "../turns/turn-mounts.ts";
export type Host = Record<string, any>;

export function createEngineMcpServers(getHost: () => Host): any {
function engineMcpServers(bot: BotRecord, threadId?: string) {
  const host = getHost();
  // the selection is server/turns/turn-mounts.ts engineServerMcp, which the
  // capabilities resolver (server/capabilities/capabilities.ts) reads too
  const servers = engineServerMcp({
    configured: customMcpServers(host.cfg, bot.mcpServers, bot.id),
    organization: host.IDENTITY.kind === "perspicax",
    filterPolicy: (configured) => host.managedPolicy.filterMcp(configured),
    sign: (allowed) => host.mcpOAuth.withAuthHeaders(allowed, (name) => bot.mcpAccounts?.[name])
  });
  // Leave out command servers that did not start for this bot (mcp-health).
  const usable = host.mcpServersHost.health.usable(bot.id, servers);
  // A turn mounts a server with tools switched off through the gate
  // (server/mcp/mcp-tool-filter.ts); listings only need the names.
  return threadId === undefined ? usable : withDisabledTools(usable, mcpDisabledTools(host.cfg), threadId);
}
  return engineMcpServers;
}
