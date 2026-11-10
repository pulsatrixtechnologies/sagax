// @ts-nocheck
/** startOrQueueDirectMessageNow (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createStartOrQueueDirectMessageNow(getHost: () => Host): any {
async function startOrQueueDirectMessageNow(botId: string, threadId: string, text: string, replyTo?: Message, sendId?: string, sender?: ResolvedSender, trigger?: UsageTrigger, speaker?: TurnSpeaker, voiceCall?: Message["voiceCall"], via?: "call", callId?: string, dataContext?: DataContext) {
  const host = getHost();
  const { queueSteeredMessage } = host;
  const decision = host.admit("direct", {}, {
    // A room turn holds the bot exactly like the sibling opened-thread queue
    // below: the drain's own block check waits it out, so the words queue
    // here rather than bounce off startTurn's 409. The main chat never
    // queues for capacity.
    atCapacity: host.botAtThreadCapacity(botId, threadId),
    threadBusy: host.threadBusy(botId, threadId),
    groupTurn: Boolean(host.activeGroupTurnForBot(botId)),
    parksBehindCoordination: host.parksBehindCoordination(botId, threadId),
    // #3296: a stopping server would cut the turn; it waits for the next start
    restarting: host.isShuttingDown()
  });
  if (decision.action === "queue") {
    const queued = queueSteeredMessage(botId, threadId, text, {
      replyToId: replyTo?.id,
      sendId,
      dataContext,
      reason: decision.reason,
      prompt: host.promptWithReply(host.promptWithDataContext(text, dataContext), replyTo, host.cfg.profile?.name?.trim() || "User"),
      sender,
      trigger,
      speaker,
      ...(voiceCall ? { voiceCall } : {}),
      ...(via ? { via } : {}),
      ...(callId ? { callId } : {})
    });
    return { ok: true as const, queued: true as const, queueId: queued.id, threadId, reason: decision.reason };
  }
  const message = await host.startTurn(botId, text, { threadId, replyTo, sendId, sender, trigger, speaker, ...(voiceCall ? { voiceCall } : {}), ...(via ? { via } : {}), ...(callId ? { callId } : {}), ...(dataContext ? { dataContext } : {}) });
  return { ok: true as const, threadId, message };

}
  return startOrQueueDirectMessageNow;
}
