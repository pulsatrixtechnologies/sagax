// @ts-nocheck
/** probeMcpOAuth (#1388). Pure move from server/index.ts. */
import { skipPersonalInSharedProbe } from "../mcp/mcp-personal-shared-guard.ts";
export type Host = Record<string, any>;

export function createProbeMcpOAuth(getHost: () => Host): any {
async function probeMcpOAuth(names?: string[], force = false) {
  const host = getHost();

  // A server the organisation has not approved is never contacted.
  // Lot B: skip person-scoped names in shared app probes (personal OAuth
  // uses the per-person manager under /api/me).
  const personalNames = host.personalMcpNamesForGuard();
  const servers = Object.fromEntries(Object.entries(host.remoteMcpServers(names)).filter(([name, server]) =>
    !skipPersonalInSharedProbe(name, personalNames) && host.managedPolicy.mcpAllowed(name, server.url)));
  await host.mcpOAuth.probeUnknown(servers, { force, signal: AbortSignal.timeout(4_000) }).catch(() => undefined);

}
  return probeMcpOAuth;
}
