// @ts-nocheck
/** addMarketplaceServers (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createAddMarketplaceServers(getHost: () => Host): any {
function addMarketplaceServers(   current: Record<string, unknown>,   servers: ReadonlyArray<{ name: string; entry: Record<string, unknown> }>,   marketplace: string,   plugin: string,   skipped: string[], ) {
  const host = getHost();
  const { MAX_MCP_SERVERS, parseMcpServerMutation } = host;
  const added: Record<string, string> = {};
  const taken = new Set(Object.keys(current));
  for (const server of servers) {
    const name = marketplaceServerName(server.name, plugin, taken);
    if (Object.keys(current).length >= MAX_MCP_SERVERS) {
      skipped.push(`MCP server ${server.name} (at most ${MAX_MCP_SERVERS} servers)`);
      continue;
    }
    const remote = "url" in server.entry;
    if (host.IDENTITY.kind === "perspicax" && !remote) {
      // Complete installation plugins mount this command in each person's environment.
      continue;
    }
    // A remote server is on at once (one that needs a sign-in is never
    // mounted before it); a command stays off until it was tested.
    const parsed = parseMcpServerMutation(name, { ...server.entry, source: marketplace });
    if (!parsed.ok) {
      skipped.push(`MCP server ${server.name} (${parsed.error})`);
      continue;
    }
    parsed.server.enabled = remote;
    const refusal = host.mcpPolicyRefusal(name, parsed.server);
    if (refusal) {
      skipped.push(`MCP server ${server.name} (${refusal})`);
      continue;
    }
    current[name] = parsed.server;
    taken.add(name);
    added[server.name] = name;
  }
  return added;

}
  return addMarketplaceServers;
}
