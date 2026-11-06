// @ts-nocheck
/** drainQueuedSends (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createDrainQueuedSends(getHost: () => Host): any {
function drainQueuedSends() {
  const host = getHost();

  if (!host.followupsReady) return;
  drainSteeredMessages(host.store, (botId, threadId, prompt, userMessage, excludeIds, unattended, head) =>
    // A plain attended turn — no automationSource, no comms depth: exactly
    // what typing the same words into an idle bot would run. Self-opened
    // work retains `unattended` and the message's bot-origin provenance
    // through the wait for a slot.
    // Drain just appended the held lines; userMessage keeps startTurn
    // from duplicating the last one, and excludeIds drops every drained
    // line from the transcript-replay so they are not also in `prompt`.
    new Promise<void>((resolve, reject) => {
      // The drained turn is booked to whoever sent the first waiting line.
      void host.startTurn(botId, prompt, {
        threadId, userMessage, excludeMessageIds: excludeIds, unattended,
        onTurnSettled: () => { resolve(); host.settleParallelFallback(threadId); },
        trigger: host.queuedTurnTrigger(head),
        // the first waiting line's speaker, as it was when queued; rows
        // queued before speakers were kept read from their provenance
        speaker: head.speaker ?? host.resolveTurnSpeaker({ sender: head.sender, peerAsk: head.peerAsk, trigger: head.trigger }),
        ...(head.origin ? { origin: head.origin } : {})
      }).catch((err) => {
        const why = err instanceof Error ? err.message : String(err);
        const chief = head.peerAsk?.incident ? host.store.bot(botId) : null;
        // Reports that waited are refused like one sent at once: the
        // person still hears of a failure nobody buzzed them about.
        if (chief) host.incidentRefused(chief, threadId, host.store.activePath(threadId).filter(line => excludeIds.includes(line.id)).map(line => line.peerAsk), why);
        else host.store.appendMessage(threadId, {
          role: "bot", kind: "activity",
          tool: host.failedTurnTool(`queued message could not start — ${why}`)
        });
        host.settleParallelTask(threadId, { ok: false, reply: "", why: err instanceof Error ? err.message : String(err) });
        resolve();
        // M2: only this group left the queue, and a turn that never
        // started publishes no completion to wake the groups behind it.
        queueMicrotask(drainQueuedSends);
      }).catch(reject);
    }),
    // Provider completion can precede its dispatch promise: keep the queue
    // intact until that exact handshake releases its runtime-only claim.
    // Team incidents reports never park behind handed-on work (admission's
    // "incident" surface says why).
    // A person's queued words in the main chat never wait for a slot.
    (botId, threadId, head) => host.threadBusy(botId, threadId) || host.botAtThreadCapacity(botId, head.peerAsk ? undefined : threadId)
      || Boolean(host.activeGroupTurnForBot(botId))
      || (!head.peerAsk?.incident && host.parksBehindCoordination(botId, threadId)) || host.parallelTaskBlocked(botId, threadId),
  );

}
  return drainQueuedSends;
}
