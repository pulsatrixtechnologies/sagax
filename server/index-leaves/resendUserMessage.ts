// @ts-nocheck
/** resendUserMessage (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createResendUserMessage(getHost: () => Host): any {
function resendUserMessage(botId: string, threadId: string, messageId: string, speaker: TurnSpeaker | undefined, tag: string) {
  const host = getHost();

  void (async () => {
    // Wait briefly for the failed turn to release the thread.
    for (let waited = 0; host.threadBusy(botId, threadId) && waited < 10_000; waited += 50) {
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
    }
    const path = host.store.activePath(threadId);
    const message = path.find((candidate) => candidate.id === messageId);
    if (!message || message.role !== "user" || message.kind !== "text" || !message.text || message.peerAsk) return;
    if (path.findLast((candidate) => candidate.role === "user" && candidate.kind === "text")?.id !== messageId) return;
    if (!host.store.taskByThread(botId, threadId) || host.threadBusy(botId, threadId)) return;
    try {
      await host.startTurn(botId, message.text, {
        threadId, userMessage: message,
        ...(speaker ? { speaker } : {}),
      });
    } catch (error) {
      if ((error as { code?: string }).code !== "answered") {
        console.warn(`[${tag}] ${threadId}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  })().catch(host.reportBackgroundError);

}
  return resendUserMessage;
}
