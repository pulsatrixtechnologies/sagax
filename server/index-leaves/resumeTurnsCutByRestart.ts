// @ts-nocheck
/** resumeTurnsCutByRestart (#1388). Pure move from server/index.ts. */
import { failedTurnTool } from "../../shared/failed-turn.ts";
import { TURN_CUT_BY_RESTART, TURN_RESUME_FAILED_PREFIX } from "../../shared/restart-words.ts";
import { DATA_DIR } from "../config.ts";
import { ROUTINE_RESTARTED, ROUTINE_RESUME_PROMPT } from "../routines/routines.ts";
import { migrateLegacyHeldSteers, takeHeldSteersForThread, resumePromptWithHeld } from "../turns/held-steers.ts";
import { outwardDetail } from "../runtime/tree.ts";
import { cutTurnContext, cutTurnResumePrompt, directResumeStep, type DirectResumeStep, RUNTIME_RESUME_GRACE_MS, runtimeResumeVerdict, takeInterruptedTurns, TURN_NOT_RESUMED, TURN_NOT_RESUMED_NEWER } from "../turns/interrupted-turns.ts";
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
  const resumedThreads = new Set<string>();
  // #3217: every cut turn is watched until it answers or says it did not
  // resume: the ones this start resumes, and the ones the runtime accounts
  // for (#2602), which are resumed here when the runtime never runs them.
  const watched: DirectResume[] = [];
  for (const turn of cut.resume) {
    if (!host.store.taskByThread(turn.botId, turn.threadId)) continue;
    if (turn.runtimeHeld || host.coordinator.continuesAfterRestart(turn.threadId) || host.runtimeHoldsRoot(turn.threadId)) {
      watched.push({ ...turn, prompt: "", runtime: true });
      continue;
    }
    // A newer request already runs here: the cut turn is not resumed, and the conversation says so.
    if (host.threadBusy(turn.botId, turn.threadId)) { failed(turn.threadId, TURN_NOT_RESUMED_NEWER); continue; }
    const prompt = resumePromptFor(host, turn, failed);
    if (prompt === null) continue;
    host.store.appendMessage(turn.threadId, { role: "bot", kind: "activity", tool: { name: "Resuming after a restart", ok: true } });
    // Messages accepted into the cut turn stay answered once: fold them into
    // this resume (D2), then drop the durable rows so crash recovery does not
    // start a second follow-up for the same words.
    let held: ReturnType<typeof takeHeldSteersForThread> = [];
    try { held = takeHeldSteersForThread(DATA_DIR, turn.threadId); }
    catch (error) { console.warn(`held-steers: could not take for resume: ${error instanceof Error ? error.message : String(error)}`); }
    resumedThreads.add(turn.threadId);
    const resume: DirectResume = { ...turn, prompt: resumePromptWithHeld(prompt, held) };
    launchDirectResume(host, resume, failed);
    watched.push(resume);
  }
  // #3217: a resumed chat turn that ends without a word (an early return,
  // a setup cut) is relaunched once, then says so in its conversation.
  if (watched.length) watchDirectResumes(host, watched, failed);
  // Crash path (no interrupted-turns.json): held rows that no resume took
  // become one follow-up turn per thread, like busy lines draining together.
  host.resumeHeldSteersAfterCrash(resumedThreads);
}
  return resumeTurnsCutByRestart;
}

type DirectResume = { botId: string; threadId: string; at: number; prompt: string; relaunched?: boolean;
  /** The runtime accounts for this turn (it resumes it itself): only watched until it is seen lost. */
  runtime?: boolean; runtimeHeld?: boolean };

/** #3217: the prompt that resumes a cut chat turn: the request it answers
 * and the steps it already did (cutTurnResumePrompt). A cut turn that
 * already sent, posted, pushed or paid is not run again, as the runtime's
 * restart policy does (contract §5): its conversation says what it did, and
 * the answer is null. */
function resumePromptFor(host: Host, turn: { threadId: string; at: number }, failed: (threadId: string, why: string) => void): string | null {
  const context = cutTurnContext(host.store.messagesFor(turn.threadId) ?? [], turn.at);
  if (context.outward.length) { failed(turn.threadId, outwardDetail(context.outward)); return null; }
  return cutTurnResumePrompt(context);
}

function launchDirectResume(host: Host, turn: DirectResume, failed: (threadId: string, why: string) => void): void {
  // #3609: the person the cut turn spoke for, as its thread keeps it.
  const speaker = host.turnSpeakers?.get(turn.threadId);
  void host.startTurn(turn.botId, turn.prompt, {
    threadId: turn.threadId, cardContinuation: true,
    ...(speaker ? { speaker } : {})
  }).catch((error) => failed(turn.threadId, `${TURN_RESUME_FAILED_PREFIX}${error instanceof Error ? error.message : String(error)}`));
}

/** #3217: the 0.8.77 routine resume, extended to chat turns. After a grace
 * period each cut turn is checked: still running waits, an answer or a
 * failed-turn row is done, nothing at all starts the turn once more (a
 * visible "Resuming after a restart" row), and a second silence posts
 * TURN_NOT_RESUMED in the thread and, for a background (MCP) thread, a
 * trace in the bot's own chat. A turn the runtime holds is waited on; one
 * it never ran by the last look is lost like any other. */
export function watchDirectResumes(host: Host, turns: DirectResume[], failed: (threadId: string, why: string) => void, tries = 15): void {
  const timer = setTimeout(() => {
    const waiting: DirectResume[] = [];
    let relaunchedNow = false;
    for (const turn of turns) {
      let step: DirectResumeStep;
      try {
        const held = turn.runtime ? Boolean(host.runtimeHoldsRoot(turn.threadId) || host.coordinator.continuesAfterRestart(turn.threadId)) : false;
        // A held root that is live and waits (on teammates it handed work
        // to, on a card) is the runtime's to resume: never run it a second
        // time beside it, even on the last look.
        const rootWaits = held && Boolean(host.runtimeRootWaiting?.(turn.threadId));
        step = directResumeStep(runtimeResumeVerdict(turn as any, {
          held,
          busy: Boolean(host.threadBusy(turn.botId, turn.threadId)),
          messages: host.store.messagesFor(turn.threadId) ?? [],
        }, tries <= 1 && !rootWaits), Boolean(turn.relaunched));
      } catch { continue; }
      if (step === "wait") waiting.push(turn);
      else if (step === "relaunch") {
        if (!host.store.taskByThread(turn.botId, turn.threadId)) continue;
        const prompt = turn.prompt || resumePromptFor(host, turn, failed);
        if (prompt === null) continue;
        console.error(`[restart-resume] thread=${turn.threadId} cut turn has no answer: starting it again`);
        host.store.appendMessage(turn.threadId, { role: "bot", kind: "activity", tool: { name: "Resuming after a restart", ok: true } });
        const again: DirectResume = { ...turn, prompt, relaunched: true, runtime: false };
        launchDirectResume(host, again, failed);
        waiting.push(again);
        relaunchedNow = true;
      } else if (step === "report") {
        failed(turn.threadId, TURN_NOT_RESUMED);
        reportInBotChat(host, turn);
      }
    }
    // A turn started again on the last look still gets its own looks.
    const next = tries > 1 ? tries - 1 : relaunchedNow ? 2 : 0;
    if (waiting.length && next > 0) watchDirectResumes(host, waiting, failed, next);
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
