// @ts-nocheck
/** mcpServerResponse (#1388). Pure move from server/index.ts. */
import { readsGithubToken } from "../github/github-mcp-token.ts";
import { DEFAULT_MCP_ACCOUNT } from "../mcp/mcp-oauth.ts";
import { skipPersonalInSharedProbe } from "../mcp/mcp-personal-shared-guard.ts";
import { listMcpServers, reservedMcpServers } from "../mcp/mcp-registry.ts";
export type Host = Record<string, any>;

export function createMcpServerResponse(getHost: () => Host): any {
function mcpServerResponse(viewer?: string | null) {
  const host = getHost();
  // While enrolled with custom servers off, say which servers stay configured
  // but never reach bots, and why. Nothing here is written to config.json.
  const policy = host.managedPolicy.current();
  const remote = host.remoteMcpServers();
  // Lot B: shared list entries are installation-scoped. Personal servers are
  // listed under /api/me; marking scope here lets editors skip personal lookups.
  const personalNames = host.personalMcpNamesForGuard();
  // a server that reads the GitHub connection (server/github/github-mcp-token.ts)
  // is connected when the viewer has one; never the token itself
  // (#4155: a saved account this launch cannot read is "unreadable", never "missing")
  let viewerGithub: "connected" | "missing" | "unreadable" | undefined;
  const githubState = (name: string): { github?: "connected" | "missing" | "unreadable" } => {
    const spec = remote[name];
    // undefined: the caller is not known here (the next listing says)
    if (!spec || viewer === undefined || !readsGithubToken(spec)) return {};
    viewerGithub ??= host.githubAccountToken(viewer) ? "connected" : host.githubAccountUnreadable(viewer) ? "unreadable" : "missing";
    return { github: viewerGithub };
  };
  const servers = listMcpServers(host.cfg.mcpServers).map(server => {
    const auth = "url" in server && remote[server.name] ? host.mcpOAuth.status(server.name, remote[server.name]) : undefined;
    const accounts = auth ? host.mcpOAuth.accounts(server.name, remote[server.name]!) : [];
    const listed = auth ? {
      ...server, ...auth,
      ...(auth.auth === "required" && host.mcpOAuth.pendingFor(server.name, DEFAULT_MCP_ACCOUNT) ? { authPending: true } : {}),
      // the default account first; the listing reads its state above
      ...(accounts.length ? { accounts: accounts.map((account) => ({
        ...account, ...(host.mcpOAuth.pendingFor(server.name, account.id) ? { authPending: true } : {})
      })) } : {})
    } : server;
    // Shared config rows stay installation; a name that only exists in a
    // person store never appears here. scope lets the panel skip personal lookups.
    const withScope = host.mcpServersHost.listing({ ...listed, ...githubState(server.name), scope: skipPersonalInSharedProbe(server.name, personalNames) ? "person" as const : "installation" as const });
    return host.managedPolicy.mcpAllowed(server.name, "url" in server ? server.url : undefined) ? withScope : { ...withScope, managedBy: policy!.organizationName };
  });
  // a server saved under a name Sagax now reserves is never mounted: listed
  // apart so the settings say so and offer a rename (#695 follow-up)
  const reserved = reservedMcpServers(host.cfg.mcpServers);
  return {
    servers,
    ...(reserved.length ? { reserved } : {}),
    ...(policy && !policy.mcp.allowCustom ? { managed: { organizationName: policy.organizationName, allowlist: policy.mcp.allowlist } } : {})
  };
}
  return mcpServerResponse;
}
