// Email drafts sent from their card (shared/email-draft-send.ts has the
// rules): the approval card's fields, the one-shot passes a bot's own mail
// connector uses after the person's Allow, and the server's own send.
//
// A send never starts here without the person's Allow on that card: the
// route only writes the card; `sendWithMailer` and `grant` run from the
// card's Allow (server/index.ts resolveAndSendEmailDraft).

import { randomUUID } from "node:crypto";

import {
  EMAIL_SEND_PASS_MS,
  EMAIL_SEND_REQUEST_PREFIX,
  emailSendCallMatches,
  type EmailConnector,
  type EmailDraftToSend,
  type EmailSendRequestCard,
} from "../../shared/email-draft-send.ts";
import { MailPartialSendError, type Mailer } from "./mailer.ts";
import { redactSecrets } from "../redact.ts";

export function emailSendCard(input: { draft: EmailDraftToSend; draftKey: string; connector: EmailConnector; by: string; now?: number }): EmailSendRequestCard {
  return {
    id: `${EMAIL_SEND_REQUEST_PREFIX}${randomUUID()}`,
    draftKey: input.draftKey,
    draft: input.draft,
    connector: input.connector,
    by: input.by,
    status: "pending",
    at: input.now ?? Date.now(),
  };
}

interface Pass {
  requestId: string;
  /** The bot whose turn may use it, and the connector the person approved. */
  botId: string;
  connector: EmailConnector;
  draft: EmailDraftToSend;
  expires: number;
}

export interface EmailSendPasses {
  grant(threadId: string, botId: string, requestId: string, draft: EmailDraftToSend, connector: EmailConnector): void;
  /** The pass this outbound call uses, removed; null when the call is not the
   * approved draft, from that bot, through that connector. */
  take(threadId: string, botId: string, tool: string, input: string | undefined): { requestId: string } | null;
  /** Whether this request's pass is still waiting (not used, not lapsed). */
  waiting(threadId: string, requestId: string): boolean;
  revoke(threadId: string, requestId: string): void;
}

export function createEmailSendPasses(now: () => number = Date.now): EmailSendPasses {
  const passes = new Map<string, Pass[]>();
  const live = (threadId: string): Pass[] => {
    const kept = (passes.get(threadId) ?? []).filter((pass) => pass.expires > now());
    if (kept.length) passes.set(threadId, kept);
    else passes.delete(threadId);
    return kept;
  };
  return {
    grant(threadId, botId, requestId, draft, connector) {
      passes.set(threadId, [...live(threadId).filter((pass) => pass.requestId !== requestId), { requestId, botId, connector, draft, expires: now() + EMAIL_SEND_PASS_MS }]);
    },
    take(threadId, botId, tool, input) {
      const list = live(threadId);
      const index = list.findIndex((pass) => pass.botId === botId && emailSendCallMatches(pass.draft, tool, input, pass.connector));
      if (index < 0) return null;
      const [pass] = list.splice(index, 1);
      if (list.length) passes.set(threadId, list);
      else passes.delete(threadId);
      return { requestId: pass!.requestId };
    },
    waiting(threadId, requestId) {
      return live(threadId).some((pass) => pass.requestId === requestId);
    },
    revoke(threadId, requestId) {
      const list = live(threadId).filter((pass) => pass.requestId !== requestId);
      if (list.length) passes.set(threadId, list);
      else passes.delete(threadId);
    },
  };
}

/** The draft without the addresses that already received it. A To list
 * left empty takes the first remaining Cc, then Bcc, address. */
export function remainingRecipients(draft: EmailDraftToSend, alreadySent: readonly string[] = []): EmailDraftToSend {
  const sent = new Set(alreadySent.map((address) => address.toLowerCase()));
  const keep = (list: readonly string[]) => list.filter((address) => !sent.has(address.toLowerCase()));
  const next = { ...draft, to: keep(draft.to), cc: keep(draft.cc), bcc: keep(draft.bcc) };
  if (!next.to.length && next.cc.length) next.to = [next.cc.shift()!];
  if (!next.to.length && next.bcc.length) next.to = [next.bcc.shift()!];
  return next;
}

/** The server's own mail sends the draft, skipping who already received it.
 * A refusal comes back readable and without any credential, with the
 * addresses that did receive it on a partial send. */
export async function sendWithMailer(mailer: Mailer | null, draft: EmailDraftToSend, alreadySent: readonly string[] = []): Promise<{ ok: true; sentTo: string[] } | { ok: false; error: string; sentTo: string[] }> {
  const already = [...alreadySent];
  if (!mailer) return { ok: false, error: "The server's mail is not set up (Settings > Email).", sentTo: already };
  const rest = remainingRecipients(draft, alreadySent);
  const everyone = [...rest.to, ...rest.cc, ...rest.bcc];
  if (!everyone.length) return { ok: true, sentTo: already };
  try {
    await mailer.send({
      to: rest.to.join(", "),
      subject: draft.subject,
      text: draft.body,
      ...(rest.cc.length ? { cc: rest.cc } : {}),
      ...(rest.bcc.length ? { bcc: rest.bcc } : {}),
    });
    return { ok: true, sentTo: [...already, ...everyone] };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const partial = error instanceof MailPartialSendError ? error.sent : [];
    return { ok: false, error: String(redactSecrets(message)).slice(0, 400), sentTo: [...already, ...partial] };
  }
}
