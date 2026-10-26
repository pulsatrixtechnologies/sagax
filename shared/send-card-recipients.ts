// Who "Toujours permettre" on a send card adds to the bot's allowed
// recipients (parité X4/A10). The desktop list itself stays in
// AllowedRecipientsRow. A channel, a reply or a recipient that cannot be
// read returns null: the card keeps its other Always allow, if it has one.

import { normalizeEmail, sendRecipients } from "./allowed-recipients.ts";

const PEER_BOT = /^(?:ask_bot|delegate_bot):([\w-]{1,128})$/;

export interface SendCardRecipients {
  tool?: string;
  mcpTool?: string;
  toolInput?: string;
  allowKey?: string;
  emailSendRequest?: { draft: { to: string[]; cc?: string[]; bcc?: string[] } };
}

/** The `email:`, `phone:` and `bot:` keys this card would remember, or null
 * when the send is not a plain message to named people. */
export function recipientKeysForSendCard(card: SendCardRecipients | null | undefined): string[] | null {
  if (!card) return null;
  const draft = card.emailSendRequest?.draft;
  if (draft) {
    const keys: string[] = [];
    for (const raw of [...draft.to, ...(draft.cc ?? []), ...(draft.bcc ?? [])]) {
      const email = normalizeEmail(raw);
      if (!email) return null;
      const key = `email:${email}`;
      if (!keys.includes(key)) keys.push(key);
    }
    return keys.length ? keys : null;
  }
  const tool = card.mcpTool || card.tool;
  if (tool && card.toolInput) {
    const found = sendRecipients(tool, card.toolInput);
    if (found) {
      const keys = [
        ...found.emails.map((email) => `email:${email}`),
        ...found.phones.map((phone) => `phone:${phone}`),
      ];
      return keys.length ? keys : null;
    }
  }
  const peer = card.allowKey ? PEER_BOT.exec(card.allowKey) : null;
  if (!peer) return null;
  if (card.tool && card.tool !== "ask_bot" && card.tool !== "delegate_bot") return null;
  if (card.tool && !card.allowKey!.startsWith(`${card.tool}:`)) return null;
  return [`bot:${peer[1]}`];
}
