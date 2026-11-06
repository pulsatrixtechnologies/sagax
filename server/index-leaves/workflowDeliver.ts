// @ts-nocheck
/** workflowDeliver (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createWorkflowDeliver(getHost: () => Host): any {
function workflowDeliver(scopeKey: string, botId: string, threadId: string, text: string) {
  const host = getHost();

  const bot = host.store.bot(botId);
  if (!bot) return;
  const onBot = bot.threadId === threadId || Boolean(bot.tasks?.some((task) => task.threadId === threadId));
  if (!onBot) return;
  if (host.IDENTITY.kind === "perspicax" && host.effectiveBotOwner(bot).toLowerCase() !== scopeKey) return;
  host.store.appendMessage(threadId, { role: "bot", kind: "text", text });

}
  return workflowDeliver;
}
