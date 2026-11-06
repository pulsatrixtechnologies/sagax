// @ts-nocheck
/** deliverLateQuestionAnswer (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createDeliverLateQuestionAnswer(getHost: () => Host): any {
async function deliverLateQuestionAnswer(
  auth: RequestAuth,
  threadId: string,
  requestId: string,
  answer: string,
  cardMessage: Message,
  owner: BotRecord,
  via?: "call",
  /** The Live call a spoken answer was given on (Message.callId); only with via. */
  callId?: string,
): Promise<{ queued: boolean }> {
  const host = getHost();
  const { DATA_DIR, acceptedSendMatch, assertWithinBudget, sendFingerprint } = host;
  const group = host.store.groupByThread(threadId);
  const roomTarget = group
    ? group.dm
      ? group.threadId === threadId
      : Boolean(host.store.groupTaskByThread(group.id, threadId))
    : false;
  if (group && (!roomTarget || !group.memberIds.includes(owner.id))) {
    throw Object.assign(new Error("the bot that asked this question is no longer in this conversation"), { status: 409 });
  }
  if (!group && !host.store.taskByThread(owner.id, threadId)) {
    throw Object.assign(new Error("the question's conversation no longer exists"), { status: 409 });
  }

  const text = group ? `@${owner.name}: ${answer}` : answer;
  const sendId = `late-question-${createHash("sha256").update(`${threadId}:${requestId}`).digest("hex").slice(0, 32)}`;
  const key = group
    ? `group:${group.id}:${threadId}:${sendId}`
    : `bot:${owner.id}:${threadId}:${sendId}`;
  const receipt = await host.sendSequencer.run(key, sendFingerprint(text, cardMessage.id, group ? "chat" : undefined), async () => {
    const accepted = acceptedSendMatch(host.store.messagesFor(threadId), sendId, text, cardMessage.id, group ? "chat" : undefined);
    if (accepted.kind === "conflict") throw Object.assign(new Error("this question already has a different recorded answer"), { status: 409 });
    if (accepted.kind === "match") return { queued: false };

    const queuedDirect = group ? null : queuedSteeredMessage(owner.id, threadId, sendId);
    if (queuedDirect) {
      if (queuedDirect.text !== text || queuedDirect.replyToId !== cardMessage.id) {
        throw Object.assign(new Error("this question already has a different queued answer"), { status: 409 });
      }
      return { queued: true };
    }
    const queuedRoom = group ? queuedChannelMessage(group.id, threadId, sendId) : null;
    if (queuedRoom) {
      if (queuedRoom.text !== text || queuedRoom.replyToId !== cardMessage.id || queuedRoom.mode !== "chat") {
        throw Object.assign(new Error("this question already has a different queued answer"), { status: 409 });
      }
      return { queued: true };
    }

    const latestCard = host.store.messagesFor(threadId).find((message) => message.id === cardMessage.id)?.card;
    if (!latestCard || latestCard.answered || latestCard.dismissed) {
      throw Object.assign(new Error("this question has already been answered"), { status: 409 });
    }
    assertWithinBudget(host.cfg, DATA_DIR);
    const sender = host.messageSender(auth);
    const trigger = host.usageTriggerFor(auth);
    if (group) {
      const current = host.store.group(group.id);
      if (!current || !roomTarget) throw Object.assign(new Error("the room switched tasks before it could receive the answer"), { status: 409 });
      if (host.groupIsWorking(current)) {
        const queued = queueChannelMessage(current.id, threadId, text, {
          replyToId: cardMessage.id,
          sendId,
          mode: "chat",
          sender,
          trigger
        });
        return { queued: true, queueId: queued.id };
      }
      host.startGroupTurn(current.id, text, cardMessage, sendId, "chat", undefined, { threadId, sender, trigger });
      return { queued: false };
    }
    const direct = await host.startOrQueueDirectMessage(owner.id, threadId, text, cardMessage, sendId, sender, trigger, host.speakerFor(auth), undefined, via, callId);
    return { queued: "queued" in direct && Boolean(direct.queued) };
  });

  const latest = host.store.messagesFor(threadId).find((message) => message.id === cardMessage.id)?.card;
  if (latest && !latest.answered && !latest.dismissed) {
    host.store.patchMessage(threadId, cardMessage.id, { card: { ...latest, answered: "answer", answeredText: answer, dismissed: false } });
  }
  return receipt;

}
  return deliverLateQuestionAnswer;
}
