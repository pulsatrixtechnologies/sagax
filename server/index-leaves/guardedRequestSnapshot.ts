// @ts-nocheck
/** guardedRequestSnapshot (#1388). Pure move from server/index.ts. */
import { guardedRequestPath, requestNeedsInput } from "../auth/guarded-requests.ts";
export type Host = Record<string, any>;

export function createGuardedRequestSnapshot(getHost: () => Host): any {
function guardedRequestSnapshot(botId: string, threadId: string, sendId: string) {
  const host = getHost();
  const { pendingTeamSetupResumes, requestConflict } = host;
  if (!host.store.taskByThread(botId, threadId)) throw requestConflict("No such conversation for this bot");
  const activeLeafId = host.store.activeLeaf(threadId);
  const messages = guardedRequestPath(host.store.messagesFor(threadId), activeLeafId, sendId);
  const messageId = messages[0].id;
  const owner = host.directRequestOwners.get(threadId);
  const busy = host.threadBusy(botId, threadId);
  const waiting = messages.some(requestNeedsInput) || host.coordinator.activeDirect(threadId) ||
    [...pendingTeamSetupResumes.values()].some(entry => entry.request.threadId === threadId);
  const latestTerminal = messages.findLast(message => message.role === "bot" && message.kind === "text" && message.turnTerminal);
  const latestTurn = messages.findLast(message => message.turnId);
  const latestOutcome = messages.findLast(message => message.turnSucceeded !== undefined);
  // A restart retains proven transcript annotations, not an execution lease.
  // Unproven output or a different live owner always requires the workspace.
  const untracked = messages[0].requestCancelled || (owner && (owner.messageId !== messageId || owner.stopped)) ||
    (busy && !owner) || messages.slice(1).some(message =>
      (message.turnId || (message.role === "bot" && message.kind === "text")) && message.requestMessageId !== messageId) ||
    (!busy && !waiting && (messages[0].requestPending !== false || !latestTerminal?.turnSucceeded || latestTurn?.turnId !== latestTerminal.turnId ||
      latestOutcome?.turnSucceeded !== true || (owner && owner.turnId !== latestTerminal.turnId)));
  const snapshot = {
    messageId, activeLeafId,
    phase: untracked ? "untracked" : waiting ? "waiting" : busy ? "working" : "settled",
    activeTurnId: busy ? owner?.turnId ?? null : null,
    executionId: owner?.generation ?? null,
    messages: messages.map(host.slimMessage)
  };
  if (Buffer.byteLength(JSON.stringify(snapshot), "utf8") > 1024 * 1024) {
    throw Object.assign(new Error("Open this request in the workspace; its transcript exceeds the response limit"), { status: 413 });
  }
  return snapshot;

}
  return guardedRequestSnapshot;
}
