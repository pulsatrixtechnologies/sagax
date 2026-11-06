// @ts-nocheck
/** resumeHeldSteersAfterCrash (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createResumeHeldSteersAfterCrash(getHost: () => Host): any {
function resumeHeldSteersAfterCrash(alreadyResumed: ReadonlySet<string>) {
  const host = getHost();
  const { DATA_DIR } = host;

  let remaining: Map<string, ReturnType<typeof takeHeldSteersForThread>>;
  try { remaining = takeRemainingHeldSteers(DATA_DIR); }
  catch (error) {
    console.warn(`held-steers: could not take remaining after crash: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  for (const [threadId, held] of remaining) {
    if (alreadyResumed.has(threadId) || held.length === 0) continue;
    const botId = held[0]!.botId;
    if (!host.store.taskByThread(botId, threadId) || host.threadBusy(botId, threadId)) continue;
    // The steered rows must still be in the transcript; otherwise a corrupt
    // journal would invent a follow-up for words nobody sent.
    const path = host.store.activePath(threadId);
    if (!held.every((row) => path.some((message) => message.id === row.messageId))) continue;
    const prompt = joinHeldSteerTexts(held);
    if (!prompt.trim()) continue;
    host.store.appendMessage(threadId, { role: "bot", kind: "activity", tool: { name: "Continuing messages sent before the restart", ok: true } });
    // cardContinuation: the held rows are already in the transcript; this turn
    // answers them once without appending another user line (same shape as a
    // cut-turn resume that carries held words).
    void host.startTurn(botId, prompt, {
      threadId,
      cardContinuation: true,
      excludeMessageIds: held.map((row) => row.messageId)
    }).catch((error) => {
      if (!host.store.taskByThread(botId, threadId)) return;
      host.store.appendMessage(threadId, {
        role: "bot", kind: "activity",
        tool: host.failedTurnTool(`messages sent before the restart could not continue: ${error instanceof Error ? error.message : String(error)}`)
      });
    });
  }

}
  return resumeHeldSteersAfterCrash;
}
