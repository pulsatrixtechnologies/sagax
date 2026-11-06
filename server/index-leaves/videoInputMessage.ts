// @ts-nocheck
/** videoInputMessage (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createVideoInputMessage(getHost: () => Host): any {
function videoInputMessage(capability: InternalCapabilityView) {
  const host = getHost();
  const { internalCapabilities } = host;

  const current = [...internalCapabilities.values()].find(item => item.kind === "agents" && item.botId === capability.botId && item.threadId === capability.threadId && item.generation === capability.generation);
  const request = host.directRequestOwners.get(capability.threadId);
  return host.videoSourceMessage({ messages: host.store.activePath(capability.threadId),
    messageId: request?.generations.has(capability.generation) ? request.messageId : undefined,
    startedAt: current?.turnStartedAt ?? 0,
    principalId: host.IDENTITY.kind === "perspicax" ? host.turnMediaPrincipal(capability.threadId) : undefined,
    routine: host.turnRoutineLineage.has(capability.threadId) || Boolean(request?.automation)
  });

}
  return videoInputMessage;
}
