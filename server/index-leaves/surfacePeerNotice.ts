// @ts-nocheck
/** surfacePeerNotice (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createSurfacePeerNotice(getHost: () => Host): any {
function surfacePeerNotice(receiverId: string, peer: PeerNoticeFacts) {
  const host = getHost();
  const { deliverableNotification } = host;

  try {
    const receiver = host.store.bot(receiverId);
    if (!receiver || receiver.hidden) return;
    const own = host.botMainThread(receiver.id) ?? receiver.threadId;
    if (!own || own === peer.threadId || !host.store.taskByThread(receiver.id, own) || host.store.isConfidentialThread(own)) return;
    const task = host.store.taskByThread(receiver.id, peer.threadId);
    if (!task) return;
    // once per notice thread, a replay never adds another
    if (host.store.messagesFor(own).some((message) => message.threadRef?.threadId === peer.threadId && message.tool?.name.startsWith("Message from ") === true)) return;
    const sender = peer.senderId ? host.store.bot(peer.senderId) : undefined;
    const from = sender?.name ?? peer.senderName ?? "A teammate";
    const status = peer.status === "completed" ? "" : ` (${peer.status})`;
    host.store.appendMessage(own, {
      role: "bot", kind: "activity",
      ...(sender ? { from: { botId: sender.id, name: sender.name, color: sender.color } } : {}),
      tool: { name: `Message from ${from}: #${task.title}${status}`, ok: peer.status === "completed" || peer.status === "needs_input" },
      threadRef: { botId: receiver.id, threadId: peer.threadId, title: task.title }
    });
    host.store.patchTask(receiver.id, own, { unread: true });
    host.notify(deliverableNotification("delegation-settled", receiver, own, `Message from ${from}: ${task.title}`, { avatarUrl: receiver.avatarUrl }));
  } catch (error) {
    console.warn(`[proactive] peer notice could not be shown: ${error instanceof Error ? error.name : "error"}`);
  }

}
  return surfacePeerNotice;
}
