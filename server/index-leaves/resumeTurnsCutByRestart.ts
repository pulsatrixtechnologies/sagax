// @ts-nocheck
/** resumeTurnsCutByRestart (#1388). Pure move from server/index.ts. */
import { failedTurnTool } from "../../shared/failed-turn.ts";
import { TURN_CUT_BY_RESTART, TURN_RESUME_FAILED_PREFIX } from "../../shared/restart-words.ts";
import { DATA_DIR } from "../config.ts";
import { ROUTINE_RESTARTED, ROUTINE_RESUME_PROMPT } from "../routines/routines.ts";
import { migrateLegacyHeldSteers, takeHeldSteersForThread, resumePromptWithHeld } from "../turns/held-steers.ts";
import { directResumeStep, type DirectResumeStep, RUNTIME_RESUME_GRACE_MS, runtimeResumeVerdict, takeInterruptedTurns, TURN_NOT_RESUMED, TURN_NOT_RESUMED_NEWER, TURN_RESUME_PROMPT } from "../turns/interrupted-turns.ts";
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
  const launched: DirectResume[] = [];
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
    const resume: DirectResume = { ...turn, prompt };
    launchDirectResume(host, resume, failed);
    launched.push(resume);
  }
  // #3217: a resumed chat turn that ends without a word (an early return,
  // a setup cut) is relaunched once, then says so in its conversation.
  if (launched.length) watchDirectResumes(host, launched, failed);
  // Crash path (no interrupted-turns.json): held rows that no resume took
  // become one follow-up turn per thread, like busy lines draining together.
  host.resumeHeldSteersAfterCrash(resumedThreads);
}
  return resumeTurnsCutByRestart;
}

type DirectResume = { botId: string; threadId: string; at: number; speaker?: unknown; prompt: string; relaunched?: boolean };

function launchDirectResume(host: Host, turn: DirectResume, failed: (threadId: string, why: string) => void): void {
  void host.startTurn(turn.botId, turn.prompt, {
    threadId: turn.threadId, cardContinuation: true,
    ...(turn.speaker ? { speaker: turn.speaker as TurnSpeaker } : {})
  }).catch((error) => failed(turn.threadId, `${TURN_RESUME_FAILED_PREFIX}${error instanceof Error ? error.message : String(error)}`));
}

/** #3217: the 0.8.77 routine resume, extended to chat turns. After a grace
 * period each directly resumed turn is checked: still running waits, an
 * answer is done, nothing at all starts the turn once more (a visible
 * "Resuming after a restart" row), and a second silence posts
 * TURN_NOT_RESUMED in the thread and, for a background (MCP) thread, a
 * trace in the bot's own chat. */
export function watchDirectResumes(host: Host, turns: DirectResume[], failed: (threadId: string, why: string) => void, tries = 15): void {
  const timer = setTimeout(() => {
    const waiting: DirectResume[] = [];
    for (const turn of turns) {
      let step: DirectResumeStep;
      try {
        step = directResumeStep(runtimeResumeVerdict(turn as any, {
          held: false,
          busy: Boolean(host.threadBusy(turn.botId, turn.threadId)),
          messages: host.store.messagesFor(turn.threadId) ?? [],
        }), Boolean(turn.relaunched));
      } catch { continue; }
      if (step === "wait") waiting.push(turn);
      else if (step === "relaunch") {
        if (!host.store.taskByThread(turn.botId, turn.threadId)) continue;
        console.error(`[restart-resume] thread=${turn.threadId} resumed turn ended without an answer: starting it again`);
        host.store.appendMessage(turn.threadId, { role: "bot", kind: "activity", tool: { name: "Resuming after a restart", ok: true } });
        const again = { ...turn, relaunched: true };
        launchDirectResume(host, again, failed);
        waiting.push(again);
      } else if (step === "report") {
        failed(turn.threadId, TURN_NOT_RESUMED);
        reportInBotChat(host, turn);
      }
    }
    if (waiting.length && tries > 1) watchDirectResumes(host, waiting, failed, tries - 1);
  }, RUNTIME_RESUME_GRACE_MS);
  timer.unref?.();
}

/** A hidden MCP thread's failure reaches the bot's chat ("rien d'invisible", #2901). */
function reportInBotChat(host: Host, turn: DirectResume): void {
  try {
    const bot = host.botForThread?.(turn.botId, turn.threadId);
    if (bot && host.mirrorBackgroundReply && host.personAttentionDeps) {
      host.mirrorBackgroundReply({ bot, threadId: turn.threadId, turnId: `restart:${turn.at}`, ok: false, stopped: false, runTurn: false }, host.personAttentionDeps);
    }
  } catch (error) {
    console.error(`[restart-resume] not relayed: ${error instanceof Error ? error.message.slice(0, 160) : "error"}`);
  }
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
