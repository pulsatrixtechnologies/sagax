/** RPC waiters, settle, and mid-turn steer for one pi child (#1383). */
import { rmSync } from "node:fs";
import { isLocalModelId } from "./local-inject.ts";
import { localModelFailureMessage, providerReason } from "./engine-errors.ts";
import { appendNative } from "./native.ts";
import { killCliTree } from "../procs.ts";
import type { PiPrepared, PiSendCtx } from "./pi-turn-ctx.ts";
import { reportBackgroundError } from "../background-error.ts";

export function attachPiRpc(ctx: PiPrepared): PiSendCtx {
  const { hooks, emit, base } = ctx.deps;
  // resolve one-shot RPC responses (new_session / switch_session / set_model)
  // Steer frames correlate by a unique per-request id, not the shared
  // "steer" command name: two concurrent steers would otherwise overwrite
  // each other's waiter, and a refusal response could reject the wrong
  // caller — requeueing words pi already accepted. Every other command
  // keeps its command-name key.
  const rejectWaiters = (err: Error) => {
    for (const waiter of ctx.responseWaiters.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(err);
    }
    ctx.responseWaiters.clear();
  };
  const awaitResponse = (command: string, timeoutMs = 20_000, key = command) =>
    new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        ctx.responseWaiters.delete(key);
        reject(new Error(`pi ${command} timed out`));
      }, timeoutMs);
      timer.unref?.();
      ctx.responseWaiters.set(key, { resolve, reject, timer });
    });
  ctx.child.stdin.on("error", () => rejectWaiters(new Error("pi stdin closed")));
  const send = (obj: Record<string, unknown>) => {
    appendNative(ctx.threadId, { dir: "out", source: "pi.rpc", msg: hooks.piNativeLogMessage(obj) });
    ctx.child.stdin.write(JSON.stringify(obj) + "\n");
  };
  // Declare protocol 2 on the same stdin before the first command, so an
  // omp-style runtime chunks any oversized frame it sends back. Vanilla
  // pi refuses the unknown command; no waiter is keyed for the reply,
  // so either answer is ignored.
  if (!ctx.standby && !ctx.ahead) send(ctx.deps.negotiateFrame);

  /** Emit buffered assistant text as its own item, then clear it. */
  const flushAssistantText = () => {
    const text = ctx.assistantText;
    ctx.assistantText = "";
    if (!text.trim()) return;
    emit({ ...base(ctx.threadId, ctx.turnId), type: "item.completed", itemType: "assistant_text", text });
  };

  const settle = (ok: boolean, stopReason?: string | null, usage?: { input?: number; output?: number }) => {
    if (ctx.settled) return;
    ctx.settled = true;
    // #1276: once this pi has exited (its session file then holds the
    // whole turn), start the thread's next pi, its session resumed.
    if (ok && ctx.turn.compactPrompt && ctx.standbySession && (stopReason ?? "end_turn") === "end_turn") {
      const resume = {
        person: hooks.warmPerson(ctx.turn),
        threadId: ctx.threadId,
        key: ctx.standbyKey,
        sessionFile: ctx.standbySession,
        cli: ctx.deps.config.cli,
        args: ctx.childArgs,
        cwd: ctx.turn.cwd,
        env: ctx.spawnEnv,
        config: ctx.mcpConfig,
        toolCache: hooks.readPiToolCache(ctx.mcpTempDir, ctx.deps.toolCacheName),
        // a conversation's first turn warms the bot's next one (the standby sends it)
        warm: typeof ctx.turn.resumeCursor === "string" ? undefined : hooks.readPiToolCache(ctx.mcpTempDir, ctx.deps.warmName),
      };
      if (ctx.child.exitCode !== null || ctx.child.signalCode !== null) void hooks.startPiStandby(resume).catch(reportBackgroundError);
      else ctx.child.once("exit", () => { void hooks.startPiStandby(resume).catch(reportBackgroundError); });
      // and a pi for the bot's next new conversation, if none waits yet
      if (ctx.mounts && ctx.turn.cwd) {
        void hooks.startPiFresh({
          person: hooks.warmPerson(ctx.turn),
          key: ctx.freshKey,
          cli: ctx.deps.config.cli,
          args: ctx.childArgs,
          cwd: ctx.turn.cwd,
          env: ctx.spawnEnv,
        }).catch(reportBackgroundError);
      }
    }
    if (ctx.agentEndTimer) {
      clearTimeout(ctx.agentEndTimer);
      ctx.agentEndTimer = null;
    }
    // The turn is over: drop unanswered asks so their 15-minute
    // fail-safe timers are cancelled outright instead of no-oping on a
    // dead child while holding the ask closure alive.
    for (const timer of ctx.askTimers) clearTimeout(timer);
    ctx.askTimers.clear();
    ctx.pending.clear();
    flushAssistantText();
    emit({
      ...base(ctx.threadId, ctx.turnId),
      type: "turn.completed",
      ok,
      stopReason: stopReason ?? (ok ? "end_turn" : "failed"),
      ...(usage ? { usage: { input: usage.input ?? 0, output: usage.output ?? 0 } } : {}),
    });
    try {
      ctx.child.stdin.end();
    } catch {
      /* already closed */
    }
    try {
      killCliTree(ctx.child);
    } catch {
      /* already gone */
    }
    if (ctx.mcpTempDir) {
      try {
        rmSync(ctx.mcpTempDir, { recursive: true, force: true });
      } catch {
        /* best effort */
      }
    }
    ctx.deps.active.delete(ctx.threadId);
  };

  /** Settle from the last turn_end's recorded outcome. Errors surface
   * here, at run completion, so a failed run reports exactly once and
   * only after any scheduled maintenance events had their chance to
   * arrive. */
  const finishRun = () => {
    const sr = ctx.endStopReason;
    if (sr === "error" || sr === "failed") {
      const raw = String(ctx.endErrorMessage ?? "pi turn failed");
      // A local or computer-shared model has no usage limit: its failure
      // says what is wrong and what to do, with the server's own words.
      const local = isLocalModelId(ctx.turn.model) ? localModelFailureMessage(raw) : null;
      const said = local ? providerReason(raw.replace(/^\d{3}\s+/, "")) : null;
      emit({
        ...base(ctx.threadId, ctx.turnId),
        type: "runtime.error",
        message: (local ? `${local}${said ? ` (the local server said: "${said}")` : ""}` : raw).slice(0, 2_000),
      });
      settle(false, "failed", ctx.endUsage);
      return;
    }
    settle(true, sr === "cancelled" || sr === "aborted" ? "cancelled" : "end_turn", ctx.endUsage);
  };

  const stop = () => {
    try {
      send({ type: "abort" });
    } catch {
      /* ignore */
    }
    try {
      killCliTree(ctx.child);
    } catch {
      /* ignore */
    }
    settle(true, "cancelled");
  };

  // Mid-turn input rides pi's native steer frame — the runtime queues
  // it into the running agent without aborting the in-flight step, and
  // answers success only after session.steer() accepted it. A success:
  // false response is an explicit refusal (nothing consumed the words:
  // safe to re-queue), while a death or timeout after the frame was
  // written leaves the outcome unknowable — those are "indeterminate"
  // so the caller can never run the words twice. Each frame carries a
  // unique id that pi echoes on its response, so concurrent steers on
  // the same turn never share or overwrite a waiter.
  const steerActiveTurn = async (text: string, steerId?: string) => {
    if (ctx.settled || ctx.child.exitCode !== null || ctx.child.signalCode !== null) return "refused" as const;
    let ack: Promise<unknown>;
    try {
      const id = `steer:${++ctx.steerSeq}`;
      ack = awaitResponse("steer", 20_000, id);
      send({ type: "steer", id, message: text });
    } catch {
      // stdin closed before the frame was written: provably undelivered.
      return "refused" as const;
    }
    try {
      await ack;
      // pi's agent loop polls accepted steering after every step, the
      // last one included: the running turn reads it. Said so, the
      // harness never offers it again to the next turn (2026-11-01).
      if (steerId) emit({ ...base(ctx.threadId, ctx.turnId), type: "steer.received", steerId });
      return "steered" as const;
    } catch (error) {
      return hooks.isRefusal(error) ? "refused" as const : "indeterminate" as const;
    }
  };
  ctx.deps.active.set(ctx.threadId, { stop, turnId: ctx.turnId, pending: ctx.pending, child: ctx.child, steer: steerActiveTurn });

  return Object.assign(ctx, { rejectWaiters, awaitResponse, send, flushAssistantText, settle, finishRun, stop });
}
