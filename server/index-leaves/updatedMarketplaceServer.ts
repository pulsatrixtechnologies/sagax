// @ts-nocheck
/** updatedMarketplaceServer (#1388). Pure move from server/index.ts. */
import { updatedServerEntry } from "../plugins/plugin-marketplaces.ts";
export type Host = Record<string, any>;

export function createUpdatedMarketplaceServer(getHost: () => Host): any {
function updatedMarketplaceServer(name: string, existing: StoredMcpServer, entry: Record<string, unknown>, marketplace: string, skipped: string[]) {
  const host = getHost();
  const { parseMcpServerMutation } = host;

  const parsed = parseMcpServerMutation(name, updatedServerEntry(existing, entry, marketplace), existing);
  if (!parsed.ok) {
    skipped.push(`MCP server ${name} (${parsed.error})`);
    return null;
  }
  if (host.IDENTITY.kind === "perspicax" && !("url" in parsed.server)) {
    skipped.push(`MCP server ${name} (a command would run on the Sagax server)`);
    return null;
  }
  const refusal = host.mcpPolicyRefusal(name, parsed.server);
  if (refusal) {
    skipped.push(`MCP server ${name} (${refusal})`);
    return null;
  }
  return parsed.server;

}
  return updatedMarketplaceServer;
}
