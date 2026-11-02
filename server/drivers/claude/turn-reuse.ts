/** Claude live idle session reuse path (#1383). */
import { rmSync } from "node:fs";
import { dirname } from "node:path";
import { sectionFingerprints } from "../prompt-split.ts";
import { contractChanges, switchesCover, turnSwitches } from "../spawn-contract.ts";
import { volatileTurnMessage } from "./messages.ts";
import type { ClaudeTurnCtx, ClaudeTurnEarly } from "./turn-ctx.ts";

export async function tryReuseClaudeSession(ctx: ClaudeTurnCtx): Promise<ClaudeTurnEarly | null> {
  const {
    turn, threadId, turnId, argsKey, sessionId, contract, sessions, active,
    emit, base, closeSession, stopSession, holdWarm, writeUser, retry, retryAbort, instanceId,
  } = ctx;
  let { mcpConfigPath } = ctx;
  const mcpServers = ctx.mcpServers;

const live = sessions.get(threadId);
const dropUnusedMcp = () => {
  if (!mcpConfigPath) return;
  try {
    rmSync(dirname(mcpConfigPath), { recursive: true, force: true });
  } catch {}
  mcpConfigPath = null;
};
const switches = turnSwitches(mcpServers);
if (!turn.sessionReset && live && !live.turn && !live.closing && live.child.exitCode === null && live.argsKey === argsKey && switchesCover(live.switches, switches) && (!sessionId || sessionId === live.sessionId)) {
  if (live.idleTimer) clearTimeout(live.idleTimer);
  // A second warm of the same call keeps the process and writes nothing.
  if (turn.warmOnly === true) {
    dropUnusedMcp();
    holdWarm(threadId, live, turnId, turn.warmSignal);
    return { turnId, reused: true };
  }
  // Attach before any await so a hangup abort cannot close a process
  // this turn now owns. Init that arrived during the warm is published
  // once here: a cancelled warm never emits, so it cannot overwrite a
  // resume cursor, and a CLI that already announced init does not have
  // to announce it again.
  const publishWarmInit = live.idleWarm === true && live.sawInit && Boolean(live.sessionId);
  live.idleWarm = false;
  live.warmToken = undefined;
  live.turn = { turnId, input: turn, retryAbort, settled: false, sawStreamDelta: false, awaitingInit: true, pendingSteers: new Set(), deferred: null, continuationGrace: null, continuationSilence: null };
  active.set(threadId, { stop: () => {
    if (live.turn) live.turn.stopRequested = true;
    closeSession(threadId, "interrupted");
    retry.cancelled = true;
    retryAbort.abort();
    stopSession(live);
  }, turnId, broker: live.broker });
  emit({ ...base(threadId, turnId), type: "turn.started" });
  if (publishWarmInit && live.sessionId) {
    emit({ ...base(threadId, turnId), type: "session.started", sessionId: live.sessionId, model: live.sessionModel ?? null });
  }
  const volatile = turn.systemVolatile ?? "";
  const message = volatileTurnMessage(turn, live.volatile, live.volatileSections);
  if (!turn.harnessCommand) {
    live.volatile = volatile;
    live.volatileSections = turn.systemVolatileSections ? sectionFingerprints(turn.systemVolatileSections) : undefined;
  }
  const running = live.turn;
  // A warm process can end between turns just as the next one is
  // written: this driver learns of an exit only when the event loop
  // gets to it (later still on Windows), so the check above can find it
  // live and the write then fail. Nothing was submitted; its close
  // resumes this same turn on a fresh process (see `awaitingInit`).
  if (!(await writeUser(live, threadId, message)) && !running?.stopRequested) closeSession(threadId, "stdin write failed");
  // the MCP config was for the first spawn; nothing to clean here
  if (mcpConfigPath) {
    try {
      rmSync(dirname(mcpConfigPath), { recursive: true, force: true });
    } catch {}
  }
  return { turnId, reused: true };
}
if (live) {
  // A real turn owns the process. A warm must not close it.
  if (turn.warmOnly === true && live.turn) {
    dropUnusedMcp();
    return { turnId };
  }
  // A relaunch costs the engine's whole cold start (on a call, most of
  // the pause before the answer): say which fields of the spawn
  // contract changed (names only, never values).
  if (!turn.sessionReset) {
    const why = live.argsKey !== argsKey ? `spawn contract changed (${live.contract ? contractChanges(live.contract, contract).join(", ") : "unknown"})`
      : !switchesCover(live.switches, switches) ? "the turn needs agents tools the live process was launched without"
      : live.child.exitCode !== null ? "process exited" : live.closing ? "process closing" : live.turn ? "a turn is running" : "another session";
    console.warn(`claude (${instanceId}): thread ${threadId} relaunch: ${why}`);
  }
  // A relaunch reconnects every MCP server: say which ones changed, so
  // tools that come and go between turns can be traced.
  if (!turn.sessionReset && live.mcpNames) {
    const now = Object.keys(mcpServers);
    const added = now.filter((name) => !live.mcpNames!.includes(name));
    const removed = live.mcpNames.filter((name) => !now.includes(name));
    if (added.length || removed.length) {
      console.warn(`claude (${instanceId}): thread ${threadId} relaunched; MCP servers${added.length ? ` added ${added.join(", ")}` : ""}${removed.length ? ` removed ${removed.join(", ")}` : ""}`);
    }
  }
  closeSession(threadId, turn.sessionReset ? "context reset" : "spawn contract changed");
}

  ctx.mcpConfigPath = mcpConfigPath;
  return null;
}
