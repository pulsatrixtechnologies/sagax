/** pi sendTurn orchestration across prepare, rpc, events, and session (#1383). */
import type { SendTurnInput } from "../contracts.ts";
import { preparePiTurn } from "./pi-send-prepare.ts";
import { runPiSession } from "./pi-send-session.ts";
import type { PiSendDeps } from "./pi-turn-ctx.ts";

/** #3063: each failing extension is logged once per process, not per turn. */
const loggedExtensionFailures = new Set<string>();

export function createPiSendTurn(deps: PiSendDeps): (turn: SendTurnInput) => Promise<{ turnId: string }> {
  /** One attempt. The first runs with the kit's extensions; when pi exits
   * because one failed to load, the turn moves to a second attempt, under
   * the same turn id, with `--no-extensions` (#3063). */
  async function attempt(turn: SendTurnInput, retryOf?: string): Promise<{ turnId: string; done: Promise<void> }> {
    let retired = false;
    // a retired attempt's late events (its close, a handshake error) stay silent
    const scoped: PiSendDeps = { ...deps, emit: (event) => { if (!retired) deps.emit(event); } };
    const ctx = await preparePiTurn(scoped, turn, retryOf ? { turnId: retryOf, withoutExtensions: true } : {});
    let retry: Promise<void> | null = null;
    if (!retryOf) {
      deps.emit({ ...deps.base(ctx.threadId, ctx.turnId), type: "turn.started" });
      ctx.onExtensionLoadFailure = (line) => {
        retired = true;
        if (!loggedExtensionFailures.has(line)) {
          loggedExtensionFailures.add(line);
          console.warn(`[pi] an extension failed to load; the turn runs again without extensions: ${line}`);
        }
        retry = attempt(turn, ctx.turnId)
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
