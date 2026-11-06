// @ts-nocheck
/** turnNetworkProxy (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createTurnNetworkProxy(getHost: () => Host): any {
function turnNetworkProxy(threadId: string, botId: string, decision: WorkplaceDecision): { url: string; noProxy: string[] } | undefined {
  const host = getHost();

  const person = decision.principal;
  if (decision.target !== "user-desktop" || !person || !host.egressProxy || !host.desktopTunnels.connected(person)) return undefined;
  const url = host.egressProxy.urlFor({
    person, botId, threadId,
    active: () => {
      const current = host.turnWorkplaces.get(threadId);
      return Boolean(current && current.decision.target === "user-desktop" && current.decision.principal === person &&
        host.activeInternalGenerationByThread.get(threadId) === current.generation);
    },
    network: () => host.workplacePreference(person).network
  });
  const hosts = [process.env.SAGAX_PERSPICAX_ISSUER, process.env.ANTHROPIC_BASE_URL, process.env.OPENAI_BASE_URL]
    .map((value) => { try { return value ? new URL(value).hostname : ""; } catch { return ""; } });
  return { url, noProxy: hosts.filter(Boolean) };

}
  return turnNetworkProxy;
}
