// @ts-nocheck
/** commitFailedTurn (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createCommitFailedTurn(getHost: () => Host): any {
function commitFailedTurn(input: {   messageId: string;   threadId: string | null;   result: { queued: string[]; status: "failed" | null; messages: OpenTurnMessage[] };   detail: string; }) {
  const host = getHost();

  if (input.result.status !== "failed") return;
  host.queuedWorkerTurns = host.queuedWorkerTurns.filter((item) => input.result.queued.includes(item.messageId));
  host.forgetInflight(input.messageId);
  if (!input.threadId) return;
  const marked = input.result.messages.find((message) => message.id === input.messageId);
  const current = host.store.messagesFor(input.threadId).find((message) => message.id === input.messageId);
  if (marked?.status === "failed" && current) {
    host.store.patchMessage(input.threadId, input.messageId, {
      status: "failed",
      ...(current.text === undefined && marked.text !== undefined ? { text: marked.text } : {})
    });
  }
  const group = host.store.groupByThread(input.threadId);
  if (!group) return;
  host.cancelGroupTurnOperations(group.id, input.threadId, { status: "stopped", detail: input.detail });

}
  return commitFailedTurn;
}
