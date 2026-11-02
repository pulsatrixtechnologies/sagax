/** Claude process close finalization and relaunch paths (#1383). */
import { rmSync } from "node:fs";
import { dirname } from "node:path";
import {
  classifyResumeFailure,
  mayReplay,
  recoveryPromptFor,
} from "../../resume-recovery.ts";
import {
  contextFullMessage,
  renewalPrompt,
} from "../../context-renewal.ts";
import { killCliTree } from "../../procs.ts";
import { classifyError, computeBackoff, interruptibleDelay, RETRY_MAX_ATTEMPTS } from "../retry.ts";
import { turnCostFromRunningTotal } from "./cost.ts";
import { removePrivateTempDir } from "./helpers.ts";
import type { ClaudeTurnCtx } from "./turn-ctx.ts";

export function attachClaudeFinish(ctx: ClaudeTurnCtx): void {
  const {
    session, threadId, emit, base, settle, settleResult, child,
    retryState, renewedTurns, freshNextTurn, carriedCosts,
    active, sessions, sendTurn, retryScale,
    markClosed, currentTurnId, sessionId,
  } = ctx;

  let closeFinalized = false;
const finalizeClose = async (code: number | null) => {
  if (closeFinalized) return;
  // The root can close while its MCP helpers are still running. Join
  // an in-flight stop (or reap its remaining group) before releasing
  // the turn so a replacement cannot overlap the old helpers.
  if (!(await killCliTree(child, 0))) {
    session.broker?.close();
    session.broker = undefined;
    emit({ ...base(threadId, currentTurnId()), type: "runtime.error", message: "Claude could not be confirmed stopped; its helper processes may still be running." });
    return;
  }
  if (closeFinalized) return;
  closeFinalized = true;
  // a turn still running when the process died is a failed turn; a
  // process that exited between turns (idle close, contract change)
  // is just a session ending
  if (session.turn?.stopRequested && !session.turn.settled) {
    settle(false, "interrupted");
  } else if (session.turn?.deferred && !session.turn.settled) {
    // The prompt was answered — a native result is held for a steered
    // continuation — and the process went away. Never relaunch: the
    // prompt already ran. Before the continuation announced itself the
    // held result is the turn's; once it had begun, its words are lost.
    const held = session.turn.deferred;
    if (session.turn.continuationGrace) {
      settleResult(held);
    } else {
      emit({
        ...base(threadId, currentTurnId()),
        type: "runtime.error",
        message: `claude exited ${code} before result${session.stderr ? `: ${session.stderr.trim().slice(-300)}` : ""}`,
      });
      settleResult({ ...held, ok: false, stopReason: "exit_before_result" });
    }
  } else if (session.turn && !session.turn.settled && session.turn.contextFull) {
    // The CLI stopped this turn because its context filled up. The
    // person never reads its "/clear" advice: the same logical turn
    // goes on in a fresh session, given the conversation (the chat's
    // rebuild, else the turn's own text) and the steps it already took.
    // Once per turn: a fresh session that fills up too is reported in
    // plain words, and the next send starts fresh (freshNextTurn).
    const { turnId, input: turn, retryAbort } = session.turn;
    const retry = retryState.get(threadId) ?? { attempt: 0, cancelled: false };
    if (!retry.cancelled && !renewedTurns.has(turnId)) {
      renewedTurns.add(turnId);
      const conversation = turn.recoveryText?.trim() ? turn.recoveryText : turn.text;
      const text = renewalPrompt({ base: conversation, steps: session.turn.steps ?? [], lastText: session.turn.lastText });
      // what the full session already spent stays this turn's cost
      const spent = turnCostFromRunningTotal(session.turn.contextFullTotal ?? null, session.costTotal ?? null);
      if (spent !== null) carriedCosts.set(turnId, (carriedCosts.get(turnId) ?? 0) + spent);
      session.broker?.close();
      session.broker = undefined;
      if (session.mcpConfigPath) {
        try {
          rmSync(dirname(session.mcpConfigPath), { recursive: true, force: true });
        } catch {}
        session.mcpConfigPath = null;
      }
      if (session.systemPromptPath) {
        removePrivateTempDir(session.systemPromptPath);
        session.systemPromptPath = null;
      }
      if (session.idleTimer) clearTimeout(session.idleTimer);
      if (sessions.get(threadId) === session) sessions.delete(threadId);
      session.turn = null;
      // Same relaunch handle as a rejected resume: Stop stays reachable
      // while the fresh process starts.
      retry.rebuilt = Boolean(turn.recoveryText?.trim());
      retry.renewed = true;
      retryState.set(threadId, retry);
      active.set(threadId, { stop: () => { retry.cancelled = true; retryAbort.abort(); }, turnId });
      void (async () => {
        try {
          await sendTurn({ ...turn, resumeCursor: undefined, sessionReset: false, recoveryText: undefined, harnessCommand: undefined, text }, turnId);
        } catch (e) {
          renewedTurns.delete(turnId);
          carriedCosts.delete(turnId);
          if (active.get(threadId)?.turnId === turnId) active.delete(threadId);
          retryState.delete(threadId);
          emit({ ...base(threadId, turnId), type: "runtime.error", message: e instanceof Error ? e.message : String(e) });
          emit({ ...base(threadId, turnId), type: "turn.completed", ok: false, stopReason: "exit_before_result", cost: null });
        }
      })();
      return;
    }
    renewedTurns.delete(turnId);
    retryState.delete(threadId);
    const total = session.turn.contextFullTotal ?? null;
    if (retry.cancelled) {
      settle(false, "interrupted", total);
    } else {
      freshNextTurn.add(threadId);
      emit({ ...base(threadId, currentTurnId()), type: "runtime.error", message: contextFullMessage("Claude") });
      settle(false, "context_full", total);
    }
  } else if (session.turn && !session.turn.settled) {
    // A retained process may be running a later user turn. Its close
    // handler must retry that request, not the process's first prompt.
    const { turnId, input: turn, retryAbort } = session.turn;
    const retry = retryState.get(threadId) ?? { attempt: 0, cancelled: false };
    const message = `claude exited ${code} before result${session.stderr ? `: ${session.stderr.trim().slice(-300)}` : ""}`;
    const verdict = classifyError({ exitCode: code, stderr: message });
    // A process kept warm from an earlier turn ended before it
    // announced this one: it never took the prompt. That is a session
    // ending between turns, not a failed turn, so the same turn
    // resumes the session on a fresh process at once — no retry row,
    // no retry budget spent. (A fresh process is never retained, so
    // this happens at most once per turn.)
    const endedBeforeTurn = session.turn.awaitingInit === true;
    if (
      !retry.cancelled &&
      (endedBeforeTurn || (
        code !== 0 &&
        verdict.transient &&
        !session.turn.sawStreamDelta &&
        retry.attempt < RETRY_MAX_ATTEMPTS - 1
      ))
    ) {
      // the CLI is gone but the TURN continues: keep the thread busy,
      // emit no terminal event, and relaunch after the backoff. The
      // `active` entry STAYS — it is what makes an interrupt during
      // the backoff reach this turn's stop() and cancel the retry.
      const failedBroker = session.broker;
      session.broker = undefined;
      failedBroker?.pause();
      failedBroker?.close();
      if (session.mcpConfigPath) {
        try {
          rmSync(dirname(session.mcpConfigPath), { recursive: true, force: true });
        } catch {}
        session.mcpConfigPath = null;
      }
      if (session.systemPromptPath) {
        removePrivateTempDir(session.systemPromptPath);
        session.systemPromptPath = null;
      }
      sessions.delete(threadId);
      session.turn = null;
      let delayMs = 0;
      if (!endedBeforeTurn) {
        retry.attempt++;
        delayMs = computeBackoff(retry.attempt - 1);
        emit({
          ...base(threadId, turnId),
          type: "turn.retrying",
          attempt: retry.attempt,
          delayMs,
          reason: verdict.reason,
        });
      }
      void (async () => {
        const wait = interruptibleDelay(delayMs * retryScale, retryAbort.signal);
        await wait.promise;
        // an interrupt during the backoff landed here via stop(); the
        // turn settles as interrupted and no zombie relaunch happens
        if (retry.cancelled) {
          active.delete(threadId);
          retryState.delete(threadId);
          emit({
            ...base(threadId, turnId),
            type: "turn.completed",
            ok: false,
            stopReason: "interrupted",
            cost: null,
          });
          return;
        }
        // Keep Stop reachable while the relaunch sets up: there is no
        // process yet, so this handle only records the cancellation and
        // the relaunched sendTurn honors it before spawning.
        retryState.set(threadId, retry);
        active.set(threadId, { stop: () => { retry.cancelled = true; retryAbort.abort(); }, turnId });
        try {
          const cursor = session.sessionId ?? sessionId ?? undefined;
          // The reset was consumed by the initial launch. Retry the
          // new session, never the context that launch replaced.
          await sendTurn({ ...turn, sessionReset: false, resumeCursor: cursor }, turnId);
        } catch (e) {
          if (active.get(threadId)?.turnId === turnId) active.delete(threadId);
          retryState.delete(threadId);
          emit({
            ...base(threadId, turnId),
            type: "runtime.error",
            message: e instanceof Error ? e.message : String(e),
          });
          emit({
            ...base(threadId, turnId),
            type: "turn.completed",
            ok: false,
            stopReason: "exit_before_result",
            cost: null,
          });
        }
      })();
      return;
    }
    // A --resume that the CLI never acknowledged: it exited without
    // an `init` frame, so it never read the prompt and this turn has
    // caused nothing. Without this the thread is BRICKED — the dead
    // cursor is never cleared, so every later turn resumes the same
    // missing session and fails identically, and the user has no way
    // back except switching engines. One fresh session, carrying the
    // harness's rebuild of the conversation. Exactly one: the relaunch
    // offers no cursor, so `attempted` is false there and a second
    // failure is reported like any other.
    const resumeFailure = classifyResumeFailure({
      attempted: Boolean(sessionId),
      rejected: !session.sawInit,
      promptSubmitted: session.sawInit,
      producedOutput: session.turn.sawStreamDelta,
    });
    if (mayReplay(resumeFailure) && !retry.cancelled) {
      const recovery = recoveryPromptFor({
        recoveryText: turn.recoveryText,
        currentText: turn.text,
        failure: resumeFailure,
      });
      session.broker?.close();
      session.broker = undefined;
      if (session.mcpConfigPath) {
        try {
          rmSync(dirname(session.mcpConfigPath), { recursive: true, force: true });
        } catch {}
        session.mcpConfigPath = null;
      }
      if (session.systemPromptPath) {
        removePrivateTempDir(session.systemPromptPath);
        session.systemPromptPath = null;
      }
      sessions.delete(threadId);
      session.turn = null;
      // Same relaunch handle as the transient-retry path above. The new
      // session is announced as rebuilt only when it is actually given
      // the replay: with nothing to replay it gets the turn text alone.
      // That announcement, with its notice, is what the person is told;
      // this is no retry of a failure.
      retry.rebuilt = recovery.replayed;
      retryState.set(threadId, retry);
      active.set(threadId, { stop: () => { retry.cancelled = true; retryAbort.abort(); }, turnId });
      void (async () => {
        try {
          // no cursor: a fresh session, carrying the rebuild
          await sendTurn({ ...turn, resumeCursor: undefined, recoveryText: undefined, text: recovery.text }, turnId);
        } catch (e) {
          if (active.get(threadId)?.turnId === turnId) active.delete(threadId);
          retryState.delete(threadId);
          emit({
            ...base(threadId, turnId),
            type: "runtime.error",
            message: e instanceof Error ? e.message : String(e),
          });
          emit({ ...base(threadId, turnId), type: "turn.completed", ok: false, stopReason: "exit_before_result", cost: null });
        }
      })();
      return;
    }
    retryState.delete(threadId);
    emit({
      ...base(threadId, currentTurnId()),
      type: "runtime.error",
      message,
    });
    settle(false, "exit_before_result");
  }
  if (session.idleTimer) clearTimeout(session.idleTimer);
  session.broker?.close();
  if (session.mcpConfigPath) {
    try {
      rmSync(dirname(session.mcpConfigPath), { recursive: true, force: true });
    } catch {}
  }
  removePrivateTempDir(session.systemPromptPath);
  if (sessions.get(threadId) === session) sessions.delete(threadId);
};

  ctx.finalizeClose = finalizeClose;
  child.on("close", (code) => {
    session.finishClose = () => finalizeClose(code);
    void session.finishClose().finally(markClosed);
  });
}
