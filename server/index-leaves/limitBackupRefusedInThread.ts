// @ts-nocheck
/** limitBackupRefusedInThread (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createLimitBackupRefusedInThread(getHost: () => Host): any {
function limitBackupRefusedInThread(botId: string, threadId: string, speaker?: unknown) {
  const host = getHost();

  const back = host.limitFailover.backupRefused(botId, threadId, speaker);
  if (!back) return null;
  const text = host.limitBackupRefusedText(back);
  const line = host.store.messagesFor(threadId).findLast((message) => message.kind === "activity" && message.tool?.limitFailover?.kind === "switched");
  if (line) host.store.patchMessage(threadId, line.id, { tool: host.failedTurnTool(text, { terminal: true }) });
  else host.store.appendMessage(threadId, { role: "bot", kind: "activity", tool: host.failedTurnTool(text, { terminal: true }) });
  return text;

}
  return limitBackupRefusedInThread;
}
