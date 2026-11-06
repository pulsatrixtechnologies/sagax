// @ts-nocheck
/** startAgentPrompt (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createStartAgentPrompt(getHost: () => Host): any {
async function startAgentPrompt(from: BotRecord, target: BotRecord, threadId: string, text: string, sourceThreadId: string, depth: number, wake?: PriorityDelivery): Promise<{ messageId: string | null } | Refusal> {
  const host = getHost();
  const { agentRefuse, queueSteeredMessage } = host;

  const unattended = host.isUnattended(from.id, sourceThreadId);
  const peerAsk = { botId: from.id, name: from.name, unattended: unattended || undefined };
  const speaker = host.peerSpeaker(from.id, sourceThreadId);
  const decision = host.admit("opened-thread", {}, { atCapacity: host.botAtThreadCapacity(target.id), groupTurn: Boolean(host.activeGroupTurnForBot(target.id)) });
  // front is set only when the conversation is already busy. priorityNow
  // alone still starts when admit says start; using it as front would queue
  // an idle wake.
  const forceFront = wake?.front === true;
  if (forceFront || decision.action === "queue") {
    const reason = decision.action === "queue" && (decision.reason === "capacity" || decision.reason === "group-turn")
      ? decision.reason
      : "capacity";
    queueSteeredMessage(target.id, threadId, text, {
      reason, unattended, peerAsk, speaker,
      ...((forceFront || wake?.priorityNow) ? { front: true } : {})
    });
    return { messageId: null };
  }
  const before = new Set(host.store.messagesFor(threadId).map((message) => message.id));
  try {
    await host.startTurn(target.id, text, { threadId, unattended, peerAsk, speaker, commsDepth: depth + 1 });
  } catch (error) {
    return agentRefuse(409, "not_started", `The prompt could not start: ${error instanceof Error ? error.message : String(error)}`);
  }
  const posted = host.store.messagesFor(threadId).find((message) => !before.has(message.id) && message.role === "user");
  return { messageId: posted?.id ?? null };

}
  return startAgentPrompt;
}
