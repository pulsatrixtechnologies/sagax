// @ts-nocheck
/** personalServerListing (#1388). Pure move from server/index.ts. */
import { isGithubMcpServer } from "../github/github-mcp-token.ts";
export type Host = Record<string, any>;

export function createPersonalServerListing(getHost: () => Host): any {
async function personalServerListing(principalId: string) {
  const host = getHost();

  const github = host.personGithub(principalId);
  const servers = host.personConnections.servers(principalId);
  return host.personConnections.list(principalId).map((listing) => {
    const server = servers[listing.name]!;
    if (server.kind !== "remote") return { ...listing, auth: "none" as const, authState: host.userSandbox ? "ready" : "no_environment" };
    if (server.auth === "github") return { ...listing, authState: github ? "connected" : "needs_github" };
    if (server.auth === "token") return { ...listing, authState: server.token ? "connected" : "needs_token" };
    // #3392: an address on GitHub with no sign-in goes with the person's
    // GitHub connection (personalMcpPrecheck)
    if (server.auth === "none") return { ...listing, authState: isGithubMcpServer({ type: server.type, url: server.url, headers: {} }) ? (github ? "connected" : "needs_github") : "ready" };
    const manager = host.personOAuth(principalId);
    const status = manager.status(listing.name, host.personalRemoteSpec(server));
    return {
      ...listing,
      authState: status?.auth === "connected" ? "connected" : status?.auth === "expired" ? "expired" : status?.auth === "error" ? "error" : "needs_sign_in",
      ...(status?.authError ? { authError: status.authError } : {}),
      ...(manager.pendingFor(listing.name) ? { authPending: true } : {}),
      ...(status?.authClient === "needed" ? { authClient: "needed" } : {})
    };
  });

}
  return personalServerListing;
}
