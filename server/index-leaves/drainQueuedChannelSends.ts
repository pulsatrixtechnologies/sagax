// @ts-nocheck
/** drainQueuedChannelSends (#1388). Pure move from server/index.ts. */
import { drainChannelMessages } from "../rooms/channel-queue.ts";
export type Host = Record<string, any>;

export function createDrainQueuedChannelSends(getHost: () => Host): any {
function drainQueuedChannelSends() {
  const host = getHost();

  if (!host.followupsReady) return;
  drainChannelMessages(
    (groupId, threadId) => host.groupThreadIsWorking(groupId, threadId),
    ({ groupId, threadId, items }) => {
      const group = host.store.group(groupId);
      const ownsThread = group?.dm
        ? group.threadId === threadId
        : Boolean(group && host.store.groupTaskByThread(group.id, threadId));
      if (!group || !ownsThread) return;
      // The burst runs as ONE room turn: the joined text routes responders
      // and titles the task, while every queued line still lands under its
      // own queueId (chips and sendId receipts stay per-item).
      const head = items[0]!;
      const last = items[items.length - 1]!;
      const joined = items.map((item) => item.text).join("\n\n");
      try {
        host.startGroupTurn(groupId, joined, host.resolveReplyTarget(threadId, last.replyToId), last.sendId, last.mode, last.id, {
          threadId,
          sender: head.sender,
          trigger: host.queuedTurnTrigger({ trigger: head.trigger, sender: head.sender }),
          queuedGroup: items
        });
      } catch (error) {
        for (const item of items) {
          if (!host.store.messagesFor(threadId).some((message) => message.queueId === item.id && message.role === "user")) {
            host.store.appendMessage(threadId, { role: "user", kind: "text", text: item.text, replyToId: item.replyToId, sendId: item.sendId, channelMode: item.mode, queueId: item.id, via: item.via, sender: item.sender });
          }
        }
        host.store.appendMessage(threadId, {
          role: "bot",
          kind: "activity",
          tool: host.failedTurnTool(`queued channel message could not start — ${error instanceof Error ? error.message : String(error)}`)
        });
      }
      // A message with no eligible responder creates no operation. Continue
      // draining instead of leaving later user messages behind it forever.
      queueMicrotask(drainQueuedChannelSends);
      return host.groupQueues.get(threadId);
    },
  );

}
  return drainQueuedChannelSends;
}
