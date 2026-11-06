// @ts-nocheck
/** dispatchSecretResume (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createDispatchSecretResume(getHost: () => Host): any {
function dispatchSecretResume(entry: SecretResumeEntry) {
  const host = getHost();

  const owner = host.connectorThread(entry.botId, entry.threadId);
  if (!owner) return;
  const prompt = entry.prompt ?? (
    entry.outcome === "provided"
      ? `Sagax credential update: the user securely provided ${entry.label}. Continue the task that paused for it. You do not receive the secret and must not ask them to paste it into chat.`
      : `Sagax credential update: the user declined to provide ${entry.label}. Continue without it if possible, or briefly explain the limitation. Do not ask them to paste it into chat.`);
  if (!host.canAdmitDirectTurn(entry.botId, entry.threadId)) {
    host.pendingSecretResumes.set(`${entry.threadId}:${entry.messageId}`, entry);
    return;
  }
  if (owner.group) {
    const groupId = owner.group.id;
    const operation = host.beginGroupTurnOperation(groupId, entry.threadId, [entry.botId]);
    const previous = host.groupQueues.get(entry.threadId) ?? Promise.resolve();
    const next = previous.then(async () => {
      if (operation.cancelled) return;
      const current = host.connectorThread(entry.botId, entry.threadId);
      if (!current?.group) return;
      if (current.bot.busy) {
        host.pendingSecretResumes.set(`${entry.threadId}:${entry.messageId}`, entry);
        return;
      }
      await host.runGroupMemberTurn(
        current.group.id,
        entry.threadId,
        entry.botId,
        0,
        new Set(),
        prompt,
        (message) => host.markSecretResumeFailed(entry.threadId, entry.messageId, message),
        () => operation.cancelled,
        () => host.groupProviderHandshakeStarted(operation),
        () => host.groupProviderHandshakeSettled(operation),
        undefined,
        undefined,
        undefined,
        0,
        entry.messageId,
      );
    });
    const tracked = next.finally(() => host.finishGroupTurnOperation(groupId, operation));
    host.groupQueues.set(
      entry.threadId,
      tracked.catch((error) => {
        host.markSecretResumeFailed(
          entry.threadId,
          entry.messageId,
          error instanceof Error ? error.message : String(error),
        );
      }),
    );
    return;
  }
  void host.startTurn(entry.botId, prompt, {
    threadId: entry.threadId,
    cardContinuation: true,
    onDispatchError: (message) => host.markSecretResumeFailed(entry.threadId, entry.messageId, message)
  }).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    if (isTurnAdmissionBlocked(error)) {
      host.pendingSecretResumes.set(`${entry.threadId}:${entry.messageId}`, entry);
    } else {
      host.markSecretResumeFailed(entry.threadId, entry.messageId, message);
    }
  });

}
  return dispatchSecretResume;
}
