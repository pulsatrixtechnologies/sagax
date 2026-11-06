// @ts-nocheck
/** currentSecretState (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createCurrentSecretState(getHost: () => Host): any {
function currentSecretState(botId: string, threadId: string, messageId: string) {
  const host = getHost();

  const message = host.secretMessage(botId, threadId, messageId);
  if (!message?.secret) return null;
  return {
    provided: message.secret.provided === true,
    resumed: message.secret.resumed === true
  };

}
  return currentSecretState;
}
