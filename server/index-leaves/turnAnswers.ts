// @ts-nocheck
/** turnAnswers (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createTurnAnswers(getHost: () => Host): any {
function turnAnswers(threadId: string, opts?: {
  cardContinuation?: boolean; requestMessageId?: string; coordination?: { id: string };
  userMessage?: Message; excludeMessageIds?: string[]; peerAsk?: Message["peerAsk"];
}): { incident: boolean; quiet: boolean } {
  const host = getHost();

  const path = host.store.activePath(threadId);
  let lines: Array<Pick<Message, "peerAsk" | "queueId">>;
  if (opts?.cardContinuation) {
    const node = opts.coordination && host.coordinator.node(opts.coordination.id);
    const root = node && host.coordinator.node(node.rootId);
    const end = root?.threadId === threadId ? path.findLastIndex(message => message.role === "user" && message.at <= root.createdAt)
      : opts.requestMessageId ? path.findIndex(message => message.id === opts.requestMessageId)
      : path.findLastIndex(message => message.role === "user");
    // a request drained from the queue is the run of lines it landed as
    let start = end;
    while (start > 0 && path[start - 1].role === "user") start -= 1;
    lines = end < 0 ? [] : path.slice(start, end + 1);
  } else {
    const ids = new Set([...(opts?.excludeMessageIds ?? []), ...(opts?.userMessage ? [opts.userMessage.id] : [])]);
    lines = ids.size ? path.filter(message => ids.has(message.id)) : [{ peerAsk: opts?.peerAsk }];
  }
  const reports = lines.filter(line => line.peerAsk?.incident);
  return {
    incident: reports.length > 0,
    quiet: reports.length > 0 && reports.length === lines.length && reports.every(line => line.queueId && line.peerAsk?.incident?.notified)
  };

}
  return turnAnswers;
}
