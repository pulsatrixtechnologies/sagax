// @ts-nocheck
/** runtimeDelegationStatus (#1388). Pure move from server/index.ts. */
import { peerStatus } from "../peers/peer-roster.ts";
import { summarizeDelegatedActivity } from "../peers/delegation-receipts.ts";
export type Host = Record<string, any>;

export function createRuntimeDelegationStatus(getHost: () => Host): any {
async function runtimeDelegationStatus(taskId: string, from: BotRecord, fromThreadId: string, deadline: number) {
  const host = getHost();
  const { canReachPeer } = host;

  for (;;) {
    const node = host.coordinator.node(taskId);
    const parent = node?.parentId ? host.coordinator.node(node.parentId) : undefined;
    if (!node || !parent) return [404, { error: "unknown task id" }];
    if (parent.threadId !== fromThreadId || parent.groupId) return [403, { error: "that task belongs to a different conversation" }];
    const target = host.store.bot(node.botId);
    const sender = host.store.bot(from.id);
    if (!sender || (target && !canReachPeer(sender, target))) return [403, { error: "Result withheld: team access changed while the teammate was working" }];
    const toBotName = target?.name ?? "Teammate";
    if (["completed", "failed", "cancelled"].includes(node.status)) {
      const status: DelegationReceipt["status"] = node.status === "completed" ? "done" : node.status === "cancelled" ? "cancelled" : "failed";
      return [200, { status, toBotName, result: node.result }];
    }
    // A person's card cannot advance while this caller waits. Preserve the
    // legacy poll's immediate answer for runtime work too.
    const awaitingPerson = node.status === "queued" ? undefined : host.openPersonCard(node.threadId);
    if (Date.now() >= deadline || awaitingPerson) {
      return [200, node.status === "queued"
        ? { status: "queued", toBotName, ...(target ? { targetStatus: peerStatus(target.activity, target.busy) } : {}) }
        : { status: "running", toBotName, elapsedMs: Math.max(0, Date.now() - (node.startedAt ?? node.createdAt)),
          recentActivity: summarizeDelegatedActivity(host.store.messagesFor(node.threadId), node.startedAt ?? node.createdAt),
          ...(awaitingPerson ? { awaitingPerson: {
            ...awaitingPerson,
            threadTitle: host.store.taskByThread(node.botId, node.threadId)?.title,
          } } : {}) }];
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }

}
  return runtimeDelegationStatus;
}
