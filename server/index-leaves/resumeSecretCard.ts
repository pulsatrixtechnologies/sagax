// @ts-nocheck
/** resumeSecretCard (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createResumeSecretCard(getHost: () => Host): any {
function resumeSecretCard(botId: string, threadId: string, messageId: string, outcome: SecretResumeEntry["outcome"], prompt?: string) {
  const host = getHost();

  const message = host.secretMessage(botId, threadId, messageId);
  if (!message?.secret) return false;
  if (message.secret.resumed) return true;
  host.store.patchMessage(threadId, message.id, {
    secret: {
      ...message.secret,
      provided: outcome === "provided" ? true : message.secret.provided,
      dismissed: outcome === "dismissed" ? true : message.secret.dismissed,
      resumed: true,
      error: undefined
    }
  });
  host.dispatchSecretResume({ botId, threadId, messageId, label: message.secret.label, outcome, ...(prompt ? { prompt } : {}) });
  return true;

}
  return resumeSecretCard;
}
