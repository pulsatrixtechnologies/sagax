/** Claude sendTurn orchestration across prepare/reuse/spawn/wire/stream/finish (#1383). */
import type { SendTurnInput } from "../../contracts.ts";
import { turnTrace } from "../../turns/turn-trace.ts";
import { attachClaudeFinish } from "./finish.ts";
import { attachClaudeStream } from "./stream.ts";
import { prepareClaudeTurnArgs } from "./turn-prepare-args.ts";
import { prepareClaudeTurnMcp } from "./turn-prepare-mcp.ts";
import { tryReuseClaudeSession } from "./turn-reuse.ts";
import { spawnClaudeSession } from "./turn-spawn.ts";
import type { ClaudeTurnCtx, ClaudeTurnEarly } from "./turn-ctx.ts";
import type { SendTurnDeps } from "./turn-deps.ts";
import { waitClaudePrewarmed } from "./warm-ready.ts";
import { attachClaudeWire } from "./wire.ts";
import { claudeUserMessage, volatileTurnMessage, withVolatileNote } from "./messages.ts";

export type { SendTurnDeps } from "./turn-deps.ts";

/** #3703: one launch at a time per thread. A launch reads the thread's
 * live process, may close it, and installs its own; two at once (a
 * composer warm and the message it was warming for) each installed a
 * process and the later one replaced the earlier in the session map,
 * leaving it running untracked. Each launch now waits for the one before
 * it on the same thread, and then sees what that one installed. Waits
 * for an engine's init run after the launch is released. */
function threadLaunches() {
  const tails = new Map<string, Promise<void>>();
  return async (threadId: string): Promise<() => void> => {
    const before = tails.get(threadId) ?? Promise.resolve();
    let release!: () => void;
    const mine = new Promise<void>((resolve) => { release = resolve; });
    const tail = before.then(() => mine);
    tails.set(threadId, tail);
    await before;
    return () => {
      release();
      if (tails.get(threadId) === tail) tails.delete(threadId);
    };
  };
}

export function createSendTurn(deps: SendTurnDeps & { authRecovery: any }) {
  const launchSlot = threadLaunches();

  /** Everything that reads or replaces the thread's process, under its slot. */
  const launch = async (ctx: ClaudeTurnCtx): Promise<{ early?: ClaudeTurnEarly; after?: () => Promise<ClaudeTurnEarly> }> => {
    const { turn } = ctx;
    const earlyArgs = await prepareClaudeTurnArgs(ctx);
    if (earlyArgs) return { early: earlyArgs };
    const earlyMcp = await prepareClaudeTurnMcp(ctx);
    if (earlyMcp) return { early: earlyMcp };
    const reused = await tryReuseClaudeSession(ctx);
    if (reused) {
      const kept = ctx.prewarmWait;
      if (!kept) return { early: reused };
      return {
        after: async () => {
          await waitClaudePrewarmed(kept, turn.warmSignal);
          turnTrace(ctx.threadId, "claude-prewarmed");
          return reused;
        },
      };
    }
    const spawned = await spawnClaudeSession(ctx);
    if (spawned) return { early: spawned };

    attachClaudeWire(ctx);
    attachClaudeStream(ctx);
    attachClaudeFinish(ctx);

    const {
      session, threadId, turnId, broker, retry, retryAbort, active, emit, base,
      closeSession, stopSession, holdWarm, writeUser, settle, promptMsg,
      held, launchVolatile,
    } = ctx as ClaudeTurnCtx & { held?: { sessionId: string; volatile: string; sections?: Record<string, string> }; launchVolatile?: string };

    const stop = () => {
      if (session.turn) session.turn.stopRequested = true;
      closeSession(threadId, "interrupted");
      retry.cancelled = true;
      retryAbort.abort();
      stopSession(session);
    };
    if (turn.warmOnly === true) {
      holdWarm(threadId, session, turnId, turn.warmSignal);
      // Pay cold boot (init) before the warm returns, so the first real turn
      // is a bare prompt on a ready process (#1971 / #2055 pattern).
      return {
        after: async () => {
          await waitClaudePrewarmed(session, turn.warmSignal);
          turnTrace(threadId, "claude-prewarmed");
          return { turnId };
        },
      };
    }
    active.set(threadId, { stop, turnId, broker });
    emit({ ...base(threadId, turnId), type: "turn.started" });

    const launchMessage = turn.harnessCommand ? promptMsg
      : held ? volatileTurnMessage(turn, held.volatile, held.sections)
        : launchVolatile ? claudeUserMessage(withVolatileNote(turn.text, launchVolatile, true), turn.images) : promptMsg;
    if (!(await writeUser(session, threadId, launchMessage))) {
      if (!session.turn?.stopRequested) settle(false, "stdin_write_failed");
      closeSession(threadId, "stdin write failed");
    }
    return { early: { turnId } };
  };

  const sendTurn = async (turn: SendTurnInput, logicalTurnId?: string): Promise<ClaudeTurnEarly> => {
    const ctx = Object.assign(Object.create(deps), {
      turn,
      logicalTurnId,
      sendTurn,
      authRecovery: deps.authRecovery,
    }) as ClaudeTurnCtx;

    const release = await launchSlot(turn.threadId);
    let launched: Awaited<ReturnType<typeof launch>>;
    try {
      launched = await launch(ctx);
    } finally {
      release();
    }
    return launched.early ?? await launched.after!();
  };

  return sendTurn;
}
