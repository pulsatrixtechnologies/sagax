// @ts-nocheck
/** noteTurnsCutByShutdown (#1388). Pure move from server/index.ts. */
import { failedTurnTool } from "../../shared/failed-turn.ts";
import { DATA_DIR } from "../config.ts";
import { saveInterruptedTurns } from "../turns/interrupted-turns.ts";
export type Host = Record<string, any>;

export function createNoteTurnsCutByShutdown(getHost: () => Host): any {
function noteTurnsCutByShutdown(final = true): void {
  const host = getHost();
  const runtimeAccounts = (threadId: string) => host.coordinator.continuesAfterRestart(threadId) || host.runtimeHoldsRoot(threadId);
  const cut: InterruptedTurn[] = [];
  for (const { botId, threadId } of host.busyDirectThreads()) {
    if (runtimeAccounts(threadId)) {
      // A person's own turn the runtime holds as a root runs again at the
      // next start under its restart policy (no record here, or it would run
      // twice). Its conversation still says why it stopped, as a direct turn's.
      // A teammate's work turn says so when it resumes, not here.
      if (final && host.runtimeHoldsRoot(threadId)) host.store.appendMessage(threadId, { role: "bot", kind: "activity", tool: { name: "Sagax restarted during this turn; it resumes when Sagax is back", ok: true } });
      continue;
    }
    // A turn held on an approval card is not resumed: the card cannot answer
    // the engine that asked; it ends here with the cut line, as before.
    const held = host.threadWaitsOnPerson(threadId);
    if (host.routines?.isActiveThread(threadId) || held) {
      if (final) host.store.appendMessage(threadId, { role: "bot", kind: "activity", tool: held ? failedTurnTool("turn interrupted — Sagax restarted")
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
  if (!final) return;
  // A room member's turn is a root from its claim; a round cut before any
  // member claimed (in setup) is nobody's to run again, so the room says so.
  for (const group of host.store.groups) {
    for (const threadId of group.dm ? [group.threadId] : host.store.groupTasks(group.id).map((task) => task.threadId)) {
      if (!host.groupThreadIsWorking(group.id, threadId) || runtimeAccounts(threadId)) continue;
      const speaker = host.groupSpeakers.get(threadId);
      host.store.appendMessage(threadId, { role: "bot", kind: "activity", ...(speaker ? { from: speaker } : {}), tool: failedTurnTool("turn interrupted — Sagax restarted") });
    }
  }
}
  return noteTurnsCutByShutdown;
}
