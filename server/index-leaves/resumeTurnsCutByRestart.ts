// @ts-nocheck
/** resumeTurnsCutByRestart (#1388). Pure move from server/index.ts. */
import { failedTurnTool } from "../../shared/failed-turn.ts";
import { TURN_CUT_BY_RESTART, TURN_RESUME_FAILED_PREFIX } from "../../shared/restart-words.ts";
import { DATA_DIR } from "../config.ts";
import { ROUTINE_RESTARTED, ROUTINE_RESUME_PROMPT } from "../routines/routines.ts";
import { migrateLegacyHeldSteers, takeHeldSteersForThread, resumePromptWithHeld } from "../turns/held-steers.ts";
import { RUNTIME_RESUME_GRACE_MS, runtimeResumeVerdict, takeInterruptedTurns, TURN_NOT_RESUMED, TURN_NOT_RESUMED_NEWER, TURN_RESUME_PROMPT } from "../turns/interrupted-turns.ts";
export type Host = Record<string, any>;

export function createResumeTurnsCutByRestart(getHost: () => Host): any {
function resumeTurnsCutByRestart(): void {
  const host = getHost();
  // Pre-at-rest held journal (DATA_DIR/held-steers.json) → per-thread sealed files.
  try { migrateLegacyHeldSteers(DATA_DIR); }
  catch (error) { console.warn(`held-steers: legacy migrate failed: ${error instanceof Error ? error.message : String(error)}`); }
  for (const run of host.routines?.takeRestartResumes() ?? []) {
    const threadId = run.threadId!;
    if (!host.store.taskByThread(run.botId, threadId)) { host.routines?.failRunById(run.id, ROUTINE_RESTARTED); continue; }
    // Its teammate work goes on under the runtime's restart policy, which
    // resumes this thread itself: no second resume here.
    if (host.coordinator.continuesAfterRestart(threadId)) continue;
    // The resumed turn decides again: handoffs the cut turn left queued (an
    // older release's queue) would start work it may no longer want.
    host.legacyHandoffsDropped.add(threadId);
    host.store.appendMessage(threadId, { role: "bot", kind: "activity", tool: { name: "Resuming after a restart", ok: true } });
    const speaker = host.threadContinuationSpeaker(threadId, run);
    void host.startTurn(run.botId, ROUTINE_RESUME_PROMPT, { threadId, cardContinuation: true, ...(speaker ? { speaker } : {}) })
      .catch((error) => host.routines?.failRunById(run.id, `${ROUTINE_RESTARTED}: ${error instanceof Error ? error.message : String(error)}`));
  }
  let cut: ReturnType<typeof takeInterruptedTurns>;
  try {
    cut = takeInterruptedTurns(DATA_DIR);
  } catch (error) {
    console.error(`startup: the turns cut by the last stop could not be read: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  const failed = (threadId: string, why: string) =>
    host.store.appendMessage(threadId, { role: "bot", kind: "activity", tool: failedTurnTool(why) });
  for (const turn of cut.stale) if (host.store.taskByThread(turn.botId, turn.threadId)) failed(turn.threadId, TURN_CUT_BY_RESTART);
  // #2602: the runtime resumes these itself; a turn that never comes back
  // says so in its conversation instead of leaving the promise standing.
  const promised = cut.resume.filter((turn) => turn.runtimeHeld && host.store.taskByThread(turn.botId, turn.threadId));
  if (promised.length) watchRuntimeResumes(host, promised, failed);
  const resumedThreads = new Set<string>();
  for (const turn of cut.resume) {
    if (turn.runtimeHeld || !host.store.taskByThread(turn.botId, turn.threadId) || host.coordinator.continuesAfterRestart(turn.threadId) || host.runtimeHoldsRoot(turn.threadId)) continue;
    // A newer request already runs here: the cut turn is not resumed, and the conversation says so.
    if (host.threadBusy(turn.botId, turn.threadId)) { failed(turn.threadId, TURN_NOT_RESUMED_NEWER); continue; }
    host.store.appendMessage(turn.threadId, { role: "bot", kind: "activity", tool: { name: "Resuming after a restart", ok: true } });
    // Messages accepted into the cut turn stay answered once: fold them into
    // this resume (D2), then drop the durable rows so crash recovery does not
    // start a second follow-up for the same words.
    let held: ReturnType<typeof takeHeldSteersForThread> = [];
    try { held = takeHeldSteersForThread(DATA_DIR, turn.threadId); }
    catch (error) { console.warn(`held-steers: could not take for resume: ${error instanceof Error ? error.message : String(error)}`); }
    const prompt = resumePromptWithHeld(TURN_RESUME_PROMPT, held);
    resumedThreads.add(turn.threadId);
    void host.startTurn(turn.botId, prompt, {
      threadId: turn.threadId, cardContinuation: true,
      ...(turn.speaker ? { speaker: turn.speaker as TurnSpeaker } : {})
    }).catch((error) => failed(turn.threadId, `${TURN_RESUME_FAILED_PREFIX}${error instanceof Error ? error.message : String(error)}`));
  }
  // Crash path (no interrupted-turns.json): held rows that no resume took
  // become one follow-up turn per thread, like busy lines draining together.
  host.resumeHeldSteersAfterCrash(resumedThreads);
}
  return resumeTurnsCutByRestart;
}

/** Check, after a grace period, each turn the runtime promised to resume;
 * a thread still held or busy is checked again, up to half an hour. */
function watchRuntimeResumes(host: Host, turns: any[], failed: (threadId: string, why: string) => void, tries = 15): void {
  const timer = setTimeout(() => {
    const waiting = [];
    for (const turn of turns) {
      let verdict: string;
      try {
        verdict = runtimeResumeVerdict(turn, {
          held: Boolean(host.runtimeHoldsRoot(turn.threadId) || host.coordinator.continuesAfterRestart(turn.threadId)),
          busy: Boolean(host.threadBusy(turn.botId, turn.threadId)),
          messages: host.store.messagesFor(turn.threadId) ?? [],
        });
      } catch { continue; }
      if (verdict === "lost") failed(turn.threadId, TURN_NOT_RESUMED);
      else if (verdict === "wait") waiting.push(turn);
    }
    if (waiting.length && tries > 1) watchRuntimeResumes(host, waiting, failed, tries - 1);
  }, RUNTIME_RESUME_GRACE_MS);
  timer.unref?.();
}
