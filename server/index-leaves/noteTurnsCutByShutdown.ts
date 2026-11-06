// @ts-nocheck
/** noteTurnsCutByShutdown (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createNoteTurnsCutByShutdown(getHost: () => Host): any {
function noteTurnsCutByShutdown(final = true) {
  const host = getHost();
  const { DATA_DIR } = host;

  const cut: InterruptedTurn[] = [];
  for (const { botId, threadId } of host.busyDirectThreads()) {
    if (host.coordinator.continuesAfterRestart(threadId)) continue;
    // A turn held on an approval card is not resumed: the card cannot answer
    // the engine that asked; it ends here with the cut line, as before.
    const held = host.threadWaitsOnPerson(threadId);
    if (host.routines?.isActiveThread(threadId) || held) {
      if (final) host.store.appendMessage(threadId, { role: "bot", kind: "activity", tool: held ? host.failedTurnTool("turn interrupted — Sagax restarted")
        : { name: "Sagax restarted during this run; it resumes when Sagax is back", ok: true } });
      continue;
    }
    const speaker = host.turnSpeakers.get(threadId);
    cut.push({ botId, threadId, at: Date.now(), ...(speaker ? { speaker: { ...speaker } } : {}) });
    if (final) host.store.appendMessage(threadId, { role: "bot", kind: "activity", tool: { name: "Sagax restarted during this turn; it resumes when Sagax is back", ok: true } });
  }
  try {
    saveInterruptedTurns(DATA_DIR, cut);
  } catch (error) {
    console.error(`shutdown: the cut turns could not be written down: ${error instanceof Error ? error.message : String(error)}`);
  }

}
  return noteTurnsCutByShutdown;
}
