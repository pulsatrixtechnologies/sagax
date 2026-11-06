// @ts-nocheck
/** resumeSecretCard (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createResumeSecretCard(getHost: () => Host): any {
function resumeSecretCard(botId: string, threadId: string, messageId: string, outcome: SecretResumeEntry["outcome"], prompt?: string) {
  const host = getHost();

  const message = host.secretMessage(botId, threadId, messageId);
  if (!message?.secret) return false;
  if (message.secret.resumed) return true;
  // Vault login cards carry their own note (routes/credential-vault.ts). Mirror
  // sign-in: mark resumed only when a parked root takes the answer (R4).
  const resumed = host.answerCardNode(threadId, messageId, prompt ?? host.credentialUpdateText(message.secret.label, outcome));
  host.store.patchMessage(threadId, message.id, {
    secret: {
      ...message.secret,
      provided: outcome === "provided" ? true : message.secret.provided,
      dismissed: outcome === "dismissed" ? true : message.secret.dismissed,
      ...(resumed ? { resumed: true, error: undefined } : { error: undefined }),
    }
  });
  return true;

}
  return resumeSecretCard;
}
