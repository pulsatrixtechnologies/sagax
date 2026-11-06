// @ts-nocheck
/** resolveAndSendEmailDraft (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createResolveAndSendEmailDraft(getHost: () => Host): any {
async function resolveAndSendEmailDraft(res: ServerResponse, auth: RequestAuth, threadId: string, requestId: string, behavior: string) {
  const host = getHost();
  const { DATA_DIR, appendDecision, json } = host;
  if (!requestId.startsWith(EMAIL_SEND_REQUEST_PREFIX)) return false;
  const message = host.emailSendMessage(threadId, requestId);
  const card = message?.card;
  if (!message || !card?.emailSendRequest) return false;
  if (card.answered || card.dismissed || card.expired) {
    json(res, 409, { error: "The request is no longer open." });
    return true;
  }
  const request = card.emailSendRequest;
  const botId = message.from?.botId ?? host.store.botByThread(threadId)?.id;
  const bot = botId ? host.store.bot(botId) : undefined;
  const actor = host.cwActionActor(auth);
  const decided = (decision: "user-approved" | "user-denied") => appendDecision(DATA_DIR, {
    threadId, requestId, ...(bot ? { botId: bot.id, botName: bot.name } : {}),
    tool: "send_email_draft", summary: card.subtitle, decision, source: "user"
  });
  if (behavior !== "allow" || !actor) {
    host.store.patchMessage(threadId, message.id, { card: { ...card, answered: "deny", emailSendRequest: { ...request, status: "denied" } } });
    decided("user-denied");
    json(res, 200, { ok: true, outcome: "rejected" });
    return true;
  }
  if (!bot) {
    json(res, 409, { error: "This bot is no longer here." });
    return true;
  }
  decided("user-approved");
  if (request.connector.kind === "smtp") {
    host.store.patchMessage(threadId, message.id, { card: { ...card, answered: "allow", emailSendRequest: { ...request, status: "sending" } } });
    const sent = await host.sendWithMailer(host.mailer(), request.draft, request.sentTo ?? []);
    host.patchEmailSend(threadId, requestId, sent.ok
      ? { status: "sent", sentTo: sent.sentTo }
      : { status: "failed", error: sent.error, ...(sent.sentTo.length ? { sentTo: sent.sentTo } : {}) });
    appendDecision(DATA_DIR, {
      threadId, requestId, botId: bot.id, botName: bot.name, tool: "send_email_draft", summary: card.subtitle,
      decision: sent.ok ? "auto-approved" : "auto-denied", source: "email-draft-approval"
    });
    json(res, 200, { ok: true, outcome: "allowed-once", send: sent.ok ? "sent" : "failed" });
    return true;
  }
  host.store.patchMessage(threadId, message.id, { card: { ...card, answered: "allow", emailSendRequest: { ...request, status: "handed-off" } } });
  host.emailSendPasses.grant(threadId, bot.id, requestId, request.draft, request.connector);
  const text = emailSendInstruction(request.draft, request.connector, host.languageOfRequest(auth));
  const group = host.store.groupByThread(threadId);
  const asked = await host.performBotActRoute(actor, group
    ? { kind: "route", method: "POST", path: `/api/groups/${group.id}/messages`, body: { text: `@${bot.name} ${text}`, threadId } }
    : { kind: "route", method: "POST", path: `/api/bots/${bot.id}/messages`, body: { text, threadId } }, 8000, group ? {} : { continuation: threadId });
  if (asked.status >= 300) {
    host.emailSendPasses.revoke(threadId, requestId);
    host.patchEmailSend(threadId, requestId, {
      status: "failed",
      error: host.languageOfRequest(auth).toLowerCase().startsWith("fr") ? "Le robot n'a pas pu recevoir la demande d'envoi. Réessayez." : "The bot could not be asked to send it. Try again."
    });
    json(res, 502, { error: "The bot could not be asked to send this email. Try again." });
    return true;
  }
  json(res, 200, { ok: true, outcome: "allowed-once", send: "handed-off" });
  return true;

}
  return resolveAndSendEmailDraft;
}
