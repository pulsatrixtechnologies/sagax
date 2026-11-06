// @ts-nocheck
/** ownerScopedMcpServerFor (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createOwnerScopedMcpServerFor(getHost: () => Host): any {
function ownerScopedMcpServerFor(bot: BotRecord, threadId: string) {
  const host = getHost();
  const { isPrincipalId } = host;

  return (server) => {
    const name = server.toLowerCase();
    if (host.perspicaxOwnerScopedServer(name)) return true;
    if (host.claudeAiOwnerScopedServer(server, host.turnAccessByThread.get(threadId)?.via)) return true;
    const has = (names: Iterable<string>) => [...names].some((candidate) => candidate.toLowerCase() === name);
    try {
      if (has(Object.entries(host.engineMcpServers(bot)).filter(([, spec]) => "url" in spec).map(([key]) => key))) return true;
    } catch {
      // an unreadable configuration names no server
    }
    for (const person of [host.effectiveBotOwner(bot), host.turnSpeakerPrincipals.get(threadId)]) {
      if (!person || !isPrincipalId(person)) continue;
      try {
        if (has(Object.keys(host.personConnections.servers(person)))) return true;
      } catch {
        // a vault that does not open names no server
      }
    }
    return false;
  };

}
  return ownerScopedMcpServerFor;
}
