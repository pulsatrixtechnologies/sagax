// @ts-nocheck
/** continueComputerSelection (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createContinueComputerSelection(getHost: () => Host): any {
function continueComputerSelection(threadId: string, generation: string | undefined, succeeded: boolean) {
  const host = getHost();
  const { hasQueuedSteeredMessages } = host;

  const selection = host.computerSelectionTurns.get(threadId);
  if (!selection || selection.generation !== generation) return false;
  if (!succeeded || !selection.selected || hasQueuedSteeredMessages(selection.botId, threadId)) {
    host.computerSelectionTurns.delete(threadId);
    return false; // Let ordinary settlement drain the person's newer request.
  }
  const surface = selection.selected;
  setImmediate(() => {
    // Stop, deletion, a new user send, or any replacement generation wins.
    if (host.computerSelectionTurns.get(threadId) !== selection || host.directTurnGenerationByThread.get(threadId) !== generation) return;
    host.computerSelectionTurns.delete(threadId);
    const bot = host.store.projectBotForTask(selection.botId, threadId);
    if (!bot || bot.computer === "off" || host.threadBusy(bot.id, threadId)) return;
    if (host.store.taskByThread(bot.id, threadId)?.surface !== selection.previousSurface) return;
    if (hasQueuedSteeredMessages(bot.id, threadId)) { host.drainQueuedSends(); return; }
    if (host.store.activePath(threadId).findLast(message => message.role === "user" && message.kind === "text")?.id !== selection.source.id) return;
    // The model picked this surface through select_computer; the person
    // never chose it. It holds this request only, and is never recorded.
    host.computerSelectionMoves.set(threadId, surface);
    const text = `The computer selection is now ${host.surfaceLabel(surface)}. Continue the user's original request using the tools mounted for this turn; verify the result before claiming success.\n\n${selection.text}`;
    // #2764: the same request goes on: the turn ceiling keeps what it spent.
    host.directTurnBudget?.carryNext(threadId);
    void host.startTurn(bot.id, text, { threadId, userMessage: selection.source, computerSelectionContinuation: true, computerMovesSoFar: selection.moves, speaker: host.turnSpeakers.get(threadId), dataContext: selection.dataContext }).catch(error => {
      if (host.store.taskByThread(bot.id, threadId)) host.store.appendMessage(threadId, { role: "bot", kind: "activity",
        tool: { name: `Could not continue on ${host.surfaceLabel(surface)}: ${error instanceof Error ? error.message : String(error)}`, ok: false } });
    });
  });
  return true;

}
  return continueComputerSelection;
}
