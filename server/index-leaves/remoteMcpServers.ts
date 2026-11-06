// @ts-nocheck
/** remoteMcpServers (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createRemoteMcpServers(getHost: () => Host): any {
function remoteMcpServers(names?: string[]) {
  const host = getHost();
  const { isRemoteMcpServer, parseStoredMcpServer } = host;

  const out: Record<string, StoredRemoteMcpServer> = {};
  for (const [name, raw] of Object.entries(host.cfg.mcpServers ?? {})) {
    if (names && !names.includes(name)) continue;
    const parsed = parseStoredMcpServer(name, raw);
    if (parsed.ok && isRemoteMcpServer(parsed.server)) out[name] = parsed.server;
  }
  return out;

}
  return remoteMcpServers;
}
