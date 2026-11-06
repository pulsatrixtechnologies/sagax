// @ts-nocheck
/** dispatchComputerResume (#1388). Pure move from server/index.ts. */
import { isTurnAdmissionBlocked } from "../turns/turn-dispatch-guard.ts";
export type Host = Record<string, any>;

export function createDispatchComputerResume(getHost: () => Host): any {
function dispatchComputerResume(entry: ComputerResumeEntry) {
  const host = getHost();

  const owner = host.connectorThread(entry.botId, entry.threadId);
  if (!owner) return;
  const prompt = "Sagax computer update: the computer this conversation waited for is free again. Continue the task that parked waiting for it.";
  if (owner.group) {
    const groupId = owner.group.id;
    const operation = host.beginGroupTurnOperation(groupId, entry.threadId, [entry.botId]);
    const previous = host.groupQueues.get(entry.threadId) ?? Promise.resolve();
    const next = previous.then(async () => {
      if (operation.cancelled) return;
      const current = host.connectorThread(entry.botId, entry.threadId);
      if (!current?.group) return;
      if (current.bot.busy) {
        host.pendingComputerResumes.set(entry.threadId, entry);
        return;
      }
      await host.runGroupMemberTurn(
        current.group.id,
        entry.threadId,
        entry.botId,
        0,
        new Set(),
        prompt,
        (message) => host.markComputerResumeFailed(entry, message),
        () => operation.cancelled,
        () => host.groupProviderHandshakeStarted(operation),
        () => host.groupProviderHandshakeSettled(operation),
      );
    });
    const tracked = next.finally(() => host.finishGroupTurnOperation(groupId, operation));
    host.groupQueues.set(
      entry.threadId,
      tracked.catch((error) => {
        host.markComputerResumeFailed(entry, error instanceof Error ? error.message : String(error));
      }),
    );
    return;
  }
  void host.startTurn(entry.botId, prompt, {
    threadId: entry.threadId,
    cardContinuation: true,
    onDispatchError: (message) => host.markComputerResumeFailed(entry, message)
  }).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    if (isTurnAdmissionBlocked(error)) host.pendingComputerResumes.set(entry.threadId, entry);
    else host.markComputerResumeFailed(entry, message);
  });

}
  return dispatchComputerResume;
}
