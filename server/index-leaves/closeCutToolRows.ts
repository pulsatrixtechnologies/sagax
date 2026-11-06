// @ts-nocheck
/** closeCutToolRows (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createCloseCutToolRows(getHost: () => Host): any {
function closeCutToolRows(threadId: string, output: string = CUT_TOOL_OUTPUT) {
  const host = getHost();

  const prefix = `${threadId}:`;
  let closed = 0;
  for (const [key, messageId] of host.toolMessageByItem) {
    if (!key.startsWith(prefix)) continue;
    host.toolMessageByItem.delete(key);
    const row = host.store.messagesFor(threadId).find((m) => m.id === messageId);
    if (!row || !toolRowOpen(row)) continue;
    host.store.patchMessage(threadId, messageId, { tool: closedTool(row, output, Date.now()) });
    closed += 1;
  }
  return closed;

}
  return closeCutToolRows;
}
