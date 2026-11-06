// @ts-nocheck
/** dispatchTeamSetupResume (#1388). Pure move from server/index.ts. */
import { isTurnAdmissionBlocked } from "../turns/turn-dispatch-guard.ts";
import { requestSourceForCard } from "../auth/guarded-requests.ts";
import { redactSecretsInText } from "../redact.ts";
export type Host = Record<string, any>;

export function createDispatchTeamSetupResume(getHost: () => Host): any {
function dispatchTeamSetupResume(entry: TeamSetupResumeEntry) {
  const host = getHost();

  const { request, messageId } = entry;
  const cancelled = () => entry.generation !== (host.teamSetupResumeGenerations.get(request.threadId) ?? 0);
  if (cancelled()) return;
  const owner = host.connectorThread(request.botId, request.threadId);
  const message = host.store.messagesFor(request.threadId).find((item) => item.id === messageId);
  if (!owner || !message?.card?.teamSetupRequest?.result) return;
  if (!host.canAdmitDirectTurn(request.botId, request.threadId)) {
    host.pendingTeamSetupResumes.set(request.requestId, entry);
    return;
  }
  const notNow = request.suggestion && request.result?.state === "denied"
    ? " The user chose Not now for this suggested specialist. Do not suggest another specialist in this conversation unless they ask for one." : "";
  const prompt = `Sagax team setup decision ${request.requestId}: ${JSON.stringify(request.result)}. Report this exact result and continue the user's already requested work. Do not ask for confirmation again or repeat this setup/deletion. A denied or cancelled operation did not authorize any substitute action. Each changed bot's model applies to all its threads.${notNow}`;
  const failed = (error: string) => {
    if (cancelled()) return;
    const current = host.store.messagesFor(request.threadId).find((item) => item.id === messageId);
    if (current?.card) host.store.patchMessage(request.threadId, messageId, { card: { ...current.card, held: `The decision was recorded, but the Primary Bot could not continue: ${redactSecretsInText(error).slice(0, 300)}` } });
  };
  if (owner.group) {
    const groupId = owner.group.id;
    const operation = host.beginGroupTurnOperation(groupId, request.threadId, [request.botId]);
    const previous = host.groupQueues.get(request.threadId) ?? Promise.resolve();
    const next = previous.then(async () => {
      if (operation.cancelled || cancelled()) return;
      const current = host.connectorThread(request.botId, request.threadId);
      if (!current?.group) return;
      if (current.bot.busy) { host.pendingTeamSetupResumes.set(request.requestId, entry); return; }
      await host.runGroupMemberTurn(groupId, request.threadId, request.botId, 0, new Set(), prompt, failed,
        () => operation.cancelled, () => host.groupProviderHandshakeStarted(operation), () => host.groupProviderHandshakeSettled(operation),
        undefined, undefined, undefined, 0, messageId);
    });
    host.groupQueues.set(request.threadId, next.finally(() => host.finishGroupTurnOperation(groupId, operation)).catch((error) => failed(error instanceof Error ? error.message : String(error))));
    return;
  }
  void host.startTurn(request.botId, prompt, { threadId: request.threadId, cardContinuation: true,
    requestMessageId: requestSourceForCard(host.store.messagesFor(request.threadId), messageId), onDispatchError: failed }).catch((error) => {
    if (cancelled()) return;
    if (isTurnAdmissionBlocked(error)) host.pendingTeamSetupResumes.set(request.requestId, entry);
    else failed(error instanceof Error ? error.message : String(error));
  });

}
  return dispatchTeamSetupResume;
}
