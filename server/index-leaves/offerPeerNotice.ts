// @ts-nocheck
/** offerPeerNotice (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createOfferPeerNotice(getHost: () => Host): any {
function offerPeerNotice(child: HandoffView, parent: HandoffView | undefined) {
  const host = getHost();

  const receiver = host.store.bot(child.botId);
  if (!receiver || child.groupId) return;
  const sender = parent ? host.store.bot(parent.botId) : undefined;
  if (sender?.id === receiver.id) return;
  const event = peerNoticeEvent({
    receiverId: receiver.id, noticeId: child.id, threadId: child.threadId,
    title: host.store.taskByThread(receiver.id, child.threadId)?.title ?? "Teammate message",
    status: child.status, text: host.redactSecretsInText(child.text), result: host.redactSecretsInText(child.result ?? ""),
    ...(sender ? { senderId: sender.id, senderName: sender.name } : {}),
    hops: host.peerNoticeHops.get(child.threadId) ?? 1,
  });
  // 2026-11-02 (second pass): a notice no wake runs for (proactive off, the
  // hop limit, an expired sign-in) used to end there, unseen. The person
  // now reads it in the receiver's own conversation.
  const verdict = host.offerProactive(event);
  if (verdict && peerNoticeDropped(verdict) && event.peer) host.surfacePeerNotice(receiver.id, event.peer);

}
  return offerPeerNotice;
}
