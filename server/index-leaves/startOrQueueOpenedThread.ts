// @ts-nocheck
/** startOrQueueOpenedThread (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createStartOrQueueOpenedThread(getHost: () => Host): any {
async function startOrQueueOpenedThread(
  botId: string,
  threadId: string,
  text: string,
  unattended: boolean,
  origin: WorkOrigin,
  sourceThreadId?: string,
): Promise<{ state: "running" } | { state: "queued"; position: number } | { state: "failed"; error: string }> {
  const host = getHost();
  const { queueSteeredMessage, queuedThreadPosition } = host;

  const peerAsk = { botId, name: host.store.bot(botId)!.name, unattended: unattended || undefined };
  const speaker = host.peerSpeaker(botId, sourceThreadId);
  const decision = host.admit("opened-thread", {}, {
    // A room turn holds the bot too (startTurn refuses a direct turn during
    // one); the drain's own block check already waits for it, so the words
    // queue here rather than bounce.
    atCapacity: host.botAtThreadCapacity(botId),
    groupTurn: Boolean(host.activeGroupTurnForBot(botId)),
    // #3296: a stopping server would cut the turn; it waits for the next start
    restarting: host.isShuttingDown()
  });
  if (decision.action === "queue") {
    queueSteeredMessage(botId, threadId, text, {
      reason: decision.reason,
      unattended,
      peerAsk,
      speaker,
      origin
    });
    return { state: "queued", position: queuedThreadPosition(botId, threadId) ?? 1 };
  }
  try {
    await host.startTurn(botId, text, { threadId, unattended, peerAsk, speaker, origin });
    return { state: "running" };
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    host.store.appendMessage(threadId, {
      role: "bot",
      kind: "activity",
      tool: host.failedTurnTool(`this thread could not start — ${why}`)
    });
    return { state: "failed", error: why };
  }

}
  return startOrQueueOpenedThread;
}
