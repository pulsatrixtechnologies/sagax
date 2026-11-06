// @ts-nocheck
/** turnToolEvidence (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createTurnToolEvidence(getHost: () => Host): any {
function turnToolEvidence(threadId: string, sinceAt: number): { toolCalls: number; tools: string[] } {
  const host = getHost();

  const names: string[] = [];
  for (const message of host.store.messagesFor(threadId)) {
    if (message.at < sinceAt) continue;
    if (message.kind !== "activity" || !message.tool?.name) continue;
    const name = String(message.tool.name).trim();
    if (!name || names.includes(name)) continue;
    names.push(name);
  }
  return { toolCalls: names.length, tools: names };

}
  return turnToolEvidence;
}
