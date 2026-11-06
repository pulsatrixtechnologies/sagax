// @ts-nocheck
/** aiClientThreadPerson (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createAiClientThreadPerson(getHost: () => Host): any {
function aiClientThreadPerson(bot: BotRecord, threadId: string, commsDepth: number, message: Message) {
  const host = getHost();
  const { isAgentConversation } = host;

  if (commsDepth > 0 || message.role !== "user" || message.peerAsk) return "";
  const task = host.store.taskByThread(bot.id, threadId);
  if (!task || host.store.isConfidentialThread(threadId)) return "";
  if (!isAgentConversation(task) && (task.hidden !== true || task.openedBy?.botId)) return "";
  const sender = message.sender?.id?.trim().toLowerCase();
  if (!sender || !task.ownerPrincipalId || task.ownerPrincipalId.trim().toLowerCase() !== sender) return "";
  return aiClientPrompt(message.sender?.name ?? "");

}
  return aiClientThreadPerson;
}
