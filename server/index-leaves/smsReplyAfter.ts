// @ts-nocheck
/** smsReplyAfter (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createSmsReplyAfter(getHost: () => Host): any {
// `since` (#4046): only words finished after that time (a steered line's
// receipt), never a narration the running model call was already writing.
// A relayed card (`attention`) is never the bot's answer.
function smsReplyAfter(threadId: string, messageId: string, since?: number) {
  const host = getHost();

  const messages = host.store.messagesFor(threadId);
  let index = messageId ? messages.findIndex((message) => message.id === messageId) : -1;
  if (index < 0) index = messages.map((message) => message.role).lastIndexOf("user");
  return messages.slice(index + 1)
    .filter((message) => message.role === "bot" && message.kind === "text" && !message.from && !message.attention && (since === undefined || message.at > since) && typeof message.text === "string" && message.text.trim())
    .map((message) => message.text!.trim())
    .join("\n\n");

}
  return smsReplyAfter;
}
