// @ts-nocheck
/** startDuplexCallTurn (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createStartDuplexCallTurn(getHost: () => Host): any {
async function startDuplexCallTurn(   botId: string,   threadId: string,   text: string,   replyTo: Message | undefined,   sendId: string | undefined,   sender: ResolvedSender | undefined,   trigger: UsageTrigger,   speaker: TurnSpeaker,   voiceCall: Message["voiceCall"], ) {
  const host = getHost();
  const { hasQueuedSteeredMessages } = host;

  const current = host.store.projectBotForTask(botId, threadId);
  if (!current) throw Object.assign(new Error("no such bot"), { status: 404 });
  const threadMessages = host.store.messagesFor(threadId);
  if (voiceCall?.continues === true) {
    const sibling = matchingVoiceSibling(
      threadMessages
        .filter((message) => message.role === "user" && message.parallelTask?.threadId && message.text)
        .map((message) => ({ threadId: message.parallelTask!.threadId, text: message.text! })),
      text,
    );
    const sameOwn = continuesSameUtterance(lastOwnUserVoiceText(threadMessages), text);
    if (!sameOwn && sibling && sibling !== threadId) {
      return startDuplexCallTurn(botId, sibling, text, replyTo, sendId, sender, trigger, speaker, voiceCall);
    }
  }
  // Only the call turn's own in-flight tool parks a new topic. A pending
  // parallel task is not touched by a replace, so it never makes the
  // person's next sentence a parallel task of its own.
  const backgroundWork = host.callHasParkableWork(threadMessages);
  const intent = host.classifyVoiceIntent(text);
  const sameUtterance = continuesSameUtterance(lastOwnUserVoiceText(threadMessages), text);
  const admit = admitDuplexSend({
    duplex: true,
    botBusy: Boolean(current.busy) || host.threadBusy(botId, threadId),
    stopping: host.stoppingThreads.has(threadId),
    queued: hasQueuedSteeredMessages(current.id, threadId),
    backgroundWork,
    newTopic: intent === "new_topic",
    intent,
    continues: voiceCall?.continues === true,
    speculative: voiceCall?.speculative === true,
    sameUtterance
  });
  if (admit.action === "defer") {
    return { ok: true as const, threadId, deferred: true as const };
  }
  // The call turn runs a tool: the words join it on the ordinary steer
  // path (the caller's), never a parallel task and never a kill.
  if (admit.action === "steer") return host.DUPLEX_JOIN_RUNNING_TURN;
  const epoch = host.duplexEpochFor(threadId);
  const mine = epoch.claim();
  if (admit.action === "stop") {
    host.voiceFirstSentences.cancel(threadId);
    discardSteeredQueue(current.id, threadId);
    if (admit.interrupt) await host.stopDirectThreadByPerson(current.id, threadId);
    return { ok: true as const, threadId, stopped: true as const };
  }
  if (admit.action === "replace") {
    if (admit.discardQueue) discardSteeredQueue(current.id, threadId);
    if (admit.interrupt) {
      await host.stopDirectThreadByPerson(current.id, threadId);
    }
    discardSteeredQueue(current.id, threadId);
  }
  if (!epoch.isLatest(mine)) return { ok: true as const, threadId, superseded: true as const };
  const deadline = Date.now() + DUPLEX_INTERRUPT_WAIT_MS;
  if (admit.action === "replace" && admit.interrupt) {
    await waitForThreadIdle(() => host.threadBusy(botId, threadId), {
      capMs: Math.max(0, deadline - Date.now())
    });
  }
  const openerId = voiceCall?.utteranceId;
  const openerCall = voiceCall?.callId;
  if (openerId && openerCall && (admit.action === "start" || admit.action === "replace")) {
    const engine = host.registry.get(current.modelSelection.instanceId);
    const audience = host.speakerPrincipal(speaker, host.effectiveBotOwner(current));
    if (engine?.generateText && audience) {
      const generate = engine.generateText.bind(engine);
      beginVoiceFirstSentence({
        jobs: host.voiceFirstSentences,
        threadId,
        callId: openerCall,
        utteranceId: openerId,
        text,
        driverKind: engine.driverKind,
        modelIds: engine.models.options.map((option) => option.id),
        generate,
        emit: (opener) => host.broadcast({
          kind: "voice.opener",
          audience,
          threadId,
          callId: openerCall,
          utteranceId: openerId,
          text: opener
        })
      });
    }
  }
  while (true) {
    if (!epoch.isLatest(mine)) return { ok: true as const, threadId, superseded: true as const };
    try {
      const message = await host.startTurn(botId, text, {
        threadId, replyTo, sendId, sender, trigger, speaker, ...(voiceCall ? { voiceCall } : {})
      });
      return { ok: true as const, threadId, message };
    } catch (err) {
      if (!isThreadBusyError(err) || Date.now() >= deadline) throw err;
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
  }

}
  return startDuplexCallTurn;
}
