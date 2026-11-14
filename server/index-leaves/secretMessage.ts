// @ts-nocheck
/** secretMessage (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createSecretMessage(getHost: () => Host): any {
function secretMessage(botId: string, threadId: string, messageId: string) {
  const host = getHost();

  const owner = host.connectorThread(botId, threadId);
  if (!owner) return null;
  // A credential card is actionable only while it is visible on the chosen
  // conversation branch. In a channel, the sender attribution is also the
  // durable owner: any member may share the thread, but only the bot that
  // requested this credential may bind it into HPKE AAD or resume its turn.
  const message = host.store.activePath(threadId).find((candidate) => candidate.id === messageId);
  if (owner.group && message?.from?.botId !== botId) return null;
  // #4185: a product key card is its own kind (shared/credential-request.ts)
  return (message?.kind === "secret" || message?.kind === "productKey") && message.secret ? message : null;

}
  return secretMessage;
}
