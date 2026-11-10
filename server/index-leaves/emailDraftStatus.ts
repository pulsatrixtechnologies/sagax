// @ts-nocheck
/** emailDraftStatus (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createEmailDraftStatus(getHost: () => Host): any {
function emailDraftStatus(auth: RequestAuth, threadId: string, draftKey: string): { status: number; body: Record<string, unknown> } {
  const host = getHost();
  const { store } = host;

  const owner = host.store.botByThread(threadId);
  const group = host.store.groupByThread(threadId);
  if (!owner && !group) return { status: 404, body: { error: "no such conversation" } };
  const message = [...store.messagesFor(threadId)].reverse().find((row) => row.card?.emailSendRequest?.draftKey === draftKey);
  // the same check as asking to send: the conversation, then the bot's owner
  const target = host.emailDraftBot(auth, threadId, message?.from?.botId ?? owner?.id);
  if (!("bot" in target)) return target.status === 400 ? { status: 404, body: { error: "no such conversation" } } : target;
  const request = message?.card?.emailSendRequest;
  if (!message || !request) return { status: 200, body: { send: null } };
  let status = request.status;
  let error = request.error;
  if (message.card?.answered === "deny" && status === "pending") status = "denied";
  if (status === "handed-off" && !host.emailSendPasses.waiting(threadId, request.id)) {
    status = "failed";
    error = host.languageOfRequest(auth).toLowerCase().startsWith("fr")
      ? "Le robot n'a pas envoyé ce courriel à temps. Réessaie."
      : "The bot did not send this email in time. Try again.";
  }
  return { status: 200, body: { send: { requestId: request.id, status, ...(error ? { error } : {}), connector: request.connector, at: request.at } } };

}
  return emailDraftStatus;
}
