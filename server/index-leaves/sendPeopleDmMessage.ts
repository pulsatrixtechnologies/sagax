// @ts-nocheck
/** sendPeopleDmMessage (#1388). Pure move from server/index.ts. */
import { parseSendId } from "../messages/send-idempotency.ts";
export type Host = Record<string, any>;

export function createSendPeopleDmMessage(getHost: () => Host): any {
function sendPeopleDmMessage(group: GroupRecord, auth: RequestAuth, text: string, rawSendId: unknown, rawReplyTo: unknown, rawThreadId?: unknown) {
  const host = getHost();
  const { acceptedSendMatch, channelViewerId, personAvatarUrl, summarize } = host;

  const threadId = host.peopleDmThreadOf(group, rawThreadId);
  const sendId = parseSendId(typeof rawSendId === "string" ? rawSendId : undefined);
  const replyTo = host.resolveReplyTarget(threadId, rawReplyTo);
  if (sendId) {
    const accepted = acceptedSendMatch(host.store.messagesFor(threadId), sendId, text, replyTo?.id);
    if (accepted.kind === "conflict") throw Object.assign(new Error("sendId already belongs to another message"), { status: 409 });
    if (accepted.kind === "match") return { ok: true as const, threadId, message: accepted.message };
  }
  const sender = host.messageSender(auth);
  const message = host.store.appendMessage(threadId, { role: "user", kind: "text", text, replyToId: replyTo?.id, sendId, sender });
  // A new thread is named after its first message, like a bot's; "General"
  // and a thread the person titled keep their name.
  host.store.titleGroupTaskFromFirstMessage(group.id, text, threadId);
  const from = channelViewerId(auth);
  const to = from ? host.otherPerson(group, from) : undefined;
  // unread for the recipient only, on this thread: the sender reading it clears nothing
  host.store.patchGroup(group.id, to ? host.peopleDmThreadUnreadPatch(host.store.group(group.id) ?? group, to, true, threadId) : { unread: true });
  if (to && sender) {
    const avatarUrl = personAvatarUrl(host.principals.byId(from!));
    host.broadcast({ kind: "notify", notification: {
      kind: "message", botId: "", botName: sender.name, threadId, groupId: group.id,
      title: sender.name, body: summarize(text), audience: [to], ...(avatarUrl ? { avatarUrl } : {})
    } satisfies Notification });
  }
  return { ok: true as const, threadId, message };

}
  return sendPeopleDmMessage;
}
