// @ts-nocheck
/** requestEmailDraftSend (#1388). Pure move from server/index.ts. */
import { emailDraftKey, emailDraftsEnabled, emailSendSummary, normalizeDraftForSend } from "../../shared/email-draft-send.ts";
export type Host = Record<string, any>;

export function createRequestEmailDraftSend(getHost: () => Host): any {
async function requestEmailDraftSend(auth: RequestAuth, threadId: string, body: Record<string, unknown>): Promise<{ status: number; body: Record<string, unknown> }> {
  const host = getHost();
  const { DATA_DIR, appendDecision, store } = host;
  const target = host.emailDraftBot(auth, threadId, body.botId);
  if (!("bot" in target)) return target;
  const { bot } = target;
  if (!emailDraftsEnabled(bot)) {
    return { status: 409, body: { error: "Email drafts are turned off for this bot.", code: "email_drafts_off" } };
  }
  const normalized = normalizeDraftForSend(body.draft);
  if ("problems" in normalized) return { status: 400, body: { error: normalized.problems.join("; "), code: "invalid_draft" } };
  // a room's people read its cards and messages: a Bcc there is not blind
  if (normalized.draft.bcc.length && host.store.groupByThread(threadId)) {
    return { status: 400, body: { error: "Bcc is not available in a room: everyone in it would see the hidden recipients.", code: "bcc_in_room" } };
  }
  const connectors = host.emailConnectorsFor(bot, host.languageOfRequest(auth));
  const wanted = body.connector && typeof body.connector === "object" ? body.connector as { kind?: unknown; id?: unknown } : undefined;
  const connector = wanted
    ? connectors.find((candidate) => candidate.kind === wanted.kind && (candidate.id ?? null) === (typeof wanted.id === "string" ? wanted.id : null))
    : connectors[0];
  if (!connector) {
    return { status: 409, body: { error: "No mail connector can send this: connect Microsoft 365, Outlook or Gmail to this bot, or set up the server's mail.", code: "no_mail_connector" } };
  }
  const draftKey = typeof body.draftKey === "string" && /^[\w-]{1,64}$/.test(body.draftKey) ? body.draftKey : emailDraftKey(normalized.draft);
  // a retry of the very same draft skips who already received it
  const sameDraft = JSON.stringify(normalized.draft);
  const earlier = [...store.messagesFor(threadId)].reverse()
    .find((row) => row.card?.emailSendRequest?.draftKey === draftKey && JSON.stringify(row.card.emailSendRequest.draft) === sameDraft)?.card?.emailSendRequest;
  const sentTo = earlier?.status === "failed" && earlier.sentTo?.length && earlier.connector.kind === connector.kind ? earlier.sentTo : undefined;
  const request = { ...emailSendCard({ draft: normalized.draft, draftKey, connector, by: host.actorPrincipalId(auth) }), ...(sentTo ? { sentTo } : {}) };
  const summary = emailSendSummary(normalized.draft, connector, host.languageOfRequest(auth));
  // the card's arguments never list Bcc addresses, only how many
  const toolInput = JSON.stringify({
    to: normalized.draft.to, cc: normalized.draft.cc,
    ...(normalized.draft.bcc.length ? { bccCount: normalized.draft.bcc.length } : {}),
    subject: normalized.draft.subject, connector: connector.label,
    ...(sentTo ? { alreadySentTo: sentTo } : {})
  }, null, 2);
  // the email draft card: its send is then answered in request.opened
  // (emailDraftApproved, and Full before the outbound guard); full-access: send
  const message = host.store.appendMessage(threadId, {
    role: "bot",
    kind: "options",
    from: { botId: bot.id, name: bot.name, color: bot.color },
    card: {
      title: "Approval needed",
      subtitle: summary,
      options: ["Allow", "Deny"],
      requestId: request.id,
      // full-access: send
      requestType: "permission",
      tool: "send_email_draft",
      toolInput,
      plain: { title: summary, line: summary, risk: "write" },
      emailSendRequest: request
    }
  });
  appendDecision(DATA_DIR, {
    threadId, requestId: request.id, botId: bot.id, botName: bot.name,
    tool: "send_email_draft", summary, decision: "card-shown", source: "email-draft-approval"
  });
  return { status: 201, body: { requestId: request.id, messageId: message.id, status: request.status, connector } };

}
  return requestEmailDraftSend;
}
