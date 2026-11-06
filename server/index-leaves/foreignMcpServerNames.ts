// @ts-nocheck
/** foreignMcpServerNames (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createForeignMcpServerNames(getHost: () => Host): any {
function foreignMcpServerNames(bot: BotRecord, threadId: string) {
  const host = getHost();
  const { isPrincipalId } = host;

  const out = new Set<string>();
  try {
    for (const name of Object.keys(host.engineMcpServers(bot))) out.add(name);
  } catch {
    // an unreadable configuration names no server
  }
  for (const person of [host.effectiveBotOwner(bot), host.turnSpeakerPrincipals.get(threadId)]) {
    if (!person || !isPrincipalId(person)) continue;
    try {
      for (const name of Object.keys(host.personConnections.servers(person))) out.add(name);
    } catch {
      // a vault that does not open names no server
    }
  }
  return [...out];

}
  return foreignMcpServerNames;
}
