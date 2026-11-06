// @ts-nocheck
/** stagedSkillCleanupsForThread (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createStagedSkillCleanupsForThread(getHost: () => Host): any {
function stagedSkillCleanupsForThread(threadId: string): Array<{ botId: string; stagedId: string }> {
  const host = getHost();

  const directOwner = host.store.botByThread(threadId)?.id;
  const seen = new Set<string>();
  const cleanups: Array<{ botId: string; stagedId: string }> = [];
  for (const message of host.store.messagesFor(threadId)) {
    const request = message.card?.skillRequest;
    const botId = message.from?.botId ?? directOwner;
    if (!request || !botId) continue;
    const key = `${botId}:${request.stagedId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    cleanups.push({ botId, stagedId: request.stagedId });
  }
  return cleanups;

}
  return stagedSkillCleanupsForThread;
}
