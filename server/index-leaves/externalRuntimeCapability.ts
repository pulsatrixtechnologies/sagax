// @ts-nocheck
/** externalRuntimeCapability (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createExternalRuntimeCapability(getHost: () => Host): any {
function externalRuntimeCapability(header: string | string[] | undefined) {
  const host = getHost();

  const grant = host.authorizeExternalRuntime(host.EXTERNAL_RUNTIMES_FILE, header, id => host.store.bot(id));
  if (!grant) return null;
  return {
    botId: grant.botId,
    threadId: grant.threadId,
    externalRuntime: grant,
    generation: host.EXTERNAL_RUNTIME_GENERATION,
    depth: 0,
    kind: "agents",
    skillAuthoring: false,
    createdBots: 0,
    openedThreads: 0,
    orphanExpiresAt: Number.MAX_SAFE_INTEGER,
    roomCoordination: false,
    ownThreadCreation: false
  };

}
  return externalRuntimeCapability;
}
