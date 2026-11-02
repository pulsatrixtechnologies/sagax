/** Claude sendTurn orchestration across prepare/reuse/spawn/wire/stream/finish (#1383). */
import type { SendTurnInput } from "../../contracts.ts";
import { attachClaudeFinish } from "./finish.ts";
import { attachClaudeStream } from "./stream.ts";
import { prepareClaudeTurnArgs } from "./turn-prepare-args.ts";
import { prepareClaudeTurnMcp } from "./turn-prepare-mcp.ts";
import { tryReuseClaudeSession } from "./turn-reuse.ts";
import { spawnClaudeSession } from "./turn-spawn.ts";
import type { ClaudeTurnCtx, ClaudeTurnEarly } from "./turn-ctx.ts";
import type { SendTurnDeps } from "./turn-deps.ts";
import { attachClaudeWire } from "./wire.ts";
import { claudeUserMessage, volatileTurnMessage, withVolatileNote } from "./messages.ts";

export type { SendTurnDeps } from "./turn-deps.ts";

export function createSendTurn(deps: SendTurnDeps & { authRecovery: any }) {
  const sendTurn = async (turn: SendTurnInput, logicalTurnId?: string): Promise<ClaudeTurnEarly> => {
    const ctx = Object.assign(Object.create(deps), {
      turn,
      logicalTurnId,
      sendTurn,
      authRecovery: deps.authRecovery,
    }) as ClaudeTurnCtx;

    const earlyArgs = await prepareClaudeTurnArgs(ctx);
    if (earlyArgs) return earlyArgs;
    const earlyMcp = await prepareClaudeTurnMcp(ctx);
    if (earlyMcp) return earlyMcp;
    const reused = await tryReuseClaudeSession(ctx);
    if (reused) return reused;
    const spawned = await spawnClaudeSession(ctx);
    if (spawned) return spawned;

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
      return { turnId };
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

    return { turnId };
  };

  return sendTurn;
}
