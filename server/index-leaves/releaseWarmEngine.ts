// @ts-nocheck
/** releaseWarmEngine (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createReleaseWarmEngine(getHost: () => Host): any {
function releaseWarmEngine(threadId: string) {
  const host = getHost();

  const bot = host.store.botByThread(threadId);
  if (!bot) return;
  const live = host.store.projectBotForTask(bot.id, threadId) ?? bot;
  // the call's session may run on another engine than the conversation's
  const voiceInstance = host.voiceSessions.end(threadId);
  if (voiceInstance && voiceInstance !== live.modelSelection.instanceId) host.registry.get(voiceInstance)?.adapter.releaseWarmSession?.(threadId);
  host.registry.get(live.modelSelection.instanceId)?.adapter.releaseWarmSession?.(threadId);

}
  return releaseWarmEngine;
}
