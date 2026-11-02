/** Wire JSON-RPC request/stop/settle/relaunch/steer for a Codex app-server session. */
import { captureCliTree, killCliTree, waitForExit } from "../../procs.ts";
import { appendNative } from "../native.ts";
import { computeBackoff, interruptibleDelay } from "../retry.ts";
import { codexRpcTimeoutMs, keepStopping, RELAUNCH_EXIT_WAIT_MS } from "../codex-process.ts";
import { contextFullMessage } from "../../context-renewal.ts";
import { codexNativeLogMessage } from "./native-log.ts";
import type { CodexSession } from "./session-types.ts";
import type { SteerOutcome } from "../../contracts.ts";

export function wireCodexSession(s: CodexSession): void {
  const turn = s.input;
s.abandoned = false;
s.codexThreadId= null;
s.codexTurnId= null;
s.startingNativeTurn = false;
s.earlyNotifications= [];
s.state = {
  settled: false,
  lastError: "",
  // whether lastError went out marked setup (a sign-in to fix)
  lastErrorSetup: false,
  // an error Codex said it would retry itself (willRetry), kept only
  // to explain a turn that then fails without words of its own
  retryError: "",
  // Codex started recovering its model provider's sign-in this turn
  authRecovery: false,
  // second context overflow this logical turn: settle as context_full
  contextFullStop: false,
  lastText: "",
  sawStreamDelta: false,
  streamed: false,
  // codex reports token usage as a running total for this app-server
  // process. The harness wants this turn's figure: the total minus
  // whatever the process already carried before turn/start (a resumed
  // thread may restore earlier usage), banked on settle.
  usage: undefined as { input: number; output: number; cachedInput?: number } | undefined,
  usageBaseline: undefined as { input: number; output: number; cachedInput: number } | undefined,
};

s.asks = new Map<string, (behavior: "allow" | "deny" | "answer", message?: string, source?: "user" | "timeout" | "system") => void>();
s.nextId = 1;
s.sensitiveResponseIds = new Set<number>();
s.rpcPending = new Map<number, {
  resolve: (v: any) => void;
  reject: (e: Error) => void;
}>();

s.send = (obj: unknown) => {
  try {
    s.child.stdin!.write(JSON.stringify(obj) + "\n");
  } catch {}
  appendNative(s.threadId, {
    dir: "out",
    source: "codex.app-server",
    msg: codexNativeLogMessage(obj),
  });
};
s.request = (method: string, params: unknown, timeoutMs = codexRpcTimeoutMs(method)) =>
  new Promise<any>((resolve, reject) => {
    const id = s.nextId++;
    if (method === "config/read") s.sensitiveResponseIds.add(id);
    // a wedged app-server can accept stdin and never reply; without this
    // the handshake await hangs forever and the bot stays busy for good
    const timer = setTimeout(() => {
      if (s.rpcPending.delete(id)) reject(new Error(`codex ${method} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    if (typeof timer.unref === "function") timer.unref();
    s.rpcPending.set(id, {
      resolve: (v) => {
        clearTimeout(timer);
        if (method === "thread/start" || method === "thread/resume") {
          // Notifications can follow the thread response in the same
          // stdout chunk, before the handshake await resumes.
          const returnedId = v?.thread?.id;
          const requestedId = method === "thread/resume"
            && params && typeof params === "object" && "threadId" in params
            ? params.threadId : null;
          if (typeof returnedId === "string" && returnedId) s.codexThreadId = returnedId;
          else if (typeof requestedId === "string" && requestedId) s.codexThreadId = requestedId;
        }
        if (method === "turn/start") {
          if (typeof v?.turn?.id !== "string" || !v.turn.id) {
            reject(new Error("Codex did not return a native turn id"));
            return;
          }
          // Bind synchronously: a single stdout chunk can contain the
          // response, streamed events, completion and a late request.
          s.codexTurnId = v.turn.id;
          s.startingNativeTurn = false;
          for (const notification of s.earlyNotifications.splice(0)) {
            if (s.state.settled || s.abandoned) break;
            s.handleNotification(notification);
          }
        }
        resolve(v);
      },
      reject: (e) => {
        clearTimeout(timer);
        reject(e);
      },
    });
    s.send({ jsonrpc: "2.0", id, method, params });
  });

s.stopping = undefined as any; // was typed: Promise<boolean> | undefined;
s.terminate = () => s.stopping ??= killCliTree(s.child).then((stopped) => {
  if (!stopped) s.stopping = undefined;
  return stopped;
});
s.completeStoppedTurn = undefined as (() => void) | undefined;
// Stop asks the app-server to end the turn itself before any process
// signal. Killing first surfaced routine stops as "codex exited null
// (signal SIGTERM) before turn/completed"; the protocol interrupt keeps
// the session the authority, and the kill below is only escalation for
// a server that will not answer. settle() runs with state.settled
// already true, so ordinary completion still tears down immediately.
s.interruptRequested = false;
s.stop = async () => {
  // Capture Linux sandbox helpers before protocol interrupt: they can
  // leave the CLI's process group and reparent while Codex answers.
  captureCliTree(s.child);
  s.stopRequested = true;
  s.stopSignal.abort();
  if (!s.state.settled && !s.interruptRequested && s.codexThreadId && s.codexTurnId &&
      s.child.exitCode === null && s.child.signalCode === null) {
    s.interruptRequested = true;
    const graceMs = Math.max(1, Number(process.env.FAKE_CODEX_INTERRUPT_GRACE_MS ?? 750) || 750);
    try {
      await s.request("turn/interrupt", { threadId: s.codexThreadId, turnId: s.codexTurnId }, graceMs);
    } catch {
      // Old CLI without the method, or a wedged server: escalate below.
    }
    const deadline = Date.now() + graceMs;
    while (!s.state.settled && Date.now() < deadline) {
      await new Promise((wake) => setTimeout(wake, 15));
    }
    // Protocol completion is not process termination. In particular,
    // sign-out must wait until the child holding its token has exited.
  }
  const stopped = await s.terminate();
  if (stopped) s.completeStoppedTurn?.();
  return stopped;
};

s.settle = async (ok: boolean, stopReason: string | null) => {
  if (s.state.settled) return;
  s.state.settled = true;
  for (const finish of Array.from(s.asks.values())) finish("deny", "Sagax: the turn ended", "system");
  for (const p of s.rpcPending.values()) p.reject(new Error("turn settled"));
  s.rpcPending.clear();
  const complete = () => {
    if (s.active.get(s.threadId)?.stop !== s.stop) return;
    s.active.delete(s.threadId);
    s.emit({ ...s.base(s.threadId, s.turnId), type: "turn.completed", ok, stopReason, cost: null, ...(s.state.usage ? { usage: s.state.usage } : {}) });
  };
  s.completeStoppedTurn = complete;
  if (await s.stop()) return;
  s.emit({ ...s.base(s.threadId, s.turnId), type: "runtime.error", message: "codex did not shut down after termination was requested" });
  await keepStopping(s.terminate, () => s.active.get(s.threadId)?.stop === s.stop);
  complete();
};

// Retires this process before anything async, so a late rpc timer rejection cannot relaunch again.
s.relaunch = async (reason: string, failure: string, failedStop: string) => {
  const delayMs = computeBackoff(s.attempt);
  s.attempt++;
  s.emit({ ...s.base(s.threadId, s.turnId), type: "turn.retrying", attempt: s.attempt, delayMs, reason });
  s.abandoned = true;
  s.releaseSlot();
  const exited = s.child.exitCode !== null || s.child.signalCode !== null;
  if (!exited && !(await s.terminate()) && !(await waitForExit(s.child, RELAUNCH_EXIT_WAIT_MS))) {
    s.emit({ ...s.base(s.threadId, s.turnId), type: "runtime.error", message: failure });
    return s.settle(false, failedStop);
  }
  await interruptibleDelay(Math.max(1, Math.round(delayMs * s.retryScale)), s.stopSignal.signal).promise;
  if (!s.stopRequested) void s.runLaunchAttempt(s.attempt).catch(() => {});
  else await s.settle(false, "interrupted");
};

// Context filled mid-turn: close this app-server and continue the same
// logical turn on a fresh Codex thread with the chat rebuild and the
// steps already taken (server/context-renewal.ts). No turn.retrying row:
// the person sees nothing; Events gets contextRenewedNotice on start.
s.renewContext = async () => {
  s.abandoned = true;
  s.releaseSlot();
  const exited = s.child.exitCode !== null || s.child.signalCode !== null;
  if (!exited && !(await s.terminate()) && !(await waitForExit(s.child, RELAUNCH_EXIT_WAIT_MS))) {
    s.inTurnRenewal = null;
    s.renewedTurns.delete(s.turnId);
    s.freshNextTurn.add(s.threadId);
    s.emit({ ...s.base(s.threadId, s.turnId), type: "runtime.error", message: contextFullMessage("Codex") });
    return s.settle(false, "context_full");
  }
  if (!s.stopRequested) void s.runLaunchAttempt(s.attempt).catch(() => {});
  else await s.settle(false, "interrupted");
};

// Live steering folds new input into the running turn without ending
// it. expectedTurnId is the protocol's precondition: a turn that moved
// on (or a CLI without turn/steer) answers with an explicit RPC error,
// which becomes "refused" here so the caller queues for the next turn —
// the child is never killed to steer. A timeout after delivery, a dead
// transport, or a turn that settles while the answer is in flight is
// "indeterminate": the words may already be running, so the caller must
// not re-queue them.
s.steerActiveTurn = async (text: string, steerId?: string): Promise<SteerOutcome> => {
  if (s.state.settled || s.abandoned || s.stopRequested || !s.codexThreadId || !s.codexTurnId) return "refused";
  if (s.child.exitCode !== null || s.child.signalCode !== null) return "refused";
  try {
    const steerTimeoutMs = Math.max(1, Number(process.env.FAKE_CODEX_STEER_TIMEOUT_MS ?? 10_000) || 10_000);
    await s.request("turn/steer", { threadId: s.codexThreadId,
      input: [{ type: "text", text }],
      expectedTurnId: s.codexTurnId,
    }, steerTimeoutMs);
    // Accepted input joins the turn's pending input, and the turn
    // samples again before it ends while any is pending: the running
    // turn reads it. Said so, the harness counts it received and never
    // offers it to the next turn as unseen, which answered it twice
    // (2026-11-01).
    if (steerId) s.emit({ ...s.base(s.threadId, s.turnId), type: "steer.received", steerId });
    return "steered";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (s.state.settled || message.includes("timed out")) return "indeterminate";
    return "refused";
  }
};

// server→client approval request → canonical request.opened
// Host-scope tagging mirrors claude.ts: when this turn mounts the real
// Mac (not a VM), every card carries approvalScope so the harness's
// local-computer-block backstop applies to remembered always-allows.
s.controlsHost = turn.integrations?.localComputer?.scope === "local-computer";

}
