// @ts-nocheck
/**
 * agentPendingApproval (#2922). The cards a conversation waits on, in that
 * thread AND in the threads it handed work to (a teammate's permission card
 * two levels down still blocks the turn the external caller awaits).
 *
 * - open: live option cards (requestId, not answered, dismissed nor expired),
 *   oldest first, each with the thread that holds it (the one to answer on).
 * - reviewing: cards a model reviewer is still deciding (card.reviewing):
 *   not for the person yet, but the turn is not finished either.
 *
 * A teammate card mirrored into the root thread (origin-approvals, #2901)
 * is listed once, as the mirror (requestId origin:<msgId>), never twice.
 * Confidential threads are skipped. The walk is bounded (depth 3, visited set)
 * so a handoff cycle cannot loop.
 */
export type Host = Record<string, any>;

export interface PendingApprovalRow {
  threadId: string;
  message: any;
  card: any;
  depth: number;
}

const MAX_DEPTH = 3;

export function createAgentPendingApproval(getHost: () => Host): any {
  function childThreads(host: Host, agentId: string, threadId: string, depth: number): string[] {
    const out: string[] = [];
    try {
      for (const node of host.coordinator?.outstandingFor?.(threadId) ?? []) {
        if (node?.threadId) out.push(node.threadId);
      }
    } catch {
      // coordinator not ready: no children
    }
    if (depth === 0) {
      for (const task of host.store.tasks?.(agentId) ?? []) {
        if (task?.parallelOf?.threadId === threadId && task.threadId) out.push(task.threadId);
      }
    }
    return out;
  }

  function agentPendingApproval(agentId: string, rootThreadId: string): { open: PendingApprovalRow[]; reviewing: PendingApprovalRow[] } {
    const host = getHost();
    const open: PendingApprovalRow[] = [];
    const reviewing: PendingApprovalRow[] = [];
    const mirrored = new Set<string>();
    const visited = new Set<string>();
    const queue: Array<{ threadId: string; depth: number }> = [{ threadId: rootThreadId, depth: 0 }];
    while (queue.length) {
      const { threadId, depth } = queue.shift()!;
      if (!threadId || visited.has(threadId)) continue;
      visited.add(threadId);
      if (depth > 0 && host.store.isConfidentialThread?.(threadId)) continue;
      for (const message of host.store.messagesFor(threadId) ?? []) {
        const card = message?.kind === "options" ? message.card : undefined;
        if (!card?.requestId || card.answered || card.dismissed || card.expired) continue;
        const origin = card.approvalOrigin;
        if (origin?.threadId && origin?.requestId) mirrored.add(`${origin.threadId}:${origin.requestId}`);
        (card.reviewing ? reviewing : open).push({ threadId, message, card, depth });
      }
      if (depth < MAX_DEPTH) {
        for (const child of childThreads(host, agentId, threadId, depth)) {
          if (!visited.has(child)) queue.push({ threadId: child, depth: depth + 1 });
        }
      }
    }
    const notMirrored = (row: PendingApprovalRow) => !mirrored.has(`${row.threadId}:${row.card.requestId}`);
    const byAge = (a: PendingApprovalRow, b: PendingApprovalRow) => String(a.message.at ?? "").localeCompare(String(b.message.at ?? ""));
    return { open: open.filter(notMirrored).sort(byAge), reviewing: reviewing.filter(notMirrored).sort(byAge) };
  }
  return agentPendingApproval;
}
