// @ts-nocheck
/** dataScopeForViewer (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createDataScopeForViewer(getHost: () => Host): any {
function dataScopeForViewer(auth: RequestAuth, bot: { id: string }, threadId: string | undefined) {
  const host = getHost();
  const { channelViewerId, dataScopeKey } = host;

  const record = host.store.bot(bot.id);
  if (!record) return null;
  if (threadId && host.store.botByThread(threadId)?.id !== record.id) return null;
  const organization = host.IDENTITY.kind === "perspicax";
  const principalId = auth.kind === "session" ? channelViewerId(auth) : organization ? host.localPrincipalId() : undefined;
  return dataScopeKey({ botId: record.id, organization, ownerPrincipalId: host.effectiveBotOwner(record), principalId, threadId });

}
  return dataScopeForViewer;
}
