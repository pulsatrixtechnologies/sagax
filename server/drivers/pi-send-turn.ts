/** pi sendTurn orchestration across prepare, rpc, events, and session (#1383). */
import type { SendTurnInput } from "../contracts.ts";
import { leaveOutPiExtension, piSkippedNotice } from "./pi-extension-failures.ts";
import { preparePiTurn } from "./pi-send-prepare.ts";
import { runPiSession } from "./pi-send-session.ts";
import type { PiSendDeps } from "./pi-turn-ctx.ts";

/** #3063: at most this many kit extensions are left out in one turn; past
 * that the kit is broken and the turn fails in the chat. */
const MAX_EXTENSION_RETRIES = 3;

export function createPiSendTurn(deps: PiSendDeps): (turn: SendTurnInput) => Promise<{ turnId: string }> {
  /** One attempt. When pi exits because one kit extension (not a guard)
   * failed to load, the turn moves to a new attempt, under the same turn
   * id, without that one extension; the process remembers it, so the next
   * turns start pi once (#3063). */
  async function attempt(turn: SendTurnInput, retryOf?: string, retries = 0): Promise<{ turnId: string; done: Promise<void> }> {
    let retired = false;
    // a retired attempt's late events (its close, a handshake error) stay silent
    const scoped: PiSendDeps = { ...deps, emit: (event) => { if (!retired) deps.emit(event); } };
    const ctx = await preparePiTurn(scoped, turn, retryOf ? { turnId: retryOf } : {});
    let retry: Promise<void> | null = null;
    if (!retryOf) deps.emit({ ...deps.base(ctx.threadId, ctx.turnId), type: "turn.started" });
    // nothing invisible: a turn that runs without a kit extension says so in the chat
    if (ctx.kit.skipped.length) {
      deps.emit({ ...deps.base(ctx.threadId, ctx.turnId), type: "runtime.notice", message: piSkippedNotice(ctx.kit.skipped) });
    }
    if (retries < MAX_EXTENSION_RETRIES) {
      ctx.onExtensionLoadFailure = (arg, line) => {
        retired = true;
        leaveOutPiExtension(arg, line);
        retry = attempt(turn, ctx.turnId, retries + 1)
          .then((next) => next.done)
          .catch((error: unknown) => {
            const message = error instanceof Error ? error.message : String(error);
            deps.emit({ ...deps.base(ctx.threadId, ctx.turnId), type: "runtime.error", message: `${line}\n${message}` });
            deps.emit({ ...deps.base(ctx.threadId, ctx.turnId), type: "turn.completed", ok: false, stopReason: "failed" });
          });
      };
    }
    const done = (async () => {
      try {
        await runPiSession(ctx);
      } catch (error) {
        if (!retired) throw error;
      }
      if (retry) await retry;
    })();
    return { turnId: ctx.turnId, done };
  }

  return async function sendTurn(turn: SendTurnInput): Promise<{ turnId: string }> {
    if (deps.startupModelRefresh) await deps.startupModelRefresh;
    const { turnId, done } = await attempt(turn);
    await done;
    return { turnId };
  };
}
