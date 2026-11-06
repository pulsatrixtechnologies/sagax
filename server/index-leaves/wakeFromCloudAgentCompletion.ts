// @ts-nocheck
/** wakeFromCloudAgentCompletion (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createWakeFromCloudAgentCompletion(getHost: () => Host): any {
function wakeFromCloudAgentCompletion(event: CloudAgentCompletionEvent) {
  const host = getHost();

  const { record } = event;
  const { botId, threadId } = record;
  // a run started outside Sagax has no thread to wake
  if (!botId || !threadId) return;
  const bot = host.store.bot(botId);
  if (!bot || !host.store.taskByThread(botId, threadId)) return;
  const principalId = host.turnSpeakerPrincipals.get(threadId);
  const prompt = host.cloudAgentWakePrompt(event);
  const speaker: TurnSpeaker | undefined = principalId
    ? { origin: "person", principalId }
    : undefined;
  void host.startTurn(botId, prompt, {
    threadId,
    cardContinuation: true,
    unattended: host.isUnattended(botId, threadId),
    ...(speaker ? { speaker } : {})
  }).catch((error) => {
    console.warn(`[cloud-agents] wake failed: ${error instanceof Error ? error.message : String(error)}`);
  });

}
  return wakeFromCloudAgentCompletion;
}
