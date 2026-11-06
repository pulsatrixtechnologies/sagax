// @ts-nocheck
/** addPersonalMcpServer (#1388). Pure move from server/index.ts. */
import { sharedPersonalNameRefusal } from "../mcp/mcp-personal-shared-guard.ts";
import { parsePersonalMcpInput, personalMcpHostRefusal, personalMcpPrivateAllowed } from "../people/person-connections.ts";
export type Host = Record<string, any>;

export function createAddPersonalMcpServer(getHost: () => Host): any {
async function addPersonalMcpServer(principalId: string, body: unknown) {
  const host = getHost();
  const { PersonConnectionsError } = host;

  const { name, server } = parsePersonalMcpInput(body, Date.now(), personalMcpPrivateAllowed());
  if (server.kind === "remote") {
    const hostRefusal = await personalMcpHostRefusal(server.url, { allowPrivate: personalMcpPrivateAllowed() });
    if (hostRefusal) throw new PersonConnectionsError(hostRefusal, "private_address");
  }
  // one rule for every server (shared/mcp-reserved-names.ts)
  if (host.reservedMcpName(name)) throw new PersonConnectionsError("That name is reserved by Sagax. Choose another one.", "invalid_name");
  // Lot B: a personal key must never share a name with installation config.
  const sharedClash = sharedPersonalNameRefusal(name, Object.keys(host.cfg.mcpServers ?? {}));
  if (sharedClash) throw new PersonConnectionsError(sharedClash, "name_taken", 409);
  if (server.kind === "stdio" && !host.userSandbox) {
    throw new PersonConnectionsError("This server has no server environments, so a command cannot run for you here. Add a remote host.server (an https address) instead.", "no_environment", 409);
  }
  host.personConnections.add(principalId, name, server);
  if (server.kind === "remote" && server.auth === "oauth") {
    const manager = host.personOAuth(principalId);
    await manager.forget(name).catch(() => undefined);
    await manager.probe(name, host.personalRemoteSpec(server), AbortSignal.timeout(10_000)).catch(() => undefined);
  }

}
  return addPersonalMcpServer;
}
