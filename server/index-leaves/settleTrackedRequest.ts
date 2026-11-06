// @ts-nocheck
/** settleTrackedRequest (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createSettleTrackedRequest(getHost: () => Host): any {
function settleTrackedRequest(threadId: string, incoming: ReadonlySet<string> = new Set()) {
  const host = getHost();
  const { pendingTeamSetupResumes } = host;

  const owner = host.directRequestOwners.get(threadId);
  const bot = host.store.botByThread(threadId);
  if (!owner?.messageId || owner.stopped || !bot || host.threadBusy(bot.id, threadId) || host.coordinator.activeDirect(threadId) ||
      [...pendingTeamSetupResumes.values()].some(entry => entry.request.threadId === threadId)) return;
  // A failed coordination root never supplies the promised return, even if
  // its original provider successfully said it had assigned the work.
  if (host.coordinator.all().some(node => !node.parentId && node.threadId === threadId &&
      owner.generations.has(node.id) && node.status !== "completed")) return;
  const path = host.store.activePath(threadId).filter(message => !incoming.has(message.id));
  const source = path.findLast(message => message.role === "user");
  if (source?.id !== owner.messageId || source.requestCancelled || source.requestPending !== true) return;
  const messages = path.slice(path.indexOf(source) + 1);
  const terminal = messages.findLast(message => message.turnTerminal && message.role === "bot" && message.kind === "text");
  if (messages.some(requestNeedsInput) || terminal?.requestMessageId !== source.id || !terminal.turnSucceeded ||
      terminal.turnId !== owner.turnId || messages.findLast(message => message.turnId)?.turnId !== terminal.turnId ||
      messages.findLast(message => message.turnSucceeded !== undefined)?.turnSucceeded !== true) return;
  host.store.patchMessage(threadId, source.id, { requestPending: false });
  host.savedSteps.requestSettled({
    botId: bot.id, threadId, request: source, reply: terminal, after: messages,
    generations: owner.generations, automated: !personRequest(owner)
  });

}
  return settleTrackedRequest;
}
