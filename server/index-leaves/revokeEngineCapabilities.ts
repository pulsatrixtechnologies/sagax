// @ts-nocheck
/** revokeEngineCapabilities (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createRevokeEngineCapabilities(getHost: () => Host): any {
function revokeEngineCapabilities(engines: ReadonlySet<string>) {
  const host = getHost();

  if (!engines.size) return;
  const onChanged = (botId: string, threadId: string) => engines.has(host.threadEngineId(botId, threadId) ?? "");
  for (const capability of host.internalCapabilities.values()) {
    if (onChanged(capability.botId, capability.threadId)) host.revokeEarlierTurnCapabilities(capability.threadId);
  }
  for (const [threadId, slots] of host.sessionCredentials) {
    for (const slot of slots.keys()) if (onChanged(slot.split(" ")[0]!, threadId)) slots.delete(slot);
  }

}
  return revokeEngineCapabilities;
}
