// @ts-nocheck
/** postInputRequest (#1388). Pure move from server/index.ts. */
import { deliverableNotification } from "../notify.ts";
export type Host = Record<string, any>;

export function createPostInputRequest(getHost: () => Host): any {
function postInputRequest(node: HandoffView, question: string, reminder: boolean, restored = false): void {
  const host = getHost();
  // A root parked on the person's own cards (decision 2): the cards
  // already show, and said what they needed when they appeared. Nothing
  // more, also when a restart re-parks it or a reminder comes due.
  if (!node.parentId && node.cards?.length) return;
  const bot = host.store.bot(node.botId);
  if (!bot) return;
  const full = question.trim() || "Your answer is needed to continue.";
  const title = host.store.taskByThread(bot.id, node.threadId)?.title ?? "Teammate work";
  const posted: Array<{ threadId: string; messageId: string }> = [];
  let fresh = 0;
  const postTo = (target: HandoffView | undefined) => {
    if (!target || posted.some((row) => row.threadId === target.threadId)) return;
    // Never into a room (its members may not read the waiting thread) nor a
    // confidential conversation; a room's own work answers in the room.
    if (target.groupId || host.store.isConfidentialThread(target.threadId)) return;
    const group = target.groupId ? host.store.group(target.groupId) : undefined;
    const live = target.groupId ? Boolean(group && host.store.groupTaskByThread(group.id, target.threadId)) : Boolean(host.store.taskByThread(target.botId, target.threadId));
    if (!live) return;
    // A restart re-parks every open question: one whose card the person was
    // already shown stays as it is (a relaunch neither repeats it nor marks
    // unread what they had read) and is only tracked again, so the answer
    // still marks it answered.
    if (restored) {
      const shown = host.newestQuestionCard(target.threadId, node.threadId);
      if (shown && !shown.inputRequest?.answered && shown.tool?.name.endsWith(`: ${full}`)) {
        posted.push({ threadId: target.threadId, messageId: shown.id });
        return;
      }
    }
    fresh++;
    const message = host.store.appendMessage(target.threadId, {
      role: "bot", kind: "activity",
      from: { botId: bot.id, name: bot.name, color: bot.color },
      tool: { name: `${bot.name} ${reminder ? "is still waiting for your answer" : "needs your input"}: ${full}`, ok: true },
      // answered in place only for a bot conversation (a room answers in the room)
      ...(node.groupId ? {} : { inputRequest: { botId: bot.id, threadId: node.threadId, botName: bot.name, title, question: full, ...(reminder ? { reminder: true } : {}) } }),
      ...(node.groupId ? { comm: { groupId: node.groupId, threadId: node.threadId, withBotId: bot.id, withName: bot.name, withColor: bot.color } }
        : { threadRef: { botId: bot.id, threadId: node.threadId, title } })
    });
    if (message?.id) posted.push({ threadId: target.threadId, messageId: message.id });
    if (group) host.store.patchGroup(group.id, { unread: true });
    else host.store.patchTask(target.botId, target.threadId, { unread: true });
  };
  const parent = node.parentId ? host.coordinator.node(node.parentId) : undefined;
  // 2026-11-02: a one-way notice belongs to its receiver (send_to_bot moves
  // ownership), so its question is for the receiver's person: one card in
  // the receiver's own conversation, answered in place. It used to reach
  // only the sender's conversation.
  if (node.oneWay && !node.groupId) {
    const own = host.botMainThread(bot.id) ?? bot.threadId;
    if (own && own !== node.threadId) postTo({ ...node, threadId: own, botId: bot.id, groupId: undefined });
  }
  postTo(parent);
  // The requester's conversation is a bot-to-bot one: the person reads the
  // conversation the work started in.
  if (parent && node.rootId !== parent.id) postTo(host.coordinator.node(node.rootId));
  if (posted.length) host.openInputRequests.set(node.threadId, [...(host.openInputRequests.get(node.threadId) ?? []), ...posted].slice(-10));
  if (host.openInputRequests.size > 2_000) host.openInputRequests.delete(host.openInputRequests.keys().next().value!);
  if (restored && fresh === 0 && posted.length > 0) return;
  if (node.groupId) host.store.patchGroup(node.groupId, { unread: true });
  else host.store.patchTask(bot.id, node.threadId, { unread: true });
  host.notify(deliverableNotification("delegation-settled", bot, node.threadId, full, { avatarUrl: bot.avatarUrl }));
}
  return postInputRequest;
}
